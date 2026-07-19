"""R-Net monthly archiver — samples older than 90 days → Google Drive → purge.

The rule the user asked for, made safe: history is kept for a rolling
ARCHIVE_RETENTION_DAYS (90) window. Once a calendar month has fully aged out
of that window, its rows are exported to one tidy Excel file on Google Drive
(`R-Net Arsip/<year>/R-Net <YYYY-MM>.xlsx`, one worksheet per sensor) and
ONLY THEN deleted from scada_samples. No completed archive → no deletion —
if Drive is down or unconfigured, data simply stays until it succeeds.

Double-run safety (laptop dev + server sharing one DB): the scada_archives
month row is INSERTed first as an atomic claim (ON CONFLICT DO NOTHING);
the loser skips. A failed upload deletes its claim so the next day retries.

Ring-mode tags (store_enabled off) are naturally absent here — the bridge
prunes them to their newest 100 rows, so they never age into the window.
"""

import asyncio
import io
import logging
import os
from datetime import date, datetime, timedelta, timezone

from sqlalchemy import delete, func, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from db.models.scada import ScadaArchive, ScadaSample, ScadaTag

logger = logging.getLogger(__name__)

RETENTION_DAYS = int(os.getenv("ARCHIVE_RETENTION_DAYS", "90"))
CHECK_EVERY_S = int(os.getenv("ARCHIVE_CHECK_EVERY_S", str(6 * 3600)))
ENABLED = os.getenv("ARCHIVER_ENABLED", "1") not in ("0", "false", "False")
ROOT_FOLDER_NAME = "R-Net Arsip"

XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"


def _month_start(d: date) -> date:
    return d.replace(day=1)


def _next_month(d: date) -> date:
    return (d.replace(day=28) + timedelta(days=4)).replace(day=1)


def _safe_sheet_title(label: str, taken: set[str]) -> str:
    """Excel worksheet titles: max 31 chars, no []:*?/\\, unique."""
    clean = "".join(c for c in label if c not in "[]:*?/\\").strip() or "Sensor"
    title = clean[:31]
    n = 2
    while title in taken:
        suffix = f" ({n})"
        title = clean[: 31 - len(suffix)] + suffix
        n += 1
    taken.add(title)
    return title


async def _months_to_archive(db: AsyncSession) -> list[date]:
    """Calendar months whose LAST day is already outside the retention
    window and that have no completed archive row yet."""
    cutoff = (
        datetime.now(timezone.utc) - timedelta(days=RETENTION_DAYS)
    ).date()
    oldest_ts = (await db.execute(select(func.min(ScadaSample.ts)))).scalar_one_or_none()
    if oldest_ts is None:
        return []
    done = {
        row[0]
        for row in (
            await db.execute(
                select(ScadaArchive.month).where(
                    ScadaArchive.drive_file_id.is_not(None)
                )
            )
        ).all()
    }
    months: list[date] = []
    m = _month_start(oldest_ts.date())
    while _next_month(m) <= cutoff:  # month fully outside the window
        if m not in done:
            months.append(m)
        m = _next_month(m)
    return months


async def _build_workbook(db: AsyncSession, month: date) -> tuple[bytes, int]:
    """One xlsx for the month: worksheet per tag, columns Waktu (UTC) | Nilai."""
    from openpyxl import Workbook

    start = datetime(month.year, month.month, 1, tzinfo=timezone.utc)
    nm = _next_month(month)
    end = datetime(nm.year, nm.month, 1, tzinfo=timezone.utc)

    tags = (
        (
            await db.execute(
                select(ScadaTag).order_by(ScadaTag.created_at)
            )
        )
        .scalars()
        .all()
    )

    wb = Workbook(write_only=True)
    taken: set[str] = set()
    total = 0
    for tag in tags:
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
            continue
        ws = wb.create_sheet(title=_safe_sheet_title(tag.label, taken))
        unit = f" ({tag.unit})" if tag.unit else ""
        ws.append(["Waktu (UTC)", f"Nilai{unit}"])
        for ts, value in rows:
            ws.append([ts.replace(tzinfo=None), value])
        total += len(rows)

    if total == 0:
        return b"", 0
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue(), total


async def archive_month(db: AsyncSession, month: date) -> dict | None:
    """Claim → export → upload → mark complete → purge. Returns a summary
    dict, or None when another backend holds the claim / month is empty."""
    from app.services import gdrive
    from app.config import settings

    file_name = f"R-Net {month.strftime('%Y-%m')}.xlsx"

    # Atomic claim — the PK makes double-archiving impossible.
    claimed = await db.execute(
        pg_insert(ScadaArchive)
        .values(month=month, file_name=file_name)
        .on_conflict_do_nothing(index_elements=["month"])
        .returning(ScadaArchive.month)
    )
    await db.commit()
    if claimed.scalar_one_or_none() is None:
        row = await db.get(ScadaArchive, month)
        if row is not None and row.drive_file_id is None:
            # Stale claim from a crashed run (>1 day old) — release it so
            # tomorrow's pass can retry.
            age = datetime.now(timezone.utc) - row.created_at
            if age > timedelta(days=1):
                await db.delete(row)
                await db.commit()
        return None

    try:
        content, row_count = await _build_workbook(db, month)
        if row_count == 0:
            # Nothing in this month — keep the row as a completed no-op so we
            # don't re-scan it forever.
            row = await db.get(ScadaArchive, month)
            row.drive_file_id = "(kosong)"
            await db.commit()
            return {"month": str(month), "rows": 0}

        year_folder = await gdrive.find_or_create_folder(
            ROOT_FOLDER_NAME, settings.google_drive_root_folder_id
        )
        year_folder = await gdrive.find_or_create_folder(
            str(month.year), year_folder
        )
        uploaded = await gdrive.upload_file_sync(
            content, file_name, XLSX_MIME, year_folder
        )

        row = await db.get(ScadaArchive, month)
        row.drive_file_id = uploaded.get("id") or ""
        row.web_link = uploaded.get("webViewLink")
        row.row_count = row_count
        await db.commit()

        # Only now is deletion allowed — the archive is verifiably on Drive.
        start = datetime(month.year, month.month, 1, tzinfo=timezone.utc)
        nm = _next_month(month)
        end = datetime(nm.year, nm.month, 1, tzinfo=timezone.utc)
        purged = await db.execute(
            delete(ScadaSample).where(
                ScadaSample.ts >= start, ScadaSample.ts < end
            )
        )
        await db.commit()
        logger.info(
            "Arsip %s: %d baris → Drive (%s), %d baris dihapus dari DB",
            month, row_count, uploaded.get("id"), purged.rowcount,
        )
        return {
            "month": str(month),
            "rows": row_count,
            "drive_file_id": uploaded.get("id"),
            "web_link": uploaded.get("webViewLink"),
        }
    except Exception:
        logger.exception("Arsip %s gagal — klaim dilepas, dicoba lagi nanti", month)
        # Release the claim; data stays untouched until the archive succeeds.
        row = await db.get(ScadaArchive, month)
        if row is not None and row.drive_file_id is None:
            await db.delete(row)
            await db.commit()
        return None


async def archive_once(db: AsyncSession) -> list[dict]:
    results = []
    for month in await _months_to_archive(db):
        res = await archive_month(db, month)
        if res:
            results.append(res)
    return results


async def archiver_loop() -> None:
    """Runs for the app's lifetime (started from main.py lifespan)."""
    from db.session import async_session_factory

    logger.info(
        "Archiver active — retention %dd, check every %dh",
        RETENTION_DAYS,
        CHECK_EVERY_S // 3600,
    )
    while True:
        await asyncio.sleep(CHECK_EVERY_S)
        try:
            async with async_session_factory() as db:
                await archive_once(db)
        except Exception:
            logger.exception("Archiver iteration failed")
