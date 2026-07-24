"""Alarm kesehatan SISTEM R-Net → Telegram + email (reuse jalur notifier alarm).

Tiga sumber (W4):
1. Bridge MQTT mati / gagal konek broker > BRIDGE_OFFLINE_S (2 menit) —
   dibaca dari heartbeat scada_bridge_status yang ditulis bridge tiap ~15 s:
   updated_at basi ⇒ proses bridge mati / PC site padam; connected=false
   yang bertahan ⇒ bridge hidup tapi broker site itu tak terjangkau.
2. Tag MQTT tidak update > TAG_STALE_S (15 menit) — versi server-side dari
   STALE_MS frontend (use-tag-value.ts), dibaca dari scada_tag_latest.
   Alarm "silent" per-tag milik alarm engine tetap jalan (jendela lebih
   pendek, per-tag, bisa di-Ack); sweep ini melengkapinya dengan SATU pesan
   agregat — dan dilewati saat bridge sedang offline supaya tidak dobel.
3. Error 5xx backend — dilaporkan middleware main.py lewat
   report_server_error(); di-throttle ERROR_THROTTLE_S supaya error
   beruntun tidak membanjiri Telegram.

Pesan 1–2 dikirim hanya saat status BERUBAH (rusak → 🔴, pulih → 🟢), jadi
tidak ada spam berulang. Enable/chat-id Telegram diambil dari
scada_alarm_settings yang sama dengan alarm sensor.

Catatan dua-backend: state transisi disimpan in-memory; dua backend yang
berbagi DB bisa sama-sama mengirim. Pakai pola alarm engine: laptop dev
mematikan lewat HEALTH_MONITOR_ENABLED=0, server adalah monitor tunggal.
"""

import asyncio
import logging
import os
import time
from datetime import datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.services import email_notifier, notifier
from db.models.scada import (
    ScadaBridgeStatus,
    ScadaSite,
    ScadaTag,
    ScadaTagLatest,
)

logger = logging.getLogger(__name__)

INTERVAL_S = int(os.getenv("HEALTH_INTERVAL_S", "60"))
ENABLED = os.getenv("HEALTH_MONITOR_ENABLED", "1") not in ("0", "false", "False")
BRIDGE_OFFLINE_S = int(os.getenv("HEALTH_BRIDGE_OFFLINE_S", "120"))
TAG_STALE_S = int(os.getenv("HEALTH_TAG_STALE_S", "900"))
ERROR_THROTTLE_S = int(os.getenv("HEALTH_ERROR_THROTTLE_S", "300"))

# Problem yang sedang aktif: key → label pesan (untuk pesan pulih).
_active: dict[str, str] = {}

# Throttle laporan 5xx.
_err_lock: asyncio.Lock | None = None
_err_count = 0
_err_last_sent: float | None = None


async def _send(db: AsyncSession, text: str) -> None:
    """Kirim ke Telegram + email alarm (setelan scada_alarm_settings, saklar &
    penerima yang sama dengan alarm sensor). Anti-spam sudah ditangani pemanggil
    (transisi 🔴/🟢 + throttle 5xx) — email dan Telegram kena jatah yang sama.
    Never raises."""
    alarm_settings = await notifier.get_settings(db)
    telegram_on = alarm_settings is not None and (
        alarm_settings.telegram_enabled and alarm_settings.telegram_chat_id
    )
    email_on = alarm_settings is not None and (
        alarm_settings.email_enabled and alarm_settings.email_recipients
    )
    if not telegram_on and not email_on:
        logger.info("Alarm kesehatan (notifikasi nonaktif): %s", text)
        return
    if telegram_on:
        await notifier.send_telegram(alarm_settings.telegram_chat_id, text)
    if email_on:
        await email_notifier.send_to_list(
            alarm_settings.email_recipients,
            subject=f"R-Net Kesehatan Sistem: {text[:70]}",
            body=text,
        )


async def _send_text(text: str) -> None:
    """Seperti _send, tapi membuka sesi DB sendiri (untuk pemanggil di luar loop)."""
    from db.session import async_session_factory

    async with async_session_factory() as db:
        await _send(db, text)


def _ago(ts: datetime, now: datetime) -> str:
    menit = max(int((now - ts).total_seconds() // 60), 0)
    return f"{menit} menit lalu"


async def _collect_problems(db: AsyncSession) -> dict[str, str]:
    """Satu pass baca DB → dict problem aktif {key: label pesan}."""
    now = datetime.now(timezone.utc)
    problems: dict[str, str] = {}

    # --- 1. bridge / broker (heartbeat scada_bridge_status) ---------------- #
    rows = (
        await db.execute(
            select(ScadaBridgeStatus, ScadaSite.name)
            .join(ScadaSite, ScadaSite.id == ScadaBridgeStatus.site_id)
            .where(ScadaSite.enabled.is_(True))
        )
    ).all()
    # Tanpa baris sama sekali = bridge belum pernah deploy pasca-migrasi —
    # jangan alarm palsu.
    if rows:
        offline_cutoff = now - timedelta(seconds=BRIDGE_OFFLINE_S)
        freshest = max(status.updated_at for status, _name in rows)
        if freshest < offline_cutoff:
            problems["bridge"] = (
                f"Bridge MQTT OFFLINE — heartbeat terakhir "
                f"{_ago(freshest, now)}. Cek PC site / proses bridge."
            )
        else:
            for status, name in rows:
                if not status.connected and status.changed_at < offline_cutoff:
                    problems[f"site:{status.site_id}"] = (
                        f"Bridge gagal konek ke broker site '{name}' sejak "
                        f"{_ago(status.changed_at, now)}. Cek broker/kredensial."
                    )

    # --- 2. tag basi (> TAG_STALE_S tanpa update) -------------------------- #
    # Saat bridge offline SEMUA tag pasti basi — pesan bridge sudah cukup.
    if "bridge" not in problems:
        stale_cutoff = now - timedelta(seconds=TAG_STALE_S)
        stale = (
            await db.execute(
                select(ScadaTag.label)
                .join(ScadaTagLatest, ScadaTagLatest.tag_id == ScadaTag.id)
                .where(
                    ScadaTag.enabled.is_(True),
                    ScadaTag.source == "mqtt",
                    ScadaTagLatest.ts < stale_cutoff,
                )
                .order_by(ScadaTag.label)
            )
        ).scalars().all()
        if stale:
            shown = ", ".join(stale[:8]) + (" …" if len(stale) > 8 else "")
            problems["tags"] = (
                f"{len(stale)} tag tidak update > {TAG_STALE_S // 60} menit: "
                f"{shown}"
            )

    return problems


def _apply_transitions(current: dict[str, str]) -> list[str]:
    """Bandingkan dengan pass sebelumnya; kembalikan pesan yang perlu dikirim.

    Hanya PERUBAHAN yang menghasilkan pesan — problem yang bertahan tidak
    dikirim ulang tiap pass."""
    global _active
    messages = [f"🔴 {label}" for key, label in current.items() if key not in _active]
    messages += [
        f"🟢 PULIH: {label}" for key, label in _active.items() if key not in current
    ]
    _active = dict(current)
    return messages


async def evaluate_once(db: AsyncSession) -> None:
    current = await _collect_problems(db)
    for text in _apply_transitions(current):
        logger.warning("Alarm kesehatan: %s", text)
        await _send(db, text)


async def health_loop() -> None:
    """Jalan seumur hidup app (dipicu lifespan main.py). Satu iterasi gagal
    tidak boleh mematikan loop."""
    from db.session import async_session_factory

    logger.info(
        "Health monitor aktif — tiap %ds (bridge offline > %ds, tag basi > %ds)",
        INTERVAL_S,
        BRIDGE_OFFLINE_S,
        TAG_STALE_S,
    )
    while True:
        await asyncio.sleep(INTERVAL_S)
        try:
            async with async_session_factory() as db:
                await evaluate_once(db)
        except Exception:
            logger.exception("Iterasi health monitor gagal")


async def report_server_error(method: str, path: str, status_code: int) -> None:
    """Dipanggil middleware main.py untuk tiap respons/exception 5xx.

    Kirim Telegram maksimal sekali per ERROR_THROTTLE_S; error di sela
    jendela hanya dihitung dan jumlahnya dilampirkan pada kiriman
    berikutnya (error beruntun ≠ banjir pesan). Never raises."""
    global _err_lock, _err_count, _err_last_sent
    try:
        if _err_lock is None:
            _err_lock = asyncio.Lock()
        async with _err_lock:
            now = time.monotonic()
            _err_count += 1
            if (
                _err_last_sent is not None
                and now - _err_last_sent < ERROR_THROTTLE_S
            ):
                return  # masih dalam jendela throttle — cukup dihitung
            count, _err_count = _err_count, 0
            _err_last_sent = now
        extra = (
            f" (+{count - 1} error lain sejak kiriman terakhir)" if count > 1 else ""
        )
        await _send_text(
            f"🔴 ERROR SERVER: HTTP {status_code} pada {method} {path}{extra}"
        )
    except Exception:
        logger.exception("Gagal melaporkan error 5xx ke Telegram")
