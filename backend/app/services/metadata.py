"""Metadata detection service — extract document metadata from filename using regex + DB lookup, with LLM fallback."""

import json
import logging
import re
from dataclasses import dataclass

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from db.models.client import Client
from db.models.project import Project

logger = logging.getLogger(__name__)

# Document number pattern: TYPE-CLIENT-NUMBER (e.g., DRW-PLB-0041, INV-MUSI-2024-047)
DOC_NUMBER_PATTERN = re.compile(
    r"(DRW|INV|PO|SPK|RFP|RPT|SPEC)-([A-Z]{2,5})-(\d{4}-\d{3,}|\d{3,})"
)


# Extension-to-doc-type heuristics (lower confidence)
EXT_TYPE_HINTS = {
    ".dwg": ("DRW", 0.7),
    ".dxf": ("DRW", 0.7),
    ".pdf": ("INV", 0.3),
    ".xlsx": ("PO", 0.5),
    ".xls": ("PO", 0.5),
    ".docx": ("RPT", 0.4),
    ".doc": ("RPT", 0.4),
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


def _tokenize_filename(filename: str) -> list[str]:
    """Split a filename into uppercase tokens for matching."""
    name = re.sub(r"\.\w+$", "", filename)
    tokens = re.split(r"[-_\s.]+", name)
    return [t.upper() for t in tokens if t]


async def detect_metadata_from_filename(
    filename: str, db: AsyncSession
) -> DetectedMetadata:
    """Detect document metadata from a filename using pattern matching + DB lookup.

    Queries the clients and projects tables for matching codes/names,
    producing confidence scores based on match quality.
    """
    result = DetectedMetadata()
    tokens = _tokenize_filename(filename)

    # 1. Try to match the doc number pattern (e.g., DRW-PLB-0041)
    match = DOC_NUMBER_PATTERN.search(" ".join(tokens))
    if match:
        result.doc_type = match.group(1)
        result.doc_type_confidence = 0.95

        client_code = match.group(2)
        result.client_code = client_code

        # Lookup client from DB
        db_client = await _find_client(db, client_code)
        if db_client:
            result.client_name = db_client.name
            result.client_confidence = 0.88
        else:
            result.client_confidence = 0.45

        # Try to find project code from tokens
        for tok in tokens:
            if len(tok) >= 3 and tok != client_code and tok != result.doc_type:
                db_project = await _find_project(db, tok)
                if db_project:
                    result.project_code = db_project.code
                    result.project_name = db_project.name
                    result.project_confidence = 0.82
                    break
    else:
        # 2. No pattern match — try extension-based heuristic
        ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
        hint = EXT_TYPE_HINTS.get(f".{ext}")
        if hint:
            result.doc_type, result.doc_type_confidence = hint

        # 3. Try to match any token against DB codes
        for tok in tokens:
            if not result.client_code:
                db_client = await _find_client(db, tok)
                if db_client:
                    result.client_code = db_client.code
                    result.client_name = db_client.name
                    result.client_confidence = 0.85
                    break

        for tok in tokens:
            if not result.project_code:
                db_project = await _find_project(db, tok)
                if db_project:
                    result.project_code = db_project.code
                    result.project_name = db_project.name
                    result.project_confidence = 0.75
                    break

    # 4. Suggest folder path from detected client/project
    if result.client_name and result.project_name:
        result.folder_path = f"{result.client_name}/{result.project_name}"
        result.folder_confidence = min(result.client_confidence, result.project_confidence)
    elif result.client_name:
        result.folder_path = result.client_name
        result.folder_confidence = result.client_confidence * 0.5

    return result


async def _find_client(db: AsyncSession, code: str) -> Client | None:
    """Find a client by code (exact, case-insensitive)."""
    result = await db.execute(
        select(Client).where(Client.code == code, Client.is_active == True)  # noqa: E712
    )
    return result.scalar_one_or_none()


async def _find_project(db: AsyncSession, code: str) -> Project | None:
    """Find a project by code (exact, case-insensitive)."""
    result = await db.execute(
        select(Project).where(Project.code == code, Project.is_active == True)  # noqa: E712
    )
    return result.scalar_one_or_none()


# ---------------------------------------------------------------------------
# LLM fallback — call glm-5.1:cloud when regex+DB confidence is low
# ---------------------------------------------------------------------------

LLM_METADATA_PROMPT = """You are a document metadata extraction assistant for an engineering company (REIN — Remula Inti Rekayasa).

Given a filename, extract the following fields:
- doc_type: One of DRW (Drawing), INV (Invoice), PO (Purchase Order), SPK (Surat Perintah Kerja), RFP (Request for Proposal), RPT (Report), SPEC (Specification), or OTHER
- client_code: Short client code if identifiable (2-5 uppercase letters, e.g. MBP, PLB, RN, KS, SP)
- client_name: Full client name if identifiable
- project_code: Short project code if identifiable
- project_name: Full project name if identifiable

Respond with ONLY a JSON object, no explanation:
{{"doc_type":"...","client_code":"...","client_name":"...","project_code":"...","project_name":"..."}}

If a field cannot be determined, set it to null.

Available clients: MBP (Mitra Bangun Perkasa), PLB (Pelangi Bintang Logam), RN (Rekatama Nusantara), KS (Karya Sakti), SP (Sinar Perkasa)
Available projects: MUSI (Proyek Musi), JOHA (Proyek Johar Baru), BKS (Proyek Bintang Karya), SLY (Proyek Selayar), PLBN (Proyek Palembang)

Filename: {filename}"""


async def detect_metadata_with_llm(filename: str) -> DetectedMetadata:
    """Call LLM to extract metadata when regex+DB detection has low confidence.

    Returns a DetectedMetadata with LLM-suggested values and confidence 0.5
    (lower than regex matches to indicate LLM-sourced, but higher than null).
    """
    ollama_url = settings.ollama_base_url.rstrip("/")
    headers = {"Content-Type": "application/json"}
    if settings.ollama_api_key:
        headers["Authorization"] = f"Bearer {settings.ollama_api_key}"

    prompt = LLM_METADATA_PROMPT.format(filename=filename)

    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.post(
                f"{ollama_url}/v1/chat/completions",
                json={
                    "model": settings.ollama_model,
                    "messages": [{"role": "user", "content": prompt}],
                    "temperature": 0.1,
                    "max_tokens": 256,
                },
                headers=headers,
            )

        if response.status_code != 200:
            logger.warning("LLM metadata call failed with status %d", response.status_code)
            return DetectedMetadata()

        data = response.json()
        content = data.get("choices", [{}])[0].get("message", {}).get("content", "")

        # Strip markdown code fences if present
        content = content.strip()
        if content.startswith("```"):
            content = content.split("\n", 1)[-1]
        if content.endswith("```"):
            content = content.rsplit("```", 1)[0]
        content = content.strip()

        parsed = json.loads(content)
    except (json.JSONDecodeError, KeyError, IndexError) as e:
        logger.warning("Failed to parse LLM metadata response: %s", e)
        return DetectedMetadata()
    except httpx.ConnectError:
        logger.warning("LLM server not reachable for metadata detection")
        return DetectedMetadata()
    except Exception as e:
        logger.warning("LLM metadata detection error: %s", e)
        return DetectedMetadata()

    result = DetectedMetadata()
    llm_confidence = 0.5  # LLM suggestions are less certain than regex+DB matches

    if parsed.get("doc_type"):
        result.doc_type = parsed["doc_type"]
        result.doc_type_confidence = llm_confidence

    if parsed.get("client_code"):
        result.client_code = parsed["client_code"].upper()
        result.client_confidence = llm_confidence

    if parsed.get("client_name"):
        result.client_name = parsed["client_name"]
        result.client_confidence = llm_confidence

    if parsed.get("project_code"):
        result.project_code = parsed["project_code"].upper()
        result.project_confidence = llm_confidence

    if parsed.get("project_name"):
        result.project_name = parsed["project_name"]
        result.project_confidence = llm_confidence

    # Folder path will be computed from client/project in detect_metadata_hybrid

    return result


CONFIDENCE_THRESHOLD = 0.6


async def detect_metadata_hybrid(filename: str, db: AsyncSession) -> DetectedMetadata:
    """Hybrid detection: regex+DB first, LLM fallback when confidence < threshold.

    Uses regex+DB detection as the primary method. If any field has confidence
    below 0.6, calls the LLM and merges LLM suggestions where they improve
    on low-confidence or missing fields.
    """
    result = await detect_metadata_from_filename(filename, db)

    # Check if any key field has low confidence
    needs_llm = any([
        result.doc_type_confidence < CONFIDENCE_THRESHOLD,
        result.client_confidence < CONFIDENCE_THRESHOLD,
        result.project_confidence < CONFIDENCE_THRESHOLD,
    ])

    if needs_llm:
        llm_result = await detect_metadata_with_llm(filename)

        # Merge: only override where regex+DB had low confidence or was missing
        if result.doc_type_confidence < CONFIDENCE_THRESHOLD and llm_result.doc_type:
            result.doc_type = llm_result.doc_type
            result.doc_type_confidence = llm_result.doc_type_confidence

        if result.client_confidence < CONFIDENCE_THRESHOLD and llm_result.client_code:
            result.client_code = llm_result.client_code
            result.client_name = llm_result.client_name
            result.client_confidence = llm_result.client_confidence

        if result.project_confidence < CONFIDENCE_THRESHOLD and llm_result.project_code:
            result.project_code = llm_result.project_code
            result.project_name = llm_result.project_name
            result.project_confidence = llm_result.project_confidence

    # Recompute folder path from resolved client/project names
    if result.client_name and result.project_name:
        result.folder_path = f"{result.client_name}/{result.project_name}"
        result.folder_confidence = min(result.client_confidence, result.project_confidence)
    elif result.client_name:
        result.folder_path = result.client_name
        result.folder_confidence = result.client_confidence * 0.5
    else:
        result.folder_path = None
        result.folder_confidence = 0.0

    return result