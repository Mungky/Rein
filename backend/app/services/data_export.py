"""On-demand data export — CSV, one file per sensor.

WHAT THIS REPLACED
    An .xlsx builder (openpyxl, one sheet per sensor). It worked, but it was the
    odd one out: the monthly Drive archive next door already writes .zip-of-CSV,
    for reasons written down in docs/ARSITEKTUR-DATA.md §2.6 — CSV streams
    straight through and deflates ~8-10x because summary columns repeat heavily,
    where xlsx has to build every cell as an XML element first. Exporting the
    same rows in the heavier format, from the same database, to the same person,
    made no sense.

    Dropping it also removed the last openpyxl import in the repo.

SHAPE OF THE OUTPUT
    one sensor    ->  a plain .csv     (no zip to open first)
    many sensors  ->  a .zip of CSVs, one per sensor

    Not one wide CSV with a shared time column: sensors sample at different
    rates, so the shared column is mostly empty cells. Not one long CSV with a
    `sensor` column either: that repeats the label on every row, which is the
    opposite of the point.

    Columns match the Drive archive exactly, so a file pulled from here and a
    file pulled from Drive stack without fixing anything up:

        lane=raw     waktu_wib,nilai (C)
        lane=rollup  waktu_wib,rata (C),min (C),maks (C),jumlah_data

TIMESTAMPS ARE LABELLED IN THE DISPLAY ZONE, NOT UTC
    Storage is UTC and stays UTC. But the person opening this file picked their
    range from a calendar showing local time, so a file answering in UTC reads
    as the wrong range: pick "30 Jul 00:00" in WIB and the first row said
    `2026-07-29 17:00:00`. Correct data, correct window, and useless as an
    answer to what was asked.

    Rows are therefore converted using scada_settings.display_timezone, and the
    column is NAMED after the zone (waktu_wib / waktu_utc / waktu_lokal) so the
    file still states which one it used. See rnet_settings.display_tz.

VALUES ARE NOT ROUNDED
    str() on a float gives the shortest text that round-trips exactly, so the
    export is lossless and still compact. Rounding here would quietly make the
    file disagree with the database it came from.
"""

import io
import os
import zipfile
from datetime import datetime, timedelta

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.services import rnet_settings
from app.services.rollup_archiver import stream_tag_month, unique_names
from db.models.scada import ScadaSampleAll, ScadaTag

# Rows pulled per keyset page while streaming a window into a file.
CHUNK_ROWS = int(os.getenv("EXPORT_CHUNK_ROWS", "20000"))

CSV_MIME = "text/csv; charset=utf-8"
ZIP_MIME = "application/zip"


def _field(value: str) -> str:
    """Quote a CSV field only when it needs it.

    Only ever applied to HEADERS, because that is the only place free text
    reaches the file: a unit is whatever the operator typed, and a unit
    containing a comma or a quote would otherwise shift every column to its
    right by one — silently, since the file still parses."""
    if any(c in value for c in ',"\n\r'):
        return '"' + value.replace('"', '""') + '"'
    return value


async def stream_raw_rows(
    db: AsyncSession, tag_id, start: datetime, end: datetime, chunk: int = CHUNK_ROWS
):
    """Yield (ts, value) for one sensor's window, oldest first.

    Keyset-paged on the (tag_id, ts) primary key: memory stays flat regardless
    of how long the window is, and page 1000 costs what page 1 did (no OFFSET).

    Reads scada_samples_all, the view over the raw lane. Moved here from the
    retired archiver, minus its `source` parameter — there is one lane now."""
    cursor = start
    while True:
        rows = (
            await db.execute(
                select(ScadaSampleAll.ts, ScadaSampleAll.value)
                .where(
                    ScadaSampleAll.tag_id == tag_id,
                    ScadaSampleAll.ts >= cursor,
                    ScadaSampleAll.ts < end,
                )
                .order_by(ScadaSampleAll.ts)
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


async def write_tag_csv(
    out, db: AsyncSession, tag: ScadaTag, start, end, lane: str, tz
) -> int:
    """Write one sensor's window to an open text stream. Returns the row count.

    `tz` labels the timestamps (see the module docstring). It never touches the
    query bounds — those stay UTC, because that is what the columns are.

    The header always goes out, even for a sensor that reported nothing — an
    empty file says "this sensor was configured and stayed silent", where a
    missing file says nothing and reads as a bug."""
    unit = f" ({tag.unit})" if tag.unit else ""
    waktu = rnet_settings.tz_column_label(tz)
    n = 0
    if lane == "rollup":
        out.write(
            ",".join(
                _field(c)
                for c in (
                    waktu,
                    f"rata{unit}",
                    f"min{unit}",
                    f"maks{unit}",
                    "jumlah_data",
                )
            )
            + "\n"
        )
        # Minute precision: every row IS a minute bucket, so seconds would be
        # three characters of zeroes on every line.
        async for ts, avg, mn, mx, cnt in stream_tag_month(db, tag.id, start, end):
            out.write(f"{ts.astimezone(tz):%Y-%m-%d %H:%M},{avg},{mn},{mx},{cnt}\n")
            n += 1
    else:
        out.write(",".join(_field(c) for c in (waktu, f"nilai{unit}")) + "\n")
        # Seconds matter here: raw sensors sample as fast as every 2 s, and
        # truncating to the minute would collapse 30 readings into one visible
        # timestamp repeated 30 times.
        async for ts, value in stream_raw_rows(db, tag.id, start, end):
            out.write(f"{ts.astimezone(tz):%Y-%m-%d %H:%M:%S},{value}\n")
            n += 1
    return n


async def build_export(
    db: AsyncSession,
    tags: list[ScadaTag],
    start: datetime,
    end: datetime,
    lane: str,
    path: str,
    tz,
) -> tuple[dict, str, str]:
    """Write the export to `path`. Returns ({tag_id: rows}, mime, extension).

    One sensor gets a bare .csv so the common case needs no unzipping. Several
    get a .zip, because CSV has no second sheet to put them in.

    `tz` is passed in, not read from settings here: the caller already needs it
    for the filename stamp, and a builder that fetches its own configuration is
    a builder that cannot be tested without a database.
    """
    if len(tags) == 1:
        tag = tags[0]
        with open(path, "w", encoding="utf-8", newline="") as out:
            n = await write_tag_csv(out, db, tag, start, end, lane, tz)
        return {tag.id: n}, CSV_MIME, "csv"

    counts: dict = {}
    with zipfile.ZipFile(
        path, "w", compression=zipfile.ZIP_DEFLATED, allowZip64=True
    ) as zf:
        # unique_names, not the raw labels: R-Net labels are not unique
        # ('Holding' appears three times live) and two members with the same
        # name is a corrupt zip on some extractors, a silent overwrite on
        # others. Comparison is case-insensitive because these are extracted on
        # Windows, where 'Suhu' and 'suhu' are the same file.
        for tag, name in zip(tags, unique_names([t.label for t in tags])):
            with zf.open(f"{name}.csv", "w") as raw:
                out = io.TextIOWrapper(raw, encoding="utf-8", newline="")
                counts[tag.id] = await write_tag_csv(
                    out, db, tag, start, end, lane, tz
                )
                out.flush()
                out.detach()  # don't let the wrapper close the zip member twice
    return counts, ZIP_MIME, "zip"
