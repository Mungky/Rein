"""Metadata detection service — extract document metadata from filename using pattern matching + DB lookup."""

import logging
import re
import time
from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from db.models.client import Client
from db.models.file_type import FileType
from db.models.project import Project

logger = logging.getLogger(__name__)

# Extension hints — only for unambiguous types, low confidence.
# Kept hardcoded because they map physical formats to a conventional code,
# and changing them risks miscategorising historical uploads.
EXT_TYPE_HINTS: dict[str, tuple[str, float]] = {
    ".dwg": ("DRW", 0.85),
    ".dxf": ("DRW", 0.85),
    ".step": ("DRW", 0.55),
    ".stp": ("DRW", 0.55),
}

# In-process cache for the active file_types list. 60s TTL keeps the upload
# hot path from hitting the DB on every propose/upload while still picking
# up admin changes within a minute.
_CACHE_TTL_SECONDS = 60.0
_cache: dict[str, object] = {
    "expires_at": 0.0,
    "codes": [],          # list[str] — active codes, upper-cased
    "patterns": None,     # (full, type_num, type_only) regex tuple or None
}


def invalidate_file_types_cache() -> None:
    """Called by admin write endpoints so newly added/deactivated types apply immediately."""
    _cache["expires_at"] = 0.0


async def _load_active_file_types(db: AsyncSession) -> list[str]:
    """Return active file_type codes, refreshing the cache when the TTL expires."""
    now = time.monotonic()
    if now < _cache["expires_at"] and _cache["codes"]:
        return _cache["codes"]  # type: ignore[return-value]

    result = await db.execute(
        select(FileType.code).where(FileType.is_active.is_(True))
    )
    codes = [row[0].upper() for row in result.all()]
    if not codes:
        # Empty table — fall back to OTHER so detection still produces a result.
        codes = ["OTHER"]
    _cache["codes"] = codes
    _cache["patterns"] = _build_patterns(codes)
    _cache["expires_at"] = now + _CACHE_TTL_SECONDS
    return codes


def _build_patterns(codes: list[str]) -> tuple[re.Pattern, re.Pattern, re.Pattern]:
    """Compile filename regexes for the given set of codes."""
    alt = "|".join(re.escape(c) for c in codes)
    full = re.compile(rf"^({alt})-([A-Za-z]{{2,5}})-(\d[\d\-]*)", re.IGNORECASE)
    type_num = re.compile(rf"^({alt})-(\d[\d\-]*)", re.IGNORECASE)
    type_only = re.compile(rf"^({alt})[-_\s]", re.IGNORECASE)
    return full, type_num, type_only


async def _get_patterns(db: AsyncSession) -> tuple[re.Pattern, re.Pattern, re.Pattern]:
    await _load_active_file_types(db)
    return _cache["patterns"]  # type: ignore[return-value]


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

    full_pat, type_num_pat, type_only_pat = await _get_patterns(db)

    # ── 1. Full pattern  TYPE-CLIENT-NUMBER ─────────────────────────────────
    m = full_pat.match(base)
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
    m = type_num_pat.match(base)
    if m:
        result.doc_type = m.group(1).upper()
        result.doc_type_confidence = 0.90
    else:
        # ── 3. Type-only prefix ──────────────────────────────────────────────
        m = type_only_pat.match(base)
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
