"""Metadata detection service — extract document metadata from filename using pattern matching + DB lookup."""

import logging
import re
from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from db.models.client import Client
from db.models.project import Project

logger = logging.getLogger(__name__)

KNOWN_DOC_TYPES_SET = {"Q", "DRW", "INV", "PO", "SPK", "RFP", "RPT", "SPEC", "OTHER"}

# Full: TYPE-CLIENT-NUMBER  (e.g.  DRW-PLB-0041,  Q-MBP-2514)
_FULL_PATTERN = re.compile(
    r"^(Q|DRW|INV|PO|SPK|RFP|RPT|SPEC|OTHER)-([A-Za-z]{2,5})-(\d[\d\-]*)",
    re.IGNORECASE,
)
# Simple: TYPE-NUMBER  (e.g.  Q-2514,  INV-42)
_TYPE_NUM_PATTERN = re.compile(
    r"^(Q|DRW|INV|PO|SPK|RFP|RPT|SPEC|OTHER)-(\d[\d\-]*)",
    re.IGNORECASE,
)
# Type-only prefix  (e.g.  "RPT Final..." or "SPEC_v2...")
_TYPE_ONLY_PATTERN = re.compile(
    r"^(Q|DRW|INV|PO|SPK|RFP|RPT|SPEC|OTHER)[-_\s]",
    re.IGNORECASE,
)

# Extension hints — only for unambiguous types, low confidence
EXT_TYPE_HINTS: dict[str, tuple[str, float]] = {
    ".dwg": ("DRW", 0.85),
    ".dxf": ("DRW", 0.85),
    ".step": ("DRW", 0.55),
    ".stp": ("DRW", 0.55),
}


@dataclass
class DetectedMetadata:
    doc_type: str | None = None
    doc_type_confidence: float = 0.0
    client_code: str | None = None
    client_name: str | None = None
    client_confidence: float = 0.0
    project_code: str | None = None
    project_name: str | None = None
    project_confidence: float = 0.0
    folder_path: str | None = None
    folder_confidence: float = 0.0


def _name_no_ext(filename: str) -> str:
    return filename.rsplit(".", 1)[0] if "." in filename else filename


def _tokens(filename: str) -> list[str]:
    name = _name_no_ext(filename)
    return [t.upper() for t in re.split(r"[-_\s.]+", name) if t]


async def detect_metadata_from_filename(
    filename: str, db: AsyncSession
) -> DetectedMetadata:
    result = DetectedMetadata()
    base = _name_no_ext(filename)
    toks = _tokens(filename)

    # ── 1. Full pattern  TYPE-CLIENT-NUMBER ─────────────────────────────────
    m = _FULL_PATTERN.match(base)
    if m:
        result.doc_type = m.group(1).upper()
        result.doc_type_confidence = 0.95
        client_code = m.group(2).upper()
        result.client_code = client_code
        db_client = await _find_client(db, client_code)
        if db_client:
            result.client_name = db_client.name
            result.client_confidence = 0.88
        else:
            result.client_confidence = 0.45
        # Project from remaining tokens
        for tok in toks:
            if tok not in (client_code, result.doc_type) and not tok.replace("-", "").isdigit():
                db_proj = await _find_project(db, tok)
                if db_proj:
                    result.project_code = db_proj.code
                    result.project_name = db_proj.name
                    result.project_confidence = 0.82
                    break
        _set_folder(result)
        return result

    # ── 2. Simple pattern  TYPE-NUMBER ──────────────────────────────────────
    m = _TYPE_NUM_PATTERN.match(base)
    if m:
        result.doc_type = m.group(1).upper()
        result.doc_type_confidence = 0.90
    else:
        # ── 3. Type-only prefix ──────────────────────────────────────────────
        m = _TYPE_ONLY_PATTERN.match(base)
        if m:
            result.doc_type = m.group(1).upper()
            result.doc_type_confidence = 0.80
        else:
            # ── 4. Extension hint ────────────────────────────────────────────
            ext = f".{filename.rsplit('.', 1)[-1].lower()}" if "." in filename else ""
            hint = EXT_TYPE_HINTS.get(ext)
            if hint:
                result.doc_type, result.doc_type_confidence = hint

    # Client / project from tokens (DB lookup)
    for tok in toks:
        if not result.client_code:
            db_client = await _find_client(db, tok)
            if db_client:
                result.client_code = db_client.code
                result.client_name = db_client.name
                result.client_confidence = 0.85
                break

    for tok in toks:
        if not result.project_code:
            db_proj = await _find_project(db, tok)
            if db_proj:
                result.project_code = db_proj.code
                result.project_name = db_proj.name
                result.project_confidence = 0.75
                break

    _set_folder(result)
    return result


def _set_folder(result: DetectedMetadata) -> None:
    if result.client_name and result.project_name:
        result.folder_path = f"{result.client_name}/{result.project_name}"
        result.folder_confidence = min(result.client_confidence, result.project_confidence)
    elif result.client_name:
        result.folder_path = result.client_name
        result.folder_confidence = result.client_confidence * 0.5
    else:
        result.folder_path = None
        result.folder_confidence = 0.0


async def _find_client(db: AsyncSession, code: str) -> Client | None:
    result = await db.execute(
        select(Client).where(Client.code == code, Client.is_active == True)  # noqa: E712
    )
    return result.scalar_one_or_none()


async def _find_project(db: AsyncSession, code: str) -> Project | None:
    result = await db.execute(
        select(Project).where(Project.code == code, Project.is_active == True)  # noqa: E712
    )
    return result.scalar_one_or_none()
