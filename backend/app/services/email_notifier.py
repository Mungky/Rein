"""Email R-Net lewat Resend — alarm sensor, kesehatan sistem, backup bulanan.

Kenapa modul terpisah dari email.py (SMTP Gmail milik Digital Library):
Resend memakai API HTTP sederhana (tanpa app-password Gmail) dan mendukung
attachment — dibutuhkan job backup yang mengirim file Excel. Digital Library
tetap memakai email.py; semua jalur email R-NET lewat sini.

Pola sama dengan notifier.py (Telegram):
- Tidak pernah raise — gagal kirim dicatat di log lalu ditelan.
- Tanpa RESEND_API_KEY: fallback otomatis ke SMTP (kredensial SMTP_* yang
  sama dengan email.py) bila terisi; kalau dua-duanya kosong, email hanya
  dicatat-lewati — dev lokal tidak butuh akun Resend.

Anti-spam: modul ini SENGAJA tidak punya throttle sendiri. Email selalu
dikirim di titik yang sama dengan Telegram, jadi otomatis kena throttle yang
sama: cooldown_min + notified_at-claim di notifier.notify_alarm (alarm
sensor), transisi 🔴/🟢 + ERROR_THROTTLE_S di health_monitor (kesehatan
sistem). Satu kejadian = satu pesan Telegram = satu email.
"""

import base64
import logging
import os
from email.mime.application import MIMEApplication
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

import httpx

from app.config import settings

logger = logging.getLogger(__name__)

RESEND_URL = "https://api.resend.com/emails"

# Attachment lebih besar dari ini tidak diikutkan (Resend menolak total >40 MB;
# inbox penerima juga punya batas) — email tetap terkirim tanpa lampiran dan
# body-nya sudah memuat link Google Drive sebagai jalur alternatif.
ATTACH_MAX_MB = int(os.getenv("EMAIL_ATTACH_MAX_MB", "15"))


def _strip_oversize_attachment(
    body: str, attachment: tuple[str, bytes] | None
) -> tuple[str, tuple[str, bytes] | None]:
    if attachment is None:
        return body, None
    filename, content = attachment
    size_mb = len(content) / (1024 * 1024)
    if size_mb <= ATTACH_MAX_MB:
        return body, attachment
    logger.warning(
        "Lampiran %s %.1f MB > batas %d MB — dikirim tanpa lampiran",
        filename, size_mb, ATTACH_MAX_MB,
    )
    body = (
        f"{body}\n\n(Lampiran {filename} berukuran {size_mb:.0f} MB — terlalu "
        f"besar untuk email, unduh lewat link Google Drive di atas.)"
    )
    return body, None


async def _send_resend(
    to: str, subject: str, body: str,
    attachment: tuple[str, bytes] | None, html: bool,
) -> None:
    payload: dict = {
        "from": settings.resend_from,
        "to": [to],
        "subject": subject,
        ("html" if html else "text"): body,
    }
    if attachment is not None:
        filename, content = attachment
        payload["attachments"] = [
            {"filename": filename, "content": base64.b64encode(content).decode()}
        ]
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.post(
            RESEND_URL,
            json=payload,
            headers={"Authorization": f"Bearer {settings.resend_api_key}"},
        )
        if resp.status_code >= 400:
            logger.error(
                "Resend gagal (%s) ke %s: %s", resp.status_code, to, resp.text[:300]
            )
        else:
            logger.info("Email (Resend) terkirim ke %s: %s", to, subject)


async def _send_smtp(
    to: str, subject: str, body: str,
    attachment: tuple[str, bytes] | None, html: bool,
) -> None:
    import aiosmtplib

    msg = MIMEMultipart()
    msg["From"] = settings.smtp_from or settings.smtp_user
    msg["To"] = to
    msg["Subject"] = subject
    msg.attach(MIMEText(body, "html" if html else "plain", "utf-8"))
    if attachment is not None:
        filename, content = attachment
        part = MIMEApplication(content, Name=filename)
        part["Content-Disposition"] = f'attachment; filename="{filename}"'
        msg.attach(part)
    await aiosmtplib.send(
        msg,
        hostname=settings.smtp_host,
        port=settings.smtp_port,
        username=settings.smtp_user,
        password=settings.smtp_password,
        start_tls=True,
    )
    logger.info("Email (SMTP fallback) terkirim ke %s: %s", to, subject)


async def send_email(
    to: str,
    subject: str,
    body: str,
    attachment: tuple[str, bytes] | None = None,
    html: bool = False,
) -> None:
    """Kirim satu email via Resend (atau fallback SMTP). Never raises.

    `attachment` = (nama_file, isi_bytes), mis. ("backup.xlsx", b"...")."""
    if not to:
        logger.warning("Alamat penerima kosong — email dilewati: %s", subject)
        return
    body, attachment = _strip_oversize_attachment(body, attachment)
    try:
        if settings.resend_api_key:
            await _send_resend(to, subject, body, attachment, html)
        elif settings.smtp_user and settings.smtp_password:
            await _send_smtp(to, subject, body, attachment, html)
        else:
            logger.info(
                "RESEND_API_KEY & SMTP tidak diset — email dilewati ke %s: %s",
                to, subject,
            )
    except Exception as e:
        logger.error("Gagal kirim email ke %s (%s): %s", to, subject, e)


async def send_to_list(
    recipients_csv: str,
    subject: str,
    body: str,
    attachment: tuple[str, bytes] | None = None,
    html: bool = False,
) -> None:
    """Kirim ke daftar penerima dipisah koma (format scada_alarm_settings
    .email_recipients). Alamat kosong dilewati. Never raises."""
    for recipient in (recipients_csv or "").split(","):
        recipient = recipient.strip()
        if recipient:
            await send_email(recipient, subject, body, attachment, html)
