"""4-layer background audit pipeline for library files.

Layers:
  1. format_name  — filename matches {TYPE}-{NUM}-{CLIENT} {title}.ext convention
  2. path         — target folder exists and is active
  3. duplicate    — no file with same SHA-256 hash or same name in same folder
  4. content_ai   — Ollama verifies file type/metadata consistency (non-blocking)
"""

import logging
import re
import uuid
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings

logger = logging.getLogger(__name__)

KNOWN_DOC_TYPES = {"Q", "DRW", "INV", "PO", "SPK", "RFP", "RPT", "SPEC", "OTHER"}
# Minimum valid filename: TYPE-anything.ext
_TYPE_PREFIX_RE = re.compile(r"^([A-Z]+)-", re.IGNORECASE)


# ---------------------------------------------------------------------------
# Public entry point
# ---------------------------------------------------------------------------

async def run_audit(file_id: str) -> None:
    """Run all 4 audit layers for a file. Called by background worker."""
    from db.session import async_session_factory
    from db.models.library_file import LibraryFile, LibraryFileStatus
    from db.models.audit_job import AuditJob, LAYER_NAMES

    async with async_session_factory() as db:
        file_result = await db.execute(
            select(LibraryFile).where(LibraryFile.id == uuid.UUID(file_id))
        )
        lib_file = file_result.scalar_one_or_none()
        if not lib_file:
            logger.error("audit_pipeline: file %s not found", file_id)
            return

        jobs_result = await db.execute(
            select(AuditJob)
            .where(AuditJob.file_id == lib_file.id)
            .order_by(AuditJob.layer)
        )
        jobs = jobs_result.scalars().all()

        all_passed = True
        for job in jobs:
            job.status = "running"
            job.started_at = datetime.now(timezone.utc)
            await db.commit()

            try:
                result_data = await _run_layer(job.layer, lib_file, db)
            except Exception as exc:
                result_data = {"passed": False, "error": str(exc)[:300]}
                logger.error(
                    "audit layer %d for file %s raised: %s",
                    job.layer,
                    file_id,
                    exc,
                    exc_info=True,
                )

            job.status = "passed" if result_data.get("passed") else "failed"
            job.result = result_data
            if not result_data.get("passed"):
                job.error_message = result_data.get("reason") or result_data.get("error")
                all_passed = False
            job.finished_at = datetime.now(timezone.utc)
            await db.commit()

            if not all_passed:
                # Mark remaining layers as skipped
                for pending in jobs:
                    if pending.status == "pending":
                        pending.status = "skipped"
                await db.commit()
                break

        lib_file.upload_status = (
            LibraryFileStatus.passed if all_passed else LibraryFileStatus.failed
        )
        lib_file.audit_results = _summarise_jobs(jobs)

        if all_passed:
            await _move_to_final_folder(lib_file, db)

        await db.commit()
        logger.info(
            "audit complete for file %s: %s",
            file_id,
            "PASS" if all_passed else "FAIL",
        )


# ---------------------------------------------------------------------------
# Layer dispatcher
# ---------------------------------------------------------------------------

async def _run_layer(layer: int, lib_file, db: AsyncSession) -> dict:
    if layer == 1:
        return _check_format_name(lib_file.file_name or lib_file.original_name)
    if layer == 2:
        return await _check_path(lib_file, db)
    if layer == 3:
        return await _check_duplicate(lib_file, db)
    if layer == 4:
        return await _check_content_ai(lib_file)
    return {"passed": True, "note": "unknown layer — skipped"}


# ---------------------------------------------------------------------------
# Layer 1 — filename format
# ---------------------------------------------------------------------------

def _check_format_name(filename: str) -> dict:
    if not filename:
        return {"passed": False, "reason": "Nama file kosong"}

    forbidden = set('/\\:*?"<>|')
    bad_chars = forbidden & set(filename)
    if bad_chars:
        return {
            "passed": False,
            "reason": f"Nama file mengandung karakter tidak valid: {''.join(sorted(bad_chars))}",
        }

    match = _TYPE_PREFIX_RE.match(filename)
    if not match:
        return {
            "passed": False,
            "reason": (
                f"Format nama tidak sesuai. Harus diawali tipe dokumen "
                f"({', '.join(sorted(KNOWN_DOC_TYPES))}) diikuti tanda hubung, "
                f"contoh: INV-001-MBP Faktur Pembelian.pdf"
            ),
        }

    prefix = match.group(1).upper()
    if prefix not in KNOWN_DOC_TYPES:
        return {
            "passed": False,
            "reason": (
                f"Tipe dokumen '{prefix}' tidak dikenali. "
                f"Tipe yang valid: {', '.join(sorted(KNOWN_DOC_TYPES))}"
            ),
        }

    return {"passed": True, "note": f"Format nama valid (tipe: {prefix})"}


# ---------------------------------------------------------------------------
# Layer 2 — folder path exists
# ---------------------------------------------------------------------------

async def _check_path(lib_file, db: AsyncSession) -> dict:
    from db.models.library_folder import LibraryFolder

    if not lib_file.folder_id:
        return {"passed": False, "reason": "Folder tujuan tidak ditentukan"}

    result = await db.execute(
        select(LibraryFolder).where(
            LibraryFolder.id == lib_file.folder_id,
            LibraryFolder.is_active.is_(True),
        )
    )
    folder = result.scalar_one_or_none()
    if not folder:
        return {
            "passed": False,
            "reason": "Folder tujuan tidak ditemukan atau tidak aktif",
        }

    return {"passed": True, "folder_path": folder.path}


# ---------------------------------------------------------------------------
# Layer 3 — duplicate detection
# ---------------------------------------------------------------------------

async def _check_duplicate(lib_file, db: AsyncSession) -> dict:
    from db.models.library_file import LibraryFile, LibraryFileStatus

    # Exact duplicate by content hash
    if lib_file.content_hash:
        result = await db.execute(
            select(LibraryFile).where(
                LibraryFile.content_hash == lib_file.content_hash,
                LibraryFile.id != lib_file.id,
                LibraryFile.upload_status == LibraryFileStatus.passed,
                LibraryFile.is_deleted.is_(False),
            )
        )
        dup = result.scalar_one_or_none()
        if dup:
            return {
                "passed": False,
                "reason": (
                    f"Konten file identik dengan file yang sudah ada: "
                    f"{dup.file_name or dup.original_name} (ID: {dup.id})"
                ),
            }

    # Same filename in the same folder
    if lib_file.folder_id and lib_file.file_name:
        result = await db.execute(
            select(LibraryFile).where(
                LibraryFile.folder_id == lib_file.folder_id,
                LibraryFile.file_name == lib_file.file_name,
                LibraryFile.id != lib_file.id,
                LibraryFile.upload_status == LibraryFileStatus.passed,
                LibraryFile.is_deleted.is_(False),
            )
        )
        same_name = result.scalar_one_or_none()
        if same_name:
            return {
                "passed": False,
                "reason": f"File dengan nama '{lib_file.file_name}' sudah ada di folder ini",
            }

    return {"passed": True, "note": "Tidak ada duplikat"}


# ---------------------------------------------------------------------------
# Layer 4 — AI content validation (non-blocking: failure → skip, not fail)
# ---------------------------------------------------------------------------

async def _check_content_ai(lib_file) -> dict:
    """
    Non-blocking informational layer. Calls Ollama for a metadata sanity check.
    Result is recorded but NEVER fails the upload — passes regardless of AI verdict.
    """
    import httpx

    prompt = (
        f"Verifikasi konsistensi metadata dokumen arsip.\n"
        f"Nama file: {lib_file.file_name or lib_file.original_name}\n"
        f"Tipe dokumen: {lib_file.doc_type or 'tidak diketahui'}\n\n"
        f"Apakah nama file terlihat konsisten dengan tipe dokumennya? "
        f"Jawab HANYA dengan JSON: "
        f'{{ "valid": true/false, "reason": "alasan singkat dalam Bahasa Indonesia" }}'
    )

    try:
        async with httpx.AsyncClient(timeout=20.0) as client:
            resp = await client.post(
                f"{settings.ollama_base_url}/api/generate",
                json={
                    "model": settings.ollama_model,
                    "prompt": prompt,
                    "stream": False,
                },
                headers=(
                    {"Authorization": f"Bearer {settings.ollama_api_key}"}
                    if settings.ollama_api_key
                    else {}
                ),
            )

        if resp.status_code != 200:
            return {"passed": True, "note": "AI tidak tersedia — dilewati"}

        import json
        text = resp.json().get("response", "")
        start, end = text.find("{"), text.rfind("}") + 1
        if start >= 0 and end > start:
            ai = json.loads(text[start:end])
            ai_valid = bool(ai.get("valid", True))
            ai_reason = ai.get("reason", "")
            # Always pass — AI verdict is informational only
            return {
                "passed": True,
                "ai_valid": ai_valid,
                "note": ai_reason if not ai_valid else f"OK — {ai_reason}",
            }

        return {"passed": True, "note": "Respons AI tidak dapat diparse — dilewati"}

    except Exception as exc:
        logger.warning("AI content check failed for %s: %s — skipping", lib_file.id, exc)
        return {"passed": True, "note": f"AI audit dilewati: {str(exc)[:80]}"}


# ---------------------------------------------------------------------------
# Post-audit: move to final Drive folder
# ---------------------------------------------------------------------------

async def _move_to_final_folder(lib_file, db: AsyncSession) -> None:
    from app.services import gdrive
    from db.models.library_folder import LibraryFolder

    if not lib_file.gdrive_file_id or not lib_file.folder_id:
        return

    folder_result = await db.execute(
        select(LibraryFolder).where(LibraryFolder.id == lib_file.folder_id)
    )
    folder = folder_result.scalar_one_or_none()
    if not folder or not folder.gdrive_folder_id:
        # Folder not linked to Drive yet — leave file in TEMP
        logger.warning(
            "folder %s has no gdrive_folder_id — file %s stays in TEMP",
            lib_file.folder_id,
            lib_file.id,
        )
        return

    try:
        final_name = lib_file.file_name or lib_file.original_name
        await gdrive.move_file(lib_file.gdrive_file_id, folder.gdrive_folder_id)
        result = await gdrive.rename_file(lib_file.gdrive_file_id, final_name)
        lib_file.gdrive_folder_id = folder.gdrive_folder_id
        lib_file.gdrive_web_link = result.get("webViewLink")
    except Exception as exc:
        logger.error(
            "Failed to move file %s to archive folder %s: %s",
            lib_file.id,
            folder.path,
            exc,
        )


# ---------------------------------------------------------------------------
# Helper
# ---------------------------------------------------------------------------

def _summarise_jobs(jobs) -> dict:
    return {
        j.layer_name: {
            "status": j.status,
            "result": j.result,
        }
        for j in jobs
    }
