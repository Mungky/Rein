"""Email service — Gmail SMTP for REIN notifications.

Uses aiosmtplib for async email sending. All calls are fire-and-forget
with error logging — email failures never block the main flow.
"""

import logging
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart

import aiosmtplib

from app.config import settings

logger = logging.getLogger(__name__)


async def send_email(to: str, subject: str, body: str, html: bool = False) -> None:
    """Send an email via Gmail SMTP.

    If SMTP credentials are not configured, logs the email instead.
    Never raises — errors are logged and swallowed.
    """
    if not settings.smtp_user or not settings.smtp_password:
        logger.info("SMTP not configured — skipping email to %s: %s", to, subject)
        return

    if not to:
        logger.warning("No recipient address — skipping email")
        return

    msg = MIMEMultipart()
    msg["From"] = settings.smtp_from or settings.smtp_user
    msg["To"] = to
    msg["Subject"] = subject

    content_type = "html" if html else "plain"
    msg.attach(MIMEText(body, content_type, "utf-8"))

    try:
        await aiosmtplib.send(
            msg,
            hostname=settings.smtp_host,
            port=settings.smtp_port,
            username=settings.smtp_user,
            password=settings.smtp_password,
            start_tls=True,
        )
        logger.info("Email sent to %s: %s", to, subject)
    except Exception as e:
        logger.error("Failed to send email to %s: %s", to, e)


async def send_access_approved_email(
    to: str, document_title: str, access_token: str, expires_at: str
) -> None:
    """Send an access-approved notification email."""
    body = f"""
    <h2>Akses Dokumen Disetujui</h2>
    <p>Pengajuan akses Anda untuk dokumen <strong>{document_title}</strong> telah disetujui.</p>
    <p>Link akses berlaku hingga {expires_at}.</p>
    <p>Terima kasih.</p>
    """
    await send_email(
        to=to,
        subject=f"Akses Disetujui: {document_title}",
        body=body,
        html=True,
    )


async def send_access_denied_email(to: str, document_title: str) -> None:
    """Send an access-denied notification email."""
    body = f"""
    <h2>Akses Dokumen Ditolak</h2>
    <p>Pengajuan akses Anda untuk dokumen <strong>{document_title}</strong> telah ditolak.</p>
    <p>Hubungi administrator jika Anda memiliki pertanyaan.</p>
    """
    await send_email(
        to=to,
        subject=f"Akses Ditolak: {document_title}",
        body=body,
        html=True,
    )


async def send_document_uploaded_email(to: str, doc_number: str, title: str) -> None:
    """Send a document-uploaded notification email."""
    body = f"""
    <h2>Dokumen Baru Diunggah</h2>
    <p>Dokumen <strong>{title}</strong> ({doc_number}) telah diunggah ke sistem.</p>
    """
    await send_email(
        to=to,
        subject=f"Dokumen Baru: {doc_number} - {title}",
        body=body,
        html=True,
    )