"""R-Net alarm notification dispatcher — in-app, email, Telegram.

In-app needs no dispatching: the alarm event row itself is pushed to browsers
via Supabase Realtime (scada_alarm_events is in the publication) and the
frontend badge/sound react to it. This module only handles the EXTERNAL
channels (email + Telegram), each behind its enable flag in the single-row
scada_alarm_settings table.

Double-send safety: the engine may run in two backends sharing one DB (laptop
dev + server). Before sending, the caller must have won an atomic claim —
for "triggered" that is the INSERT..RETURNING that opened the event plus the
`notified_at` claim UPDATE here; for "cleared" it is the UPDATE..RETURNING
that set cleared_at. Losers see zero rows and stay silent.

Flap debounce: if another event of the same (tag, kind) was externally
notified within `cooldown_min`, external channels are skipped — a sensor
bouncing across its threshold cannot spam inboxes. The DB row (and therefore
the in-app history) is always written regardless.

Like email.py, nothing here ever raises — failures are logged and swallowed.
"""

import logging
from datetime import datetime, timedelta, timezone

import httpx
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.services.email import send_email
from db.models.scada import ScadaAlarmEvent, ScadaAlarmSettings, ScadaTag

logger = logging.getLogger(__name__)

KIND_LABELS = {
    "high": "di atas batas",
    "low": "di bawah batas",
    "silent": "tidak mengirim data",
}


async def get_settings(db: AsyncSession) -> ScadaAlarmSettings | None:
    result = await db.execute(
        select(ScadaAlarmSettings).where(ScadaAlarmSettings.id == 1)
    )
    return result.scalar_one_or_none()


def _fmt_value(value: float | None) -> str:
    if value is None:
        return "-"
    return f"{value:g}"


def build_message(
    event: ScadaAlarmEvent, tag: ScadaTag, transition: str
) -> tuple[str, str]:
    """Returns (subject, body) in Bahasa Indonesia, plain text."""
    unit = f" {tag.unit}" if tag.unit else ""
    when = event.triggered_at.astimezone(timezone.utc).strftime("%d-%m-%Y %H:%M UTC")
    if transition == "cleared":
        subject = f"NORMAL KEMBALI: {tag.label}"
        if event.kind == "silent":
            body = f"Sensor {tag.label} sudah mengirim data lagi."
        else:
            body = (
                f"Nilai {tag.label} sudah kembali dalam batas aman "
                f"(sebelumnya {_fmt_value(event.trigger_value)}{unit} "
                f"{KIND_LABELS[event.kind]} {_fmt_value(event.threshold)}{unit})."
            )
        return subject, body

    if event.kind == "silent":
        subject = f"SENSOR BISU: {tag.label}"
        body = (
            f"Sensor {tag.label} berhenti mengirim data (terdeteksi {when}). "
            f"Periksa alat/koneksi di lapangan."
        )
    else:
        subject = f"ALARM: {tag.label} = {_fmt_value(event.trigger_value)}{unit}"
        body = (
            f"Nilai {tag.label} = {_fmt_value(event.trigger_value)}{unit}, "
            f"{KIND_LABELS[event.kind]} {_fmt_value(event.threshold)}{unit} "
            f"(terdeteksi {when}). Buka R-Net untuk melihat detail dan "
            f"tekan 'Ack' bila sudah ditangani."
        )
    return subject, body


async def send_telegram(chat_id: str, text: str) -> None:
    """POST to the Telegram bot API. Never raises."""
    token = settings.telegram_bot_token
    if not token:
        logger.info("TELEGRAM_BOT_TOKEN not set — skipping Telegram notification")
        return
    if not chat_id:
        logger.warning("Telegram chat id empty — skipping Telegram notification")
        return
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.post(
                f"https://api.telegram.org/bot{token}/sendMessage",
                json={"chat_id": chat_id, "text": text},
            )
            if resp.status_code != 200:
                logger.error(
                    "Telegram send failed (%s): %s", resp.status_code, resp.text[:200]
                )
    except Exception as e:
        logger.error("Telegram send failed: %s", e)


async def _within_cooldown(
    db: AsyncSession, event: ScadaAlarmEvent, cooldown_min: int
) -> bool:
    """True if another event of the same (tag, kind) was externally notified
    within the cooldown window — i.e. this one should stay in-app only."""
    if cooldown_min <= 0:
        return False
    cutoff = datetime.now(timezone.utc) - timedelta(minutes=cooldown_min)
    result = await db.execute(
        select(ScadaAlarmEvent.id)
        .where(
            ScadaAlarmEvent.tag_id == event.tag_id,
            ScadaAlarmEvent.kind == event.kind,
            ScadaAlarmEvent.id != event.id,
            ScadaAlarmEvent.notified_at.is_not(None),
            ScadaAlarmEvent.notified_at >= cutoff,
        )
        .limit(1)
    )
    return result.scalar_one_or_none() is not None


async def notify_alarm(
    db: AsyncSession, event: ScadaAlarmEvent, tag: ScadaTag, transition: str
) -> None:
    """Dispatch external notifications for an open/clear transition.

    `transition` is "triggered" or "cleared". The caller must already be the
    single winner of the state transition (see module docstring)."""
    try:
        alarm_settings = await get_settings(db)
        if alarm_settings is None:
            return
        email_on = alarm_settings.email_enabled and alarm_settings.email_recipients
        telegram_on = (
            alarm_settings.telegram_enabled and alarm_settings.telegram_chat_id
        )
        if not email_on and not telegram_on:
            return

        if transition == "triggered":
            # Cooldown first: a suppressed event keeps notified_at NULL, so
            # the next flap after the window CAN notify again ("at most one
            # external notification per cooldown_min per tag+kind").
            if await _within_cooldown(db, event, alarm_settings.cooldown_min):
                logger.info(
                    "Alarm %s/%s within cooldown — external notify skipped",
                    tag.label,
                    event.kind,
                )
                return
            # Atomic claim: only one engine may send for this event.
            claimed = await db.execute(
                update(ScadaAlarmEvent)
                .where(
                    ScadaAlarmEvent.id == event.id,
                    ScadaAlarmEvent.notified_at.is_(None),
                )
                .values(notified_at=datetime.now(timezone.utc))
                .returning(ScadaAlarmEvent.id)
            )
            won = claimed.scalar_one_or_none() is not None
            await db.commit()
            if not won:
                return
        else:
            # "cleared": send only when this event's own alarm was externally
            # sent — pairs every NORMAL message with its ALARM message and
            # keeps flapping sensors from spamming clear notices.
            if event.notified_at is None:
                return

        subject, body = build_message(event, tag, transition)

        if email_on:
            for recipient in alarm_settings.email_recipients.split(","):
                recipient = recipient.strip()
                if recipient:
                    await send_email(to=recipient, subject=subject, body=body)
        if telegram_on:
            await send_telegram(alarm_settings.telegram_chat_id, f"{subject}\n{body}")
    except Exception:
        logger.exception("Alarm notification dispatch failed")
