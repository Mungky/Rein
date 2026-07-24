"""Monitor akses data R-Net (M12) — catat pembacaan besar + alert anomali.

Dipanggil dari endpoint riwayat (/recent, /samples, /history) SETELAH query
utama selesai, dengan jumlah baris yang benar-benar dikembalikan:

    await data_access_monitor.log_big_read(
        db, profile, ACCESS_SAMPLES, [tag.label], start, end, len(rows))

Dua ambang, dua tujuan:
- DATA_ACCESS_LOG_MIN_ROWS (default 500): request di bawah ini TIDAK dicatat
  — scroll dashboard sehari-hari bukan kejadian yang menarik.
- DATA_ACCESS_ALERT_ROWS (default 2.000.000/hari): total baris tercatat satu
  akun dalam satu hari (UTC) melewati ini → alert Telegram + email SEKALI per
  akun per hari. Default longgar dengan sengaja: ekspor sebulan data sensor
  2 detik ≈ 1,3 juta baris adalah pemakaian sah; dua kali ekspor sebesar itu
  dalam sehari baru pantas ditengok. Turunkan lewat env bila terlalu longgar.

Penulisan menumpang commit get_db (GET handler → commit sukses di akhir
request). Alert throttle disimpan in-memory per proses — pola yang sama dengan
health_monitor: server tunggal adalah monitor; dev laptop yang ikut membaca DB
paling banter mengirim satu alert duplikat. Never raises.
"""

import logging
import os
from datetime import datetime, time, timezone

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.services import email_notifier, notifier
from db.models.profile import Profile
from db.models.scada_data_access_log import ScadaDataAccessLog

logger = logging.getLogger(__name__)

LOG_MIN_ROWS = int(os.getenv("DATA_ACCESS_LOG_MIN_ROWS", "500"))
ALERT_ROWS_PER_DAY = int(os.getenv("DATA_ACCESS_ALERT_ROWS", "2000000"))

# (profile_id, "YYYY-MM-DD") yang sudah dialert hari ini — sekali per hari.
_alerted: set[tuple[str, str]] = set()


def _today_key(profile_id) -> tuple[str, str]:
    return (str(profile_id), datetime.now(timezone.utc).strftime("%Y-%m-%d"))


def _prune_alerted() -> None:
    """Buang kunci hari-hari lalu supaya set tidak tumbuh selamanya."""
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    stale = {k for k in _alerted if k[1] != today}
    _alerted.difference_update(stale)


async def _daily_total(db: AsyncSession, profile_id) -> int:
    day_start = datetime.combine(
        datetime.now(timezone.utc).date(), time.min, tzinfo=timezone.utc
    )
    result = await db.execute(
        select(func.coalesce(func.sum(ScadaDataAccessLog.row_count), 0)).where(
            ScadaDataAccessLog.profile_id == profile_id,
            ScadaDataAccessLog.created_at >= day_start,
        )
    )
    return int(result.scalar_one())


async def _alert(db: AsyncSession, profile: Profile, total: int) -> None:
    name = profile.full_name or profile.username
    total_fmt = f"{total:,}".replace(",", ".")
    ambang_fmt = f"{ALERT_ROWS_PER_DAY:,}".replace(",", ".")
    text = (
        f"⚠️ AKSES DATA BESAR: akun '{name}' sudah mengambil {total_fmt} baris "
        f"data R-Net hari ini (ambang {ambang_fmt}/hari). "
        f"Kalau ini bukan ekspor yang direncanakan, cek akunnya."
    )
    logger.warning("Anomali akses data: %s", text)
    alarm_settings = await notifier.get_settings(db)
    if alarm_settings is None:
        return
    if alarm_settings.telegram_enabled and alarm_settings.telegram_chat_id:
        await notifier.send_telegram(alarm_settings.telegram_chat_id, text)
    if alarm_settings.email_enabled and alarm_settings.email_recipients:
        await email_notifier.send_to_list(
            alarm_settings.email_recipients,
            subject=f"R-Net: akses data besar oleh {name}",
            body=text,
        )


async def log_big_read(
    db: AsyncSession,
    profile: Profile,
    kind: str,
    tag_labels: list[str],
    range_start: datetime | None,
    range_end: datetime | None,
    row_count: int,
) -> None:
    """Catat satu pembacaan besar lalu cek ambang harian akun. Never raises."""
    try:
        if row_count < LOG_MIN_ROWS:
            return
        db.add(
            ScadaDataAccessLog(
                profile_id=profile.id,
                profile_name=profile.full_name or profile.username,
                kind=kind,
                tag_labels=", ".join(tag_labels),
                range_start=range_start,
                range_end=range_end,
                row_count=row_count,
            )
        )
        # Flush supaya baris ini ikut terhitung di SUM dalam transaksi yang
        # sama; commit final tetap milik get_db di akhir request.
        await db.flush()

        _prune_alerted()
        key = _today_key(profile.id)
        if key in _alerted:
            return
        total = await _daily_total(db, profile.id)
        if total >= ALERT_ROWS_PER_DAY:
            _alerted.add(key)
            await _alert(db, profile, total)
    except Exception:
        logger.exception("Pencatatan akses data gagal — request tetap dilayani")
