"""R-Net historian reset — per-tag cycle → Google Drive → wipe → restart clock.

The rule the user asked for, made safe: each "Simpan data" (store) tag
accumulates a FIXED window (scada_settings.store_months, 1 month by default)
starting from config.store_cycle_start. Once that window elapses, the tag's
whole cycle is exported to one Excel file on Google Drive
(`R-Net Arsip/<year>/<label>-<from>-<to>.xlsx`) and ONLY THEN deleted from
scada_samples, resetting the clock (store_cycle_start = now) so the tag starts
fresh from 0. Kuartal/tahunan analysis = combine the Drive files.

No completed archive → no deletion. If Drive is down/unconfigured, data simply
stays until the next pass succeeds.

Double-run safety (laptop dev + server sharing one DB): the
scada_tag_archives (tag_id, cycle_start) row is INSERTed first as an atomic
claim; the loser skips. A failed upload deletes its claim so the next pass
retries. Ring tags (store off) never appear here — the bridge prunes them.
"""

import asyncio
import io
import logging
import os
import uuid
from datetime import datetime, timezone

from sqlalchemy import delete, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.services import rnet_settings
from db.models.scada import ScadaSample, ScadaTag, ScadaTagArchive

logger = logging.getLogger(__name__)

CHECK_EVERY_S = int(os.getenv("ARCHIVE_CHECK_EVERY_S", str(6 * 3600)))
ENABLED = os.getenv("ARCHIVER_ENABLED", "1") not in ("0", "false", "False")
ROOT_FOLDER_NAME = "R-Net Arsip"

XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"


def _safe_sheet_title(label: str) -> str:
    """Excel worksheet title: max 31 chars, no []:*?/\\."""
    clean = "".join(c for c in label if c not in "[]:*?/\\").strip() or "Sensor"
    return clean[:31]


async def _build_tag_workbook(
    db: AsyncSession, tag: ScadaTag, start: datetime, end: datetime
) -> tuple[bytes, int]:
    """One xlsx for a tag's cycle: single worksheet, columns Waktu (UTC) | Nilai."""
    from openpyxl import Workbook

    result = await db.execute(
        select(ScadaSample.ts, ScadaSample.value)
        .where(
            ScadaSample.tag_id == tag.id,
            ScadaSample.ts >= start,
            ScadaSample.ts < end,
        )
        .order_by(ScadaSample.ts)
    )
    rows = result.all()
    if not rows:
        return b"", 0

    wb = Workbook(write_only=True)
    ws = wb.create_sheet(title=_safe_sheet_title(tag.label))
    unit = f" ({tag.unit})" if tag.unit else ""
    ws.append(["Waktu (UTC)", f"Nilai{unit}"])
    for ts, value in rows:
        ws.append([ts.replace(tzinfo=None), value])
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue(), len(rows)


async def _email_backup(
    db: AsyncSession,
    tag: ScadaTag,
    file_name: str,
    content: bytes,
    row_count: int,
    cycle_start: datetime,
    cycle_end: datetime,
    web_link: str | None,
) -> None:
    """Kirim file backup siklus ke penerima email alarm (scada_alarm_settings).

    Gate-nya HANYA daftar penerima terisi — bukan email_enabled, karena flag itu
    mengatur berisiknya notifikasi alarm; laporan backup sebulan sekali harus
    tetap sampai selama ada alamat tujuan. Never raises."""
    from app.services import email_notifier, notifier

    try:
        alarm_settings = await notifier.get_settings(db)
        recipients = alarm_settings.email_recipients if alarm_settings else ""
        if not recipients.strip():
            logger.info("Backup %s: penerima email kosong — email dilewati", tag.label)
            return
        period = f"{cycle_start.strftime('%d-%m-%Y')} s/d {cycle_end.strftime('%d-%m-%Y')}"
        drive_line = (
            f"Salinan juga tersimpan di Google Drive: {web_link}"
            if web_link
            else "Salinan Google Drive: (upload dilewati — siklus kosong)"
        )
        body = (
            f"Backup data R-Net untuk sensor '{tag.label}'.\n\n"
            f"Periode : {period}\n"
            f"Jumlah  : {row_count} baris\n"
            f"File    : {file_name} (terlampir)\n\n"
            f"{drive_line}\n\n"
            f"Data di database akan direset dan pencatatan mulai lagi dari 0."
        )
        await email_notifier.send_to_list(
            recipients,
            subject=f"Backup R-Net: {tag.label} ({period})",
            body=body,
            attachment=(file_name, content),
        )
    except Exception:
        logger.exception("Email backup %s gagal — reset tetap lanjut", tag.label)


async def archive_tag_cycle(
    db: AsyncSession, tag: ScadaTag, cycle_start: datetime
) -> dict | None:
    """Claim → export → upload → mark complete → wipe → restart clock. Returns a
    summary dict, or None when another backend holds the claim / nothing to do."""
    from app.services import gdrive
    from app.config import settings as app_settings

    now = datetime.now(timezone.utc)
    label_safe = _safe_sheet_title(tag.label).replace(" ", "_") or "sensor"
    file_name = (
        f"{label_safe}-{cycle_start.strftime('%Y%m%d')}-{now.strftime('%Y%m%d')}.xlsx"
    )

    # Atomic claim — the unique (tag_id, cycle_start) index makes double-archive
    # impossible even with two backends on the shared DB.
    claimed = await db.execute(
        pg_insert(ScadaTagArchive)
        .values(
            id=uuid.uuid4(),
            tag_id=tag.id,
            cycle_start=cycle_start,
            cycle_end=now,
            file_name=file_name,
        )
        .on_conflict_do_nothing(index_elements=["tag_id", "cycle_start"])
        .returning(ScadaTagArchive.id)
    )
    await db.commit()
    archive_id = claimed.scalar_one_or_none()
    if archive_id is None:
        return None  # another backend owns this cycle

    try:
        content, row_count = await _build_tag_workbook(db, tag, cycle_start, now)

        if row_count > 0:
            year_folder = await gdrive.find_or_create_folder(
                ROOT_FOLDER_NAME, app_settings.google_drive_root_folder_id
            )
            year_folder = await gdrive.find_or_create_folder(
                str(cycle_start.year), year_folder
            )
            uploaded = await gdrive.upload_file_sync(
                content, file_name, XLSX_MIME, year_folder
            )
            drive_id = uploaded.get("id") or ""
            web_link = uploaded.get("webViewLink")
        else:
            # Empty cycle — mark a completed no-op so we don't loop, still reset.
            drive_id = "(kosong)"
            web_link = None

        row = await db.get(ScadaTagArchive, archive_id)
        row.drive_file_id = drive_id
        row.web_link = web_link
        row.row_count = row_count
        await db.commit()

        # Email = jalur PENGIRIMAN utama backup ke manusia (attachment Excel);
        # Drive tetap jangkar KEAMANAN data (tanpa Drive sukses tidak ada
        # penghapusan). Gagal email tidak menggagalkan reset — file sudah
        # verifiably di Drive. Best-effort, never raises.
        if row_count > 0:
            await _email_backup(
                db, tag, file_name, content, row_count, cycle_start, now, web_link
            )

        # Only now may we wipe — the cycle is verifiably on Drive (or empty).
        purged = await db.execute(
            delete(ScadaSample).where(ScadaSample.tag_id == tag.id)
        )
        # Restart the tag's clock from 0.
        tag.config = {**(tag.config or {}), "store_cycle_start": rnet_settings.now_iso()}
        await db.commit()

        logger.info(
            "Reset %s: %d baris → Drive (%s), %d dihapus, siklus baru",
            tag.label, row_count, drive_id, purged.rowcount,
        )
        return {
            "tag_id": str(tag.id),
            "rows": row_count,
            "drive_file_id": drive_id,
            "web_link": web_link,
        }
    except Exception:
        logger.exception("Reset %s gagal — klaim dilepas, dicoba lagi", tag.label)
        # Release the claim; data stays untouched until the archive succeeds.
        row = await db.get(ScadaTagArchive, archive_id)
        if row is not None and row.drive_file_id is None:
            await db.delete(row)
            await db.commit()
        return None


async def archive_once(db: AsyncSession) -> list[dict]:
    """Archive+reset every store tag whose cycle has fully elapsed."""
    settings = await rnet_settings.get_settings(db)
    now = datetime.now(timezone.utc)
    tags = (
        (await db.execute(select(ScadaTag).where(ScadaTag.enabled.is_(True))))
        .scalars()
        .all()
    )
    results: list[dict] = []
    for tag in tags:
        if rnet_settings.is_ring(tag.config):
            continue  # ring tags aren't archived (bridge prunes them)
        cycle_start = rnet_settings.parse_cycle_start(tag.config)
        if cycle_start is None:
            # Store tag with no clock (e.g. legacy) — start it now, no reset yet.
            tag.config = {
                **(tag.config or {}),
                "store_cycle_start": rnet_settings.now_iso(),
            }
            await db.commit()
            continue
        if now < rnet_settings.cycle_reset_at(settings, cycle_start):
            continue  # cycle not elapsed yet
        res = await archive_tag_cycle(db, tag, cycle_start)
        if res:
            results.append(res)
    return results


async def archiver_loop() -> None:
    """Runs for the app's lifetime (started from main.py lifespan)."""
    from db.session import async_session_factory

    logger.info("Archiver active — per-tag cycle reset, check every %dh", CHECK_EVERY_S // 3600)
    while True:
        await asyncio.sleep(CHECK_EVERY_S)
        try:
            async with async_session_factory() as db:
                await archive_once(db)
        except Exception:
            logger.exception("Archiver iteration failed")
