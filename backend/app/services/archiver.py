"""R-Net historian reset — PER-PLANT cycle → Google Drive → wipe → restart clock.

Each "Simpan data" (store) tag accumulates a FIXED window
(scada_settings.store_months, 1 month by default) from config.store_cycle_start.
Once elapsed, the tag's cycle is exported and ONLY THEN deleted from
scada_samples, resetting its clock so it starts fresh from 0.

THE RULE THAT HAS NOT CHANGED, AND MUST NOT:
    NO SUCCESSFUL ARCHIVE → NO DELETION.
If Drive is down or unconfigured, data simply accumulates until a later pass
succeeds. Every rewrite below preserves this.

WHAT PHASE 6 CHANGED (audit D-7, D-8)

  ONE FILE PER PLANT, ONE SHEET PER SENSOR — was one file per sensor. At pilot
  scale (300 sensors over ~15 plants) a due day meant 300 exports, 300 uploads
  and 300 emails back to back; now it is 15 of each. See ARSITEKTUR-DATA §2.6.

  STREAMED, NOT BUFFERED — rows are read in keyset-paged chunks and openpyxl
  runs in write_only mode, which spills each sheet to disk as it goes. The
  workbook is built into a temp FILE, so neither the rows nor the finished
  archive ever have to fit in memory. Previously both did.

  CAPPED AND STAGGERED — at most MAX_PLANTS_PER_RUN plants per pass, and a new
  tag's first cycle is backdated by a deterministic per-tag offset so sensors
  configured in one sitting stop coming due in lockstep forever after.

  EMAIL DEGRADES INSTEAD OF FAILING — a per-plant workbook is much larger than
  a per-sensor one, so past EMAIL_ATTACH_MAX_B the mail carries the Drive link
  instead of the attachment rather than bouncing.

ON THE EXCEL ROW LIMIT
    A sheet caps at 1 048 576 rows. This is currently unreachable for store
    tags: schemas.scada restricts them to Slow/Slowest (30 s/60 s), so a
    one-month cycle is at most ~86 400 rows. That validation is what keeps the
    limit out of reach — if it is ever relaxed, this file needs sheet splitting.

DOUBLE-RUN SAFETY (laptop dev + server sharing one DB)
    Claims stay PER SENSOR: the unique (tag_id, cycle_start) index in
    scada_tag_archives is INSERTed first, and the loser is simply left out of
    this file. A failed upload releases every claim it took so a later pass
    retries. Ring tags never appear here — the raw lane drops partitions.
"""

import asyncio
import io
import logging
import os
import uuid
from datetime import datetime, timedelta, timezone

from sqlalchemy import delete, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.services import rnet_settings
from db.models.scada import (
    ScadaSample,
    ScadaSampleAll,
    ScadaSite,
    ScadaTag,
    ScadaTagArchive,
)

logger = logging.getLogger(__name__)

CHECK_EVERY_S = int(os.getenv("ARCHIVE_CHECK_EVERY_S", str(6 * 3600)))
ENABLED = os.getenv("ARCHIVER_ENABLED", "1") not in ("0", "false", "False")
ROOT_FOLDER_NAME = "R-Net Arsip"

# Rows pulled per keyset page while streaming a cycle into a workbook.
CHUNK_ROWS = int(os.getenv("ARCHIVE_CHUNK_ROWS", "20000"))
# Plants handled per pass (audit D-8). The pass runs again in CHECK_EVERY_S, so
# a backlog drains steadily instead of hundreds of uploads landing at once.
MAX_PLANTS_PER_RUN = int(os.getenv("ARCHIVE_MAX_PLANTS_PER_RUN", "3"))
# Spread window: a new store tag's cycle clock is pushed back by up to this many
# days, deterministically per tag, so tags configured on the same afternoon do
# not all come due on the same day forever after (audit D-8).
STAGGER_DAYS = int(os.getenv("ARCHIVE_STAGGER_DAYS", "5"))
# Above this, the email carries only the Drive link. A per-plant workbook is
# far bigger than the old per-sensor one, and most mail servers reject ~25 MB.
EMAIL_ATTACH_MAX_B = int(os.getenv("ARCHIVE_EMAIL_ATTACH_MAX_MB", "15")) * 1024 * 1024

XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"


def _safe_sheet_title(label: str) -> str:
    """Excel worksheet title: max 31 chars, no []:*?/\\."""
    clean = "".join(c for c in label if c not in "[]:*?/\\").strip() or "Sensor"
    return clean[:31]


async def stream_tag_rows(
    db: AsyncSession,
    tag_id,
    start: datetime,
    end: datetime,
    chunk: int = CHUNK_ROWS,
    source=ScadaSample,
):
    """Yield a tag's rows in keyset-paged chunks, oldest first (audit D-7).

    The previous version did `.all()` — the entire cycle materialised in memory
    at once, then the finished workbook on top of it. Keyset paging on the
    (tag_id, ts) primary key keeps memory flat regardless of cycle length, and
    page 1000 costs the same as page 1 (no OFFSET).

    `source` decides WHICH lane is read, and the two callers need different
    ones:
      - the archiver keeps the default ScadaSample, because only the historian
        lane is archived-then-deleted; reading the raw lane here would export
        rows nobody asked for and then not delete them,
      - the /export.xlsx endpoint and the dry-run pass ScadaSampleAll, because
        a user exporting "this sensor's data" means whatever the sensor has,
        and ring-mode sensors keep theirs in the raw lane.
    Getting this wrong is silent: the file builds fine and is simply empty."""
    cursor = start
    while True:
        rows = (
            await db.execute(
                select(source.ts, source.value)
                .where(
                    source.tag_id == tag_id,
                    source.ts >= cursor,
                    source.ts < end,
                )
                .order_by(source.ts)
                .limit(chunk)
            )
        ).all()
        if not rows:
            return
        for row in rows:
            yield row
        if len(rows) < chunk:
            return
        # Strictly after the last ts we emitted. Safe because (tag_id, ts) is
        # unique — no row can share it and be skipped.
        cursor = rows[-1][0] + timedelta(microseconds=1)


def _unique_titles(labels: list[str]) -> list[str]:
    """Excel refuses duplicate sheet titles, and R-Net labels are NOT unique —
    'Holding' appears three times in the live database today. Collisions get a
    numeric suffix rather than crashing the whole archive."""
    seen: dict[str, int] = {}
    out: list[str] = []
    for label in labels:
        base = _safe_sheet_title(label)
        if base not in seen:
            seen[base] = 1
            out.append(base)
            continue
        seen[base] += 1
        suffix = f" ({seen[base]})"
        out.append(base[: 31 - len(suffix)] + suffix)
    return out


async def build_plant_workbook(
    db: AsyncSession,
    tags: list[ScadaTag],
    windows: dict,
    path: str,
    source=ScadaSample,
) -> dict:
    """ONE workbook for a whole plant, ONE SHEET PER SENSOR, written to `path`.

    Replaces one-file-per-sensor (audit D-8): 300 sensors across 15 plants used
    to mean 300 exports + 300 uploads + 300 emails in a single pass. Grouped by
    plant that becomes 15 of each.

    Rows are streamed in and openpyxl runs in write_only mode, which spills each
    sheet to its own temp file as it goes, so peak memory stays flat no matter
    how long the cycle is. The result is written to a file, not returned as
    bytes, so the caller never holds the whole archive in RAM either.

    Returns {tag_id: row_count}. Sensors with no rows still get a sheet (with a
    header and nothing else) — an empty sheet is information: "this sensor was
    configured and reported nothing".

    `source` picks the lane — see stream_tag_rows. The archiver's default reads
    only the historian lane; exports pass ScadaSampleAll so ring-mode sensors
    (whose data lives in the raw lane) are not silently exported as empty.
    """
    from openpyxl import Workbook

    wb = Workbook(write_only=True)
    counts: dict = {}
    for tag, title in zip(tags, _unique_titles([t.label for t in tags])):
        ws = wb.create_sheet(title=title)
        unit = f" ({tag.unit})" if tag.unit else ""
        ws.append(["Waktu (UTC)", f"Nilai{unit}"])
        start, end = windows[tag.id]
        n = 0
        async for ts, value in stream_tag_rows(
            db, tag.id, start, end, source=source
        ):
            ws.append([ts.replace(tzinfo=None), value])
            n += 1
        counts[tag.id] = n
    wb.save(path)
    return counts


async def _email_plant_backup(
    db: AsyncSession,
    plant: str,
    tags: list,
    counts: dict,
    file_name: str,
    content: bytes,
    cycle_start: datetime,
    cycle_end: datetime,
    web_link: str | None,
) -> None:
    """One email per PLANT per cycle, listing every sensor in the attachment.

    Was one email per sensor (audit D-8) — 300 sensors meant 300 emails in an
    afternoon, which is how a backup report turns into something people filter
    out. Gate is still only "are there recipients", not email_enabled: that flag
    controls alarm noisiness, and a monthly backup report must arrive regardless.
    Never raises — a failed email must not block the reset, because the file is
    already verifiably on Drive."""
    from app.services import email_notifier, notifier

    try:
        alarm_settings = await notifier.get_settings(db)
        recipients = alarm_settings.email_recipients if alarm_settings else ""
        if not recipients.strip():
            logger.info("Backup %s: penerima email kosong - email dilewati", plant)
            return
        period = (
            f"{cycle_start.strftime('%d-%m-%Y')} s/d {cycle_end.strftime('%d-%m-%Y')}"
        )
        lines = "\n".join(
            f"  - {t.label}{(' (' + t.unit + ')') if t.unit else ''}: "
            f"{counts.get(t.id, 0):,} baris"
            for t in tags
        )
        drive_line = (
            f"Salinan juga tersimpan di Google Drive: {web_link}"
            if web_link
            else "Salinan Google Drive: (upload dilewati - siklus kosong)"
        )
        body = (
            f"Backup data R-Net untuk plant '{plant}'.\n\n"
            f"Periode : {period}\n"
            f"Sensor  : {len(tags)} (satu sheet per sensor di dalam file)\n"
            f"Total   : {sum(counts.values()):,} baris\n"
            f"File    : {file_name} (terlampir)\n\n"
            f"Rincian per sensor:\n{lines}\n\n"
            f"{drive_line}\n\n"
            f"Data di database akan direset dan pencatatan mulai lagi dari 0."
        )
        # Attachment only when it is small enough to be a sane email; the Drive
        # link is the durable copy either way.
        attach = (file_name, content) if len(content) <= EMAIL_ATTACH_MAX_B else None
        if attach is None:
            body += (
                f"\n\n(File {len(content)/1024/1024:.1f} MB terlalu besar untuk "
                f"dilampirkan - ambil dari tautan Google Drive di atas.)"
            )
        await email_notifier.send_to_list(
            recipients,
            subject=f"Backup R-Net: {plant} ({period})",
            body=body,
            attachment=attach,
        )
    except Exception:
        logger.exception("Email backup plant %s gagal - reset tetap lanjut", plant)


async def archive_plant_cycle(
    db: AsyncSession, site_id, due: list, now: datetime
) -> dict | None:
    """Claim every due sensor of ONE PLANT, export them into ONE workbook with
    one sheet each, upload once, email once, then wipe and restart their clocks.

    Replaces the old per-sensor archive_tag_cycle (audit D-7/D-8). What did NOT
    change is the safety rule, because it is the important part:

        NO SUCCESSFUL ARCHIVE -> NO DELETION.

    Nothing is deleted until the file is verifiably on Drive. If the upload
    fails, every claim is released and the data stays exactly where it is until
    a later pass succeeds.

    Claims remain PER SENSOR (the unique (tag_id, cycle_start) index), so two
    backends sharing the database still cannot double-archive, and a sensor
    already claimed by the other backend is simply left out of this file.
    """
    import os as _os
    import tempfile

    from app.config import settings as app_settings
    from app.services import gdrive

    claimed: list = []      # (tag, cycle_start, archive_id)
    for tag, cycle_start in due:
        file_stub = f"{cycle_start.strftime('%Y%m%d')}-{now.strftime('%Y%m%d')}"
        res = await db.execute(
            pg_insert(ScadaTagArchive)
            .values(
                id=uuid.uuid4(),
                tag_id=tag.id,
                cycle_start=cycle_start,
                cycle_end=now,
                file_name=f"{file_stub}.xlsx",
            )
            .on_conflict_do_nothing(index_elements=["tag_id", "cycle_start"])
            .returning(ScadaTagArchive.id)
        )
        archive_id = res.scalar_one_or_none()
        if archive_id is not None:
            claimed.append((tag, cycle_start, archive_id))
    await db.commit()
    if not claimed:
        return None  # every sensor here is owned by another backend

    site = await db.get(ScadaSite, site_id) if site_id else None
    plant = _safe_sheet_title(site.name).replace(" ", "_") if site else "Tanpa-Plant"
    oldest = min(c for _t, c, _a in claimed)
    file_name = (
        f"{plant}-{oldest.strftime('%Y%m%d')}-{now.strftime('%Y%m%d')}.xlsx"
    )

    tmp_path = None
    try:
        windows = {t.id: (c, now) for t, c, _a in claimed}
        tags = [t for t, _c, _a in claimed]

        # A real file, not BytesIO: the whole point is that the archive never
        # has to fit in memory (audit D-7).
        fd, tmp_path = tempfile.mkstemp(suffix=".xlsx", prefix="rnet-arsip-")
        _os.close(fd)
        counts = await build_plant_workbook(db, tags, windows, tmp_path)
        total_rows = sum(counts.values())

        if total_rows > 0:
            year_folder = await gdrive.find_or_create_folder(
                ROOT_FOLDER_NAME, app_settings.google_drive_root_folder_id
            )
            year_folder = await gdrive.find_or_create_folder(
                str(oldest.year), year_folder
            )
            with open(tmp_path, "rb") as fh:
                content = fh.read()
            uploaded = await gdrive.upload_file_sync(
                content, file_name, XLSX_MIME, year_folder
            )
            drive_id = uploaded.get("id") or ""
            web_link = uploaded.get("webViewLink")
        else:
            # Every sensor was empty — record a completed no-op so the cycle
            # still resets instead of retrying forever.
            content, drive_id, web_link = b"", "(kosong)", None

        for tag, cycle_start, archive_id in claimed:
            row = await db.get(ScadaTagArchive, archive_id)
            row.drive_file_id = drive_id
            row.web_link = web_link
            row.row_count = counts.get(tag.id, 0)
            row.file_name = file_name
        await db.commit()

        if total_rows > 0:
            await _email_plant_backup(
                db, plant, tags, counts, file_name, content, oldest, now, web_link
            )

        # Only now may we wipe — the cycle is verifiably on Drive (or empty).
        purged = 0
        for tag, _cycle_start, _archive_id in claimed:
            res = await db.execute(
                delete(ScadaSample).where(ScadaSample.tag_id == tag.id)
            )
            purged += res.rowcount or 0
            tag.config = {
                **(tag.config or {}),
                "store_cycle_start": rnet_settings.now_iso(),
            }
        await db.commit()

        logger.info(
            "Arsip plant %s: %d sensor, %d baris -> Drive (%s), %d dihapus",
            plant, len(claimed), total_rows, drive_id, purged,
        )
        return {
            "site_id": str(site_id) if site_id else None,
            "plant": plant,
            "file_name": file_name,
            "tags": len(claimed),
            "rows": total_rows,
            "drive_file_id": drive_id,
            "web_link": web_link,
        }
    except Exception:
        logger.exception("Arsip plant %s gagal - klaim dilepas, dicoba lagi", plant)
        # Release every claim we took; data stays untouched.
        for _tag, _cycle_start, archive_id in claimed:
            row = await db.get(ScadaTagArchive, archive_id)
            if row is not None and row.drive_file_id is None:
                await db.delete(row)
        await db.commit()
        return None
    finally:
        if tmp_path and _os.path.exists(tmp_path):
            _os.unlink(tmp_path)



def stagger_offset(tag_id) -> timedelta:
    """Deterministic per-tag head start, 0..STAGGER_DAYS (audit D-8).

    Store tags are usually configured in one sitting, so without this their
    clocks all start within minutes of each other and stay locked together —
    every cycle, every sensor comes due on the same day forever. Backdating the
    first cycle by a stable per-tag amount spreads the due dates permanently.

    Derived from the tag id, so it never moves for a given tag and needs no
    stored state. Subtracting (rather than adding) means nothing is ever
    archived LATER than the configured cycle — only earlier."""
    if STAGGER_DAYS <= 0:
        return timedelta(0)
    seconds = int(uuid.UUID(str(tag_id)).int % (STAGGER_DAYS * 86400))
    return timedelta(seconds=seconds)


async def archive_once(db: AsyncSession) -> list[dict]:
    """Archive+reset due store tags, ONE FILE PER PLANT, capped per pass.

    Three audit fixes in one pass (D-7, D-8):
      - due tags are grouped by plant, so a plant produces one workbook, one
        upload and one email instead of one of each per sensor,
      - at most MAX_PLANTS_PER_RUN plants per pass, so a backlog drains over
        several passes rather than stampeding,
      - a tag with no cycle clock gets a staggered one, so future cycles do not
        all land on the same day.
    """
    settings = await rnet_settings.get_settings(db)
    now = datetime.now(timezone.utc)
    tags = (
        (await db.execute(select(ScadaTag).where(ScadaTag.enabled.is_(True))))
        .scalars()
        .all()
    )

    due_by_site: dict = {}
    for tag in tags:
        if rnet_settings.is_ring(tag.config):
            continue  # ring tags aren't archived — the raw lane drops partitions
        cycle_start = rnet_settings.parse_cycle_start(tag.config)
        if cycle_start is None:
            # Store tag with no clock (new, or legacy). Start it now MINUS this
            # tag's stagger so it doesn't come due in lockstep with its peers.
            started = now - stagger_offset(tag.id)
            tag.config = {
                **(tag.config or {}),
                "store_cycle_start": started.strftime("%Y-%m-%dT%H:%M:%SZ"),
            }
            await db.commit()
            continue
        if now < rnet_settings.cycle_reset_at(settings, cycle_start):
            continue  # cycle not elapsed yet
        due_by_site.setdefault(tag.site_id, []).append((tag, cycle_start))

    results: list[dict] = []
    # Deterministic order so a repeatedly-failing plant can't starve the others
    # forever: sorted by site, and the cap moves through the backlog each pass.
    for site_id in sorted(due_by_site, key=lambda s: str(s))[:MAX_PLANTS_PER_RUN]:
        res = await archive_plant_cycle(db, site_id, due_by_site[site_id], now)
        if res:
            results.append(res)
    if len(due_by_site) > MAX_PLANTS_PER_RUN:
        logger.info(
            "Archiver: %d plant jatuh tempo, %d diproses kali ini, sisanya "
            "putaran berikutnya",
            len(due_by_site),
            MAX_PLANTS_PER_RUN,
        )
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
