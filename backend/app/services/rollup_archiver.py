"""Summary-lane archiver — ONE MONTH → per-plant .zip of CSVs → Drive → droppable.

WHY THIS EXISTS AT ALL

    R-Net has two long-lived lanes and until now only one of them was finished:

        scada_samples    "Simpan data" sensors  -> archiver.py, xlsx, then wiped
        scada_rollup_1m  EVERY sensor, 1 minute -> nothing

    The second is the one the whole design leans on: raw values survive 24-48 h,
    so once those day-drawers are dropped the per-minute summary IS the history
    of that period — for every sensor, whether or not anybody ticked "Simpan
    data". That is exactly why partitions.ROLLUP_KEEP_MONTHS shipped as 0 with
    the note "phase 6 turns it on": deleting it without a copy elsewhere would
    be deleting the only copy. Phase 6 then built per-plant archiving for
    scada_samples and stopped there, so the knob stayed at 0 and the lane grew
    without bound (359 B/row measured; ~233 GB/month projected at 50 plants).

    This module is the missing half. With it, ROLLUP_KEEP_MONTHS can finally be
    turned on, because a month is only ever dropped after it is on Drive.

THE RULE, UNCHANGED FROM archiver.py

    NO SUCCESSFUL ARCHIVE -> NO DELETION.

    Nothing here deletes anything. It only fills in drive_file_id, and
    partitions.drop_expired_rollup refuses to drop a month until every plant
    bucket for that month has it filled. If Drive is down or unconfigured, the
    claim is released, the month simply stays in the database, and a later pass
    tries again. Storage grows; data never disappears.

WHY .zip OF CSV AND NOT .xlsx

    A plant-month is far bigger than a sample cycle: 300 sensors x 43 200
    minutes = ~13 M rows. As xlsx that is hundreds of MB and openpyxl has to
    build every cell. As one CSV per sensor inside a deflated zip it streams
    straight through, compresses ~8-10x (summary columns are highly repetitive),
    and opens in Excel, Sheets, pandas or a text editor without anything
    special. One file per PLANT keeps the D-8 rule from archiver.py: a due month
    means one upload and one email per plant, not one per sensor.

WHY GROUPING IS BY THE TAG'S CURRENT PLANT

    scada_rollup_1m.site_id is stamped at write time, so a sensor moved between
    plants has old rows carrying the old plant. Buckets are therefore built from
    scada_tags (the live mapping) and rows are selected BY TAG, not by the
    stamped site_id. Every row is reachable that way regardless of what is
    stamped on it — grouping by the stamped column instead would strand exactly
    those rows in a bucket nobody iterates, and they would block the drop
    forever. The stamped column is used only to name things.

    Every rollup row's tag_id is a live tag: the FK is ON DELETE CASCADE, so a
    deleted sensor takes its summary rows with it. There is no orphan case.

DOUBLE-RUN SAFETY (laptop dev + server sharing one DB)
    The unique (plant, month) index is claimed by INSERT first; the loser skips
    that bucket. A failed upload deletes its own claim so a later pass retries.
"""

import asyncio
import io
import logging
import os
import uuid
import zipfile
from datetime import date, datetime, timedelta, timezone

from sqlalchemy import select, text
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.services import partitions
from db.models.scada import ScadaRollupArchive, ScadaSite, ScadaTag

logger = logging.getLogger(__name__)

CHECK_EVERY_S = int(os.getenv("ROLLUP_ARCHIVE_CHECK_EVERY_S", str(6 * 3600)))
ENABLED = os.getenv("ROLLUP_ARCHIVER_ENABLED", "1") not in ("0", "false", "False")
ROOT_FOLDER_NAME = "R-Net Arsip"
SUB_FOLDER_NAME = "Ringkasan-1-menit"

# Rows pulled per keyset page while streaming one sensor's month.
CHUNK_ROWS = int(os.getenv("ROLLUP_ARCHIVE_CHUNK_ROWS", "50000"))
# Months handled per pass. Oldest first, so a long backlog drains in order and
# the database shrinks from the far end.
MAX_MONTHS_PER_RUN = int(os.getenv("ROLLUP_ARCHIVE_MAX_MONTHS_PER_RUN", "1"))
# Plant buckets per pass, same reasoning as archiver.MAX_PLANTS_PER_RUN: a due
# month must not turn into 50 uploads back to back.
MAX_PLANTS_PER_RUN = int(os.getenv("ROLLUP_ARCHIVE_MAX_PLANTS_PER_RUN", "3"))
# Past this, the email carries the Drive link instead of the attachment.
EMAIL_ATTACH_MAX_B = (
    int(os.getenv("ROLLUP_ARCHIVE_EMAIL_ATTACH_MAX_MB", "15")) * 1024 * 1024
)
# gdrive.upload_file() buffers the whole file in memory so retries can restart
# from byte 0. Above this we only warn — refusing to upload would mean refusing
# to ever free the month, which is worse.
BIG_FILE_WARN_B = int(os.getenv("ROLLUP_ARCHIVE_BIG_WARN_MB", "200")) * 1024 * 1024

ZIP_MIME = "application/zip"

NULL_BUCKET = "-"  # dict key for "sensors with no plant"


def safe_name(label: str, fallback: str = "Sensor") -> str:
    """Filesystem/zip-safe name. Zip entries are extracted on Windows machines,
    so the Windows-illegal set is what matters, not just the POSIX one."""
    clean = "".join("_" if c in '<>:"/\\|?*' else c for c in label)
    clean = "".join(c for c in clean if c >= " ").strip().rstrip(".")
    return clean[:80] or fallback


def unique_names(labels: list[str]) -> list[str]:
    """Two sensors may share a label — 'Holding' appears three times in the live
    database — and two entries with the same name in one zip is a corrupt zip on
    some extractors and a silent overwrite on others."""
    seen: dict[str, int] = {}
    out: list[str] = []
    for label in labels:
        base = safe_name(label)
        key = base.lower()
        if key not in seen:
            seen[key] = 1
            out.append(base)
            continue
        seen[key] += 1
        out.append(f"{base} ({seen[key]})")
    return out


def month_bounds(month: date) -> tuple[datetime, datetime]:
    """[first instant of the month, first instant of the next) in UTC."""
    lo = datetime(month.year, month.month, 1, tzinfo=timezone.utc)
    hi = (
        lo.replace(year=lo.year + 1, month=1)
        if lo.month == 12
        else lo.replace(month=lo.month + 1)
    )
    return lo, hi


async def eligible_months(db, now: datetime) -> list[date]:
    """Summary months entirely older than the retention window, oldest first.

    Reads ROLLUP_KEEP_MONTHS off the partitions module at call time (not import
    time) so the retention knob has exactly one home and tests can pin it.
    Returns [] when retention is off — with nothing ever dropped there is
    nothing to make safe, and uploading months that will never be freed is just
    Drive quota."""
    keep = partitions.ROLLUP_KEEP_MONTHS
    if keep <= 0:
        return []
    cutoff = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    for _ in range(keep):
        cutoff = (
            cutoff.replace(year=cutoff.year - 1, month=12)
            if cutoff.month == 1
            else cutoff.replace(month=cutoff.month - 1)
        )
    names = await partitions._partitions(db, "scada\\_rollup\\_1m\\_%")
    months: list[date] = []
    for name in names:
        m = partitions._ROLLUP_RE.match(name)
        if not m:
            continue
        month = date(int(m[1]), int(m[2]), 1)
        if datetime(month.year, month.month, 1, tzinfo=timezone.utc) < cutoff:
            months.append(month)
    return sorted(months)


async def plant_buckets(db) -> dict[str, tuple[uuid.UUID | None, str, list[ScadaTag]]]:
    """Every sensor in the system, grouped by the plant it belongs to NOW.

    Keyed by str(site_id) (or NULL_BUCKET), value = (site_id, plant name, tags).
    See the module docstring for why the live mapping is used rather than the
    site_id stamped on the summary rows."""
    tags = (await db.execute(select(ScadaTag))).scalars().all()
    sites = {s.id: s for s in (await db.execute(select(ScadaSite))).scalars().all()}

    buckets: dict[str, tuple[uuid.UUID | None, str, list[ScadaTag]]] = {}
    for tag in tags:
        key = str(tag.site_id) if tag.site_id else NULL_BUCKET
        if key not in buckets:
            site = sites.get(tag.site_id) if tag.site_id else None
            name = safe_name(site.name, "Plant").replace(" ", "_") if site else "Tanpa-Plant"
            buckets[key] = (tag.site_id, name, [])
        buckets[key][2].append(tag)
    return buckets


async def stream_tag_month(
    db: AsyncSession, tag_id, lo: datetime, hi: datetime, chunk: int = CHUNK_ROWS
):
    """Yield (ts, avg, min, max, n) for one sensor's month, oldest first.

    Keyset-paged on ts so memory stays flat and page 1000 costs what page 1 did.
    Bounded by ts, so Postgres prunes to the single month partition; ordered
    within a tag, so ix_scada_rollup_1m_tag_ts serves it directly.

    avg/min/max are quoted: they are ordinary column names here, but leaving
    them bare next to aggregate functions of the same name is the kind of thing
    that reads as a bug in six months."""
    sql = text(
        'SELECT ts, "avg", "min", "max", n FROM scada_rollup_1m '
        "WHERE tag_id = :tag AND ts >= :lo AND ts < :hi "
        "ORDER BY ts LIMIT :lim"
    )
    cursor = lo
    while True:
        rows = (
            await db.execute(
                sql, {"tag": tag_id, "lo": cursor, "hi": hi, "lim": chunk}
            )
        ).all()
        if not rows:
            return
        for row in rows:
            yield row
        if len(rows) < chunk:
            return
        # Strictly after the last ts emitted — (ts, tag_id) is unique, so no row
        # can share it and be skipped.
        cursor = rows[-1][0] + timedelta(microseconds=1)


async def build_plant_zip(
    db: AsyncSession, tags: list[ScadaTag], lo: datetime, hi: datetime, path: str
) -> dict:
    """One .zip per plant-month, one CSV per sensor, written to `path`.

    Returns {tag_id: row_count}. A sensor that reported nothing still gets a CSV
    containing only its header — an empty file is information ("this sensor was
    configured and stayed silent all month"), a missing file is ambiguous.

    Values are written with str(), not rounded: Python's float repr is the
    shortest text that round-trips exactly, so the archive is lossless and still
    compact. Rounding here would quietly make the archive disagree with the
    database it replaces."""
    counts: dict = {}
    with zipfile.ZipFile(path, "w", compression=zipfile.ZIP_DEFLATED, allowZip64=True) as zf:
        for tag, name in zip(tags, unique_names([t.label for t in tags])):
            unit = f" ({tag.unit})" if tag.unit else ""
            n = 0
            with zf.open(f"{name}.csv", "w") as raw:
                out = io.TextIOWrapper(raw, encoding="utf-8", newline="")
                out.write(
                    f"waktu_utc,rata{unit},min{unit},maks{unit},jumlah_data\n"
                )
                async for ts, avg, mn, mx, cnt in stream_tag_month(db, tag.id, lo, hi):
                    out.write(
                        f"{ts:%Y-%m-%d %H:%M},{avg},{mn},{mx},{cnt}\n"
                    )
                    n += 1
                out.flush()
                out.detach()  # don't let the wrapper close the zip member twice
            counts[tag.id] = n
    return counts


async def _email_plant_month(
    db: AsyncSession,
    plant: str,
    month: date,
    tags: list[ScadaTag],
    counts: dict,
    file_name: str,
    content: bytes,
    web_link: str | None,
) -> None:
    """One email per plant per month. Never raises — the file is already on
    Drive, so a mail failure must not block the month from becoming droppable.

    Gated only on "are there recipients", matching archiver.py: email_enabled
    governs alarm noisiness, and a retention report has to arrive regardless."""
    from app.services import email_notifier, notifier

    try:
        alarm_settings = await notifier.get_settings(db)
        recipients = alarm_settings.email_recipients if alarm_settings else ""
        if not recipients.strip():
            logger.info(
                "Arsip ringkasan %s %s: penerima email kosong - email dilewati",
                plant,
                month,
            )
            return
        quiet = [t for t in tags if counts.get(t.id, 0) == 0]
        lines = "\n".join(
            f"  - {t.label}{(' (' + t.unit + ')') if t.unit else ''}: "
            f"{counts.get(t.id, 0):,} menit"
            for t in tags
        )
        drive_line = (
            f"Salinan tersimpan di Google Drive: {web_link}"
            if web_link
            else "Salinan Google Drive: (upload dilewati - bulan ini kosong)"
        )
        body = (
            f"Arsip ringkasan per-menit R-Net untuk plant '{plant}'.\n\n"
            f"Bulan   : {month:%m-%Y}\n"
            f"Sensor  : {len(tags)} (satu file CSV per sensor di dalam .zip)\n"
            f"Total   : {sum(counts.values()):,} baris menit\n"
            f"File    : {file_name}\n\n"
            f"Rincian per sensor:\n{lines}\n\n"
            + (
                f"Catatan: {len(quiet)} sensor tidak mengirim data sama sekali "
                f"bulan ini (file CSV-nya hanya berisi judul kolom).\n\n"
                if quiet
                else ""
            )
            + f"{drive_line}\n\n"
            f"Setelah SEMUA plant untuk bulan ini selesai diarsipkan, data bulan "
            f"tersebut dihapus dari database. Data yang lebih baru tidak "
            f"tersentuh."
        )
        attach = (file_name, content) if 0 < len(content) <= EMAIL_ATTACH_MAX_B else None
        if content and attach is None:
            body += (
                f"\n\n(File {len(content)/1024/1024:.1f} MB terlalu besar untuk "
                f"dilampirkan - ambil dari tautan Google Drive di atas.)"
            )
        await email_notifier.send_to_list(
            recipients,
            subject=f"Arsip ringkasan R-Net: {plant} ({month:%m-%Y})",
            body=body,
            attachment=attach,
        )
    except Exception:
        logger.exception(
            "Email arsip ringkasan %s %s gagal - arsip tetap sah", plant, month
        )


async def archive_plant_month(
    db: AsyncSession,
    site_id,
    plant: str,
    tags: list[ScadaTag],
    month: date,
) -> dict | None:
    """Claim one (plant, month) bucket, export it, upload it, mark it done.

    Returns None when another backend already owns the bucket, or when anything
    failed — in which case the claim is released and NOTHING has been deleted,
    because this function never deletes. Dropping the month is a separate,
    later decision made by partitions.drop_expired_rollup, and only once every
    bucket of the month is marked done here.
    """
    import os as _os
    import tempfile

    from app.config import settings as app_settings
    from app.services import gdrive

    lo, hi = month_bounds(month)
    file_name = f"{plant}-ringkasan-{month:%Y_%m}.zip"

    res = await db.execute(
        pg_insert(ScadaRollupArchive)
        .values(
            id=uuid.uuid4(),
            site_id=site_id,
            plant=plant,
            month=month,
            file_name=file_name,
        )
        .on_conflict_do_nothing()
        .returning(ScadaRollupArchive.id)
    )
    archive_id = res.scalar_one_or_none()
    await db.commit()
    if archive_id is None:
        return None  # already claimed (this pass's peer, or an earlier pass)

    tmp_path = None
    try:
        fd, tmp_path = tempfile.mkstemp(suffix=".zip", prefix="rnet-ringkasan-")
        _os.close(fd)
        counts = await build_plant_zip(db, tags, lo, hi, tmp_path)
        total_rows = sum(counts.values())

        if total_rows > 0:
            folder = await gdrive.find_or_create_folder(
                ROOT_FOLDER_NAME, app_settings.google_drive_root_folder_id
            )
            folder = await gdrive.find_or_create_folder(SUB_FOLDER_NAME, folder)
            folder = await gdrive.find_or_create_folder(str(month.year), folder)
            size = _os.path.getsize(tmp_path)
            if size > BIG_FILE_WARN_B:
                logger.warning(
                    "Arsip ringkasan %s %s berukuran %.0f MB - upload menahannya "
                    "di memori; pertimbangkan menurunkan "
                    "ROLLUP_ARCHIVE_MAX_PLANTS_PER_RUN atau memecah plant.",
                    plant, month, size / 1024 / 1024,
                )
            with open(tmp_path, "rb") as fh:
                content = fh.read()
            uploaded = await gdrive.upload_file_sync(
                content, file_name, ZIP_MIME, folder
            )
            drive_id = uploaded.get("id") or ""
            web_link = uploaded.get("webViewLink")
            if not drive_id:
                # An upload that returns no id is not a verified copy, and this
                # row is the ONLY thing standing between the month and a DROP.
                raise RuntimeError("Drive tidak mengembalikan file id")
        else:
            # Nothing to upload. Record a completed no-op so this bucket stops
            # blocking the month forever.
            content, drive_id, web_link = b"", "(kosong)", None

        row = await db.get(ScadaRollupArchive, archive_id)
        row.drive_file_id = drive_id
        row.web_link = web_link
        row.row_count = total_rows
        row.tag_count = len(tags)
        await db.commit()

        if total_rows > 0:
            await _email_plant_month(
                db, plant, month, tags, counts, file_name, content, web_link
            )

        logger.info(
            "Arsip ringkasan %s %s: %d sensor, %d baris -> Drive (%s)",
            plant, month, len(tags), total_rows, drive_id,
        )
        return {
            "site_id": str(site_id) if site_id else None,
            "plant": plant,
            "month": month.isoformat(),
            "file_name": file_name,
            "tags": len(tags),
            "rows": total_rows,
            "drive_file_id": drive_id,
            "web_link": web_link,
        }
    except Exception:
        logger.exception(
            "Arsip ringkasan %s %s gagal - klaim dilepas, bulan TIDAK dihapus",
            plant, month,
        )
        row = await db.get(ScadaRollupArchive, archive_id)
        if row is not None and row.drive_file_id is None:
            await db.delete(row)
        await db.commit()
        return None
    finally:
        if tmp_path and _os.path.exists(tmp_path):
            _os.unlink(tmp_path)


async def archive_once(db: AsyncSession, now: datetime | None = None) -> list[dict]:
    """One pass: archive whatever plant buckets of expired months are still open.

    Capped by MAX_MONTHS_PER_RUN x MAX_PLANTS_PER_RUN so a first run against
    months of backlog drains steadily instead of uploading everything at once.
    A month becomes droppable only when it runs out of open buckets, which may
    take several passes — that is fine, the check is idempotent and cheap.
    """
    now = now or datetime.now(timezone.utc)
    months = (await eligible_months(db, now))[:MAX_MONTHS_PER_RUN]
    if not months:
        return []

    buckets = await plant_buckets(db)
    results: list[dict] = []
    budget = MAX_PLANTS_PER_RUN
    for month in months:
        done = await completed_buckets(db, month)
        # Deterministic order so a repeatedly-failing plant cannot starve the
        # others: the same sort every pass, and finished buckets drop out.
        for key in sorted(buckets):
            if budget <= 0:
                return results
            if key in done:
                continue
            site_id, plant, tags = buckets[key]
            res = await archive_plant_month(db, site_id, plant, tags, month)
            budget -= 1
            if res:
                results.append(res)
    return results


async def completed_buckets(db: AsyncSession, month: date) -> set[str]:
    """Bucket keys already verifiably on Drive for `month`."""
    rows = await db.execute(
        text(
            "SELECT site_id FROM scada_rollup_archives "
            "WHERE month = :m AND drive_file_id IS NOT NULL"
        ),
        {"m": month},
    )
    return {str(r[0]) if r[0] else NULL_BUCKET for r in rows.all()}


async def fully_archived_months(db) -> set[date]:
    """Months where EVERY current plant bucket is on Drive — i.e. the months
    partitions.drop_expired_rollup is allowed to delete.

    Both sides of the comparison are cheap: scada_tags is a small table and the
    ledger has one row per (plant, month). Nothing scans the summary lane
    itself, which is the point — that table is the large one.

    Buckets are recomputed every pass on purpose. Add a plant tomorrow and a
    month that looked finished stops being droppable until that plant's (empty)
    bucket is written too. That is the conservative direction: the failure mode
    is "kept longer than intended", never "deleted without a copy"."""
    wanted = set(await plant_buckets(db))
    if not wanted:
        return set()
    rows = await db.execute(
        text(
            "SELECT month, site_id FROM scada_rollup_archives "
            "WHERE drive_file_id IS NOT NULL"
        )
    )
    have: dict[date, set[str]] = {}
    for month, site_id in rows.all():
        have.setdefault(month, set()).add(str(site_id) if site_id else NULL_BUCKET)
    return {m for m, keys in have.items() if wanted <= keys}


async def archiver_loop() -> None:
    """Runs for the app's lifetime (started from main.py lifespan). One failed
    iteration must never kill the loop."""
    from db.session import async_session_factory

    logger.info(
        "Arsip ringkasan aktif - cek tiap %dh, simpan %d bulan di database",
        CHECK_EVERY_S // 3600,
        partitions.ROLLUP_KEEP_MONTHS,
    )
    while True:
        await asyncio.sleep(CHECK_EVERY_S)
        try:
            async with async_session_factory() as db:
                await archive_once(db)
        except Exception:
            logger.exception("Rollup archiver iteration failed")
