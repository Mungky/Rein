"""Google Sheets API service — REIN document index management.

Sheet structure:
  - One private sheet per doc type (DRW, INV, PO, etc.) — full internal info
  - "Index Publik" sheet — limited public info for external data requests
"""

import asyncio
import logging

from app.config import settings
from app.services.gdrive import _get_sheets_service

logger = logging.getLogger(__name__)

# Doc type sheet names
DOC_TYPE_SHEETS = ["DRW", "INV", "PO", "SPK", "RFP", "RPT", "SPEC", "OTHER"]

# Private per-type sheet headers
PRIVATE_HEADERS = [
    "Nomor Urut",
    "Nama Full Klien",
    "Nama Projek",
    "Nama File",
    "Note",
    "Path Lengkap",
    "Link Drive",
    "User Upload",
    "Kapan",
]

# Public index sheet
PUBLIC_SHEET = "Index Publik"
PUBLIC_HEADERS = [
    "Jenis",
    "Nomor Urut",
    "Kode Klien",
    "Projek",
    "Nama File",
    "Note",
]


def _ensure_sheet(svc, spreadsheet_id: str, sheet_name: str) -> None:
    """Create a sheet tab if it doesn't exist."""
    spreadsheet = svc.spreadsheets().get(
        spreadsheetId=spreadsheet_id,
        fields="sheets.properties.title",
    ).execute()
    existing = {s["properties"]["title"] for s in spreadsheet.get("sheets", [])}

    if sheet_name not in existing:
        svc.spreadsheets().batchUpdate(
            spreadsheetId=spreadsheet_id,
            body={"requests": [{"addSheet": {"properties": {"title": sheet_name}}}]},
        ).execute()


def _ensure_headers(svc, spreadsheet_id: str, sheet_name: str, headers: list[str]) -> None:
    """Ensure a sheet exists and has the correct header row."""
    _ensure_sheet(svc, spreadsheet_id, sheet_name)

    col_end = chr(64 + len(headers))
    result = (
        svc.spreadsheets()
        .values()
        .get(spreadsheetId=spreadsheet_id, range=f"'{sheet_name}'!A1:{col_end}1")
        .execute()
    )
    values = result.get("values", [])
    if values and values[0]:
        return

    svc.spreadsheets().values().update(
        spreadsheetId=spreadsheet_id,
        range=f"'{sheet_name}'!A1",
        valueInputOption="USER_ENTERED",
        body={"values": [headers]},
    ).execute()


def _append_row(svc, spreadsheet_id: str, sheet_name: str, row: list) -> int:
    """Append a row and return its 1-based row number."""
    result = svc.spreadsheets().values().append(
        spreadsheetId=spreadsheet_id,
        range=f"'{sheet_name}'!A:A",
        valueInputOption="USER_ENTERED",
        insertDataOption="INSERT_ROWS",
        body={"values": [row]},
    ).execute()

    updated_range = result.get("updates", {}).get("updatedRange", "")
    row_num = 0
    if "!" in updated_range:
        for ch in updated_range.split("!")[1].split(":")[0]:
            if ch.isdigit():
                row_num = row_num * 10 + int(ch)
    return row_num


async def add_document_row(data: dict) -> int:
    """Write a document to the private full index and the separate public index.

    Returns the row number in the private type sheet.
    """
    def _do() -> int:
        svc = _get_sheets_service()
        sid = settings.google_sheets_spreadsheet_id
        pub_sid = settings.google_sheets_public_spreadsheet_id
        doc_type = data.get("doc_type", "OTHER").upper()
        sheet_name = doc_type if doc_type in DOC_TYPE_SHEETS else "OTHER"

        # Private full index — per-type sheet
        _ensure_headers(svc, sid, sheet_name, PRIVATE_HEADERS)
        private_row = [
            data.get("doc_sequence", ""),
            data.get("client_name", ""),
            data.get("project_name", ""),
            data.get("file_name", ""),
            data.get("note", ""),
            data.get("folder_path", ""),
            data.get("gdrive_link", ""),
            data.get("uploaded_by", ""),
            data.get("created_at", ""),
        ]
        row_num = _append_row(svc, sid, sheet_name, private_row)

        # Public index — separate spreadsheet, limited fields
        if pub_sid:
            _ensure_headers(svc, pub_sid, PUBLIC_SHEET, PUBLIC_HEADERS)
            public_row = [
                doc_type,
                data.get("doc_sequence", ""),
                data.get("client_code", ""),
                data.get("project_name", ""),
                data.get("file_name", ""),
                data.get("note", ""),
            ]
            _append_row(svc, pub_sid, PUBLIC_SHEET, public_row)

        return row_num

    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(None, _do)


async def add_document_row_safe(data: dict) -> int | None:
    """Like add_document_row, but logs errors instead of raising."""
    try:
        return await add_document_row(data)
    except Exception as e:
        logger.error("Sheets indexing failed for %s: %s", data.get("file_name", "?"), e)
        return None


async def update_document_row(row_id: int, data: dict) -> None:
    """Update a document row in its type sheet."""
    def _do() -> None:
        svc = _get_sheets_service()
        sid = settings.google_sheets_spreadsheet_id
        doc_type = data.get("doc_type", "OTHER").upper()
        sheet_name = doc_type if doc_type in DOC_TYPE_SHEETS else "OTHER"

        col_map = {
            "doc_sequence": 0,
            "client_name": 1,
            "project_name": 2,
            "file_name": 3,
            "note": 4,
            "folder_path": 5,
            "gdrive_link": 6,
            "uploaded_by": 7,
            "created_at": 8,
        }

        value_ranges = []
        for key, col_idx in col_map.items():
            if key in data:
                col_letter = chr(65 + col_idx)
                value_ranges.append({
                    "range": f"'{sheet_name}'!{col_letter}{row_id}",
                    "values": [[data[key]]],
                })

        if value_ranges:
            svc.spreadsheets().values().batchUpdate(
                spreadsheetId=sid,
                body={"data": value_ranges, "valueInputOption": "USER_ENTERED"},
            ).execute()

    loop = asyncio.get_running_loop()
    await loop.run_in_executor(None, _do)


async def search_documents(query: str, limit: int = 10) -> list[dict]:
    """Search across all per-type sheets for matching documents."""
    def _do() -> list[dict]:
        svc = _get_sheets_service()
        sid = settings.google_sheets_spreadsheet_id

        matches: list[dict] = []
        query_lower = query.lower()

        for sheet_name in DOC_TYPE_SHEETS:
            if len(matches) >= limit:
                break
            try:
                result = (
                    svc.spreadsheets()
                    .values()
                    .get(spreadsheetId=sid, range=f"'{sheet_name}'!A:I")
                    .execute()
                )
            except Exception:
                continue

            rows = result.get("values", [])
            if len(rows) < 2:
                continue

            for row in rows[1:]:
                if len(matches) >= limit:
                    break
                row_text = " ".join(str(c) for c in row).lower()
                if query_lower not in row_text:
                    continue

                def _get(idx: int) -> str:
                    return row[idx] if idx < len(row) else ""

                matches.append({
                    "doc_type": sheet_name,
                    "doc_sequence": _get(0),
                    "client_name": _get(1),
                    "project_name": _get(2),
                    "file_name": _get(3),
                    "note": _get(4),
                    "folder_path": _get(5),
                    "gdrive_link": _get(6),
                    "uploaded_by": _get(7),
                    "created_at": _get(8),
                })

        return matches

    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(None, _do)


def get_public_index_url() -> str | None:
    """Return the URL to the separate public index spreadsheet, or None if not configured."""
    pub_sid = settings.google_sheets_public_spreadsheet_id
    if not pub_sid:
        return None
    return f"https://docs.google.com/spreadsheets/d/{pub_sid}/edit?usp=sharing"


async def get_public_index_count() -> int:
    """Return the number of data rows in the public index spreadsheet."""
    pub_sid = settings.google_sheets_public_spreadsheet_id
    if not pub_sid:
        return 0

    def _do() -> int:
        svc = _get_sheets_service()
        try:
            result = (
                svc.spreadsheets()
                .values()
                .get(spreadsheetId=pub_sid, range=f"'{PUBLIC_SHEET}'!A:A")
                .execute()
            )
            rows = result.get("values", [])
            # Subtract 1 for the header row
            return max(0, len(rows) - 1)
        except Exception:
            return 0

    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(None, _do)


async def delete_document_row(row_id: int, doc_type: str = "OTHER") -> None:
    """Clear a document row in the given type sheet."""
    def _do() -> None:
        svc = _get_sheets_service()
        sid = settings.google_sheets_spreadsheet_id
        sheet_name = doc_type.upper() if doc_type.upper() in DOC_TYPE_SHEETS else "OTHER"
        empty_row = [""] * len(PRIVATE_HEADERS)
        svc.spreadsheets().values().update(
            spreadsheetId=sid,
            range=f"'{sheet_name}'!A{row_id}:I{row_id}",
            valueInputOption="USER_ENTERED",
            body={"values": [empty_row]},
        ).execute()

    loop = asyncio.get_running_loop()
    await loop.run_in_executor(None, _do)
