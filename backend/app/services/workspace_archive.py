"""Shared Project / WO / Logbook files, routed by the uploader's division."""
import asyncio
import hashlib
import io
import logging
import os
import re
import uuid
from fastapi import HTTPException
from sqlalchemy import func, select, update
from googleapiclient.http import MediaIoBaseUpload
from app.services import gdrive
from db.models.profile import AppRole
from db.models.workspace import WorkspaceProject, WorkspaceTask
from db.models.workspace_coordination import WorkspaceDocument
from db.models.workspace_project import WorkspaceAttachment
from db.models.workspace_archive import WorkspaceArchiveFile
from db.models.library_folder import LibraryFolder, FolderType, DEPT_LABELS, DEPT_ROLE_MAP
from db.models.library_file import LibraryFile, LibraryFileStatus
from db.models.library_audit_log import LibraryAuditLog

logger = logging.getLogger(__name__)
UPLOAD_MIMES = {"application/pdf", "image/png", "image/jpeg", "image/webp", "text/plain", "application/octet-stream",
    "application/msword", "application/vnd.ms-excel", "application/vnd.ms-powerpoint",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    "application/zip", "application/x-zip-compressed", "application/vnd.rar", "application/x-rar-compressed",
    "image/vnd.dwg", "image/x-dwg", "application/acad", "application/dwg", "application/x-dwg",
    "image/vnd.dxf", "image/x-dxf", "application/dxf", "application/x-dxf",
    "model/step", "application/step", "application/x-step", "model/iges", "application/iges"}


def enabled():
    return os.getenv("WORKSPACE_ARCHIVE_ENABLED") == "1"


def department_for(profile, selected=None):
    if profile.role == AppRole.admin:
        return selected if selected in DEPT_LABELS else "management"
    own = next((key for key, roles in DEPT_ROLE_MAP.items() if profile.role.value in roles), None) or "management"
    return own


def project_folder_name(project):
    rpo = (project.rpo_number or "").strip()
    if not rpo:
        raise HTTPException(422, "Lengkapi nomor RPO proyek sebelum mengunggah ke Drive")
    if not re.match(r"^RPO\b", rpo, re.I):
        rpo = "RPO " + rpo
    value = re.sub(r"[\x00-\x1f/\\]+", " - ", f"{rpo} - {project.name}")
    return value.strip()[:255]


async def destination(db, profile, project):
    if not enabled():
        return {"enabled": False, "requires_choice": False, "departments": [], "default_department": None, "project_folder": ""}
    own = None if profile.role == AppRole.admin else department_for(profile)
    roots = (await db.scalars(select(LibraryFolder).where(LibraryFolder.parent_id.is_(None), LibraryFolder.is_active.is_(True), LibraryFolder.department.in_(DEPT_LABELS)))).all()
    available = {root.department for root in roots if root.gdrive_folder_id}
    return {"enabled": True, "requires_choice": own is None, "default_department": own,
        "project_folder": project_folder_name(project),
        "departments": [{"key": key, "label": label} for key, label in DEPT_LABELS.items() if key in available and (own is None or key == own)]}


async def _drive(call):
    def run():
        return gdrive._drive_call_with_retry(lambda: call(gdrive._build_drive_service()), max_attempts=3, label="Project archive")
    try:
        return await asyncio.wait_for(asyncio.to_thread(run), timeout=120)
    except HTTPException:
        raise
    except Exception:
        logger.exception("Project archive Drive operation failed")
        raise HTTPException(503, "Google Drive belum dapat memproses berkas. Coba lagi; data belum disimpan.")


async def remote_folder(name, parent):
    safe = name.replace("\\", "\\\\").replace("'", "\\'")
    def call(service):
        rows = service.files().list(q=f"'{parent}' in parents and name = '{safe}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false", fields="files(id)", pageSize=2).execute().get("files", [])
        if len(rows) > 1:
            raise HTTPException(409, "Ada folder proyek duplikat di Drive; periksa Document Manager")
        return rows[0]["id"] if rows else service.files().create(body={"name": name, "parents": [parent], "mimeType": "application/vnd.google-apps.folder"}, fields="id").execute()["id"]
    return await _drive(call)


async def remote_upload(document_id, parent, filename, mime, content, department):
    digest = hashlib.sha256(content).hexdigest()
    def call(service):
        query = f"appProperties has {{ key='reinWorkspaceDocumentId' and value='{document_id}' }} and trashed = false"
        rows = service.files().list(q=query, fields="files(id,webViewLink,md5Checksum,parents,appProperties)", pageSize=2).execute().get("files", [])
        if rows:
            row = rows[0]
            if len(rows) != 1 or row.get("appProperties", {}).get("sha256") != digest or parent not in row.get("parents", []) or row.get("md5Checksum") != hashlib.md5(content, usedforsecurity=False).hexdigest():
                raise HTTPException(409, "Referensi upload Drive berbeda dengan berkas ini")
            return row
        return service.files().create(body={"name": filename, "parents": [parent], "appProperties": {
            "reinWorkspaceDocumentId": str(document_id), "sha256": digest, "department": department}},
            media_body=MediaIoBaseUpload(io.BytesIO(content), mimetype=mime, resumable=False), fields="id,webViewLink").execute()
    return await _drive(call)


async def archive_document(db, doc, profile, content, selected=None):
    if not enabled():
        return None
    department = department_for(profile, selected)
    # Serialize retries and simultaneous uploads without creating duplicate folders.
    await db.execute(select(func.pg_advisory_xact_lock(func.hashtext(f"rein-archive:{doc.project_id}:{department}"))))
    existing = await db.get(WorkspaceArchiveFile, doc.id)
    if existing:
        return existing
    project = await db.get(WorkspaceProject, doc.project_id)
    name = project_folder_name(project)
    root = await db.scalar(select(LibraryFolder).where(LibraryFolder.parent_id.is_(None), LibraryFolder.department == department, LibraryFolder.is_active.is_(True)))
    if not root or not root.gdrive_folder_id:
        raise HTTPException(503, "Folder divisi belum terhubung ke Drive di Document Manager")
    folder_id = uuid.uuid5(project.id, "division-archive:" + department)
    folder = await db.get(LibraryFolder, folder_id)
    if not folder:
        matches = (await db.scalars(select(LibraryFolder).where(LibraryFolder.parent_id == root.id, LibraryFolder.name == name))).all()
        if len(matches) > 1:
            raise HTTPException(409, "Ada folder proyek duplikat di Document Manager")
        folder = matches[0] if matches else None
    if folder and not folder.is_active:
        raise HTTPException(409, "Pulihkan folder proyek di Document Manager sebelum mengunggah")
    if folder and (folder.parent_id != root.id or folder.department != department):
        raise HTTPException(409, "Folder proyek sudah dipindahkan dari divisi pengunggah. Periksa Document Manager.")
    if not folder:
        drive_id = await remote_folder(name, root.gdrive_folder_id)
        folder = LibraryFolder(id=folder_id, parent_id=root.id, department=department, name=name, folder_type=FolderType.project,
            path=f"{root.path} / {name}", gdrive_folder_id=drive_id, created_by=profile.id)
        db.add(folder)
        await db.flush()
    elif folder.name != name:
        await _drive(lambda service: service.files().update(fileId=folder.gdrive_folder_id, body={"name": name}, fields="id").execute())
        previous_path = folder.path
        folder.name, folder.path = name, f"{root.path} / {name}"
        await db.execute(update(LibraryFolder).where(LibraryFolder.path.startswith(previous_path + " / ", autoescape=True))
            .values(path=func.concat(folder.path, func.substr(LibraryFolder.path, len(previous_path) + 1))))
    remote = await remote_upload(doc.id, folder.gdrive_folder_id, doc.filename, doc.mime, content, department)
    library_id = uuid.uuid5(doc.id, "document-manager-file")
    kind = "DRW" if any(term in doc.kind.lower() for term in ("gambar", "drawing", "wiring")) else "OTHER"
    task = await db.get(WorkspaceTask, doc.task_id) if doc.task_id else None
    note = f"WO-{task.wo_number} · {doc.kind}" if task else f"RPO {project.rpo_number} · {doc.kind}"
    library = LibraryFile(id=library_id, folder_id=folder.id, original_name=doc.filename, file_name=doc.filename, note=note[:200],
        title=doc.title, doc_type=kind, client_name=project.client_name, project_code=(project.rpo_number or "")[:20],
        project_name=project.name, file_size=len(content), mime_type=doc.mime, content_hash=doc.sha256,
        gdrive_file_id=remote["id"], gdrive_folder_id=folder.gdrive_folder_id, gdrive_web_link=remote.get("webViewLink"),
        upload_status=LibraryFileStatus.passed, uploader_id=profile.id, is_deleted=False,
        proposal_metadata={"source": "workspace", "workspace_project_id": str(project.id), "workspace_document_id": str(doc.id),
            "workspace_task_id": str(doc.task_id) if doc.task_id else None, "archive_department": department,
            "folder_path": folder.path, "uploader_role": profile.role.value})
    db.add(library)
    await db.flush()
    link = WorkspaceArchiveFile(document_id=doc.id, library_file_id=library.id, department=department, folder_path=folder.path)
    db.add(link)
    db.add(LibraryAuditLog(actor_id=profile.id, action="upload", target_type="file", target_id=library.id,
        log_metadata={"source": "workspace", "project_id": str(project.id), "filename": doc.filename, "folder_id": str(folder.id), "department": department}))
    # Bytes live once in Drive; the database retains metadata and references.
    doc.content = None
    if doc.attachment_id:
        attachment = await db.get(WorkspaceAttachment, doc.attachment_id)
        attachment.data = b""
    await db.flush()
    return link


async def document_content(db, doc):
    if doc.attachment_id:
        attachment = await db.get(WorkspaceAttachment, doc.attachment_id)
        if attachment and attachment.data:
            return attachment.data
    else:
        await db.refresh(doc, ["content"])
        if doc.content:
            return doc.content
    link = await db.get(WorkspaceArchiveFile, doc.id)
    library = await db.get(LibraryFile, link.library_file_id) if link else None
    if not library or not library.gdrive_file_id:
        raise HTTPException(404, "Berkas tidak tersedia")
    if library.is_deleted or library.upload_status == LibraryFileStatus.archived:
        raise HTTPException(410, "Berkas sudah diarsipkan di Document Manager")
    return await remote_content(library.gdrive_file_id)


async def remote_content(file_id):
    return await _drive(lambda service: service.files().get_media(fileId=file_id).execute())


async def attachment_content(db, attachment):
    if attachment.data:
        return attachment.data
    doc = await db.scalar(select(WorkspaceDocument).where(WorkspaceDocument.attachment_id == attachment.id))
    if not doc:
        raise HTTPException(404, "Lampiran tidak tersedia")
    return await document_content(db, doc)


def attachment_size():
    if os.getenv("WORKSPACE_COORDINATION_ENABLED") != "1":
        return func.octet_length(WorkspaceAttachment.data)
    size = select(WorkspaceDocument.size).where(WorkspaceDocument.attachment_id == WorkspaceAttachment.id).correlate(WorkspaceAttachment).scalar_subquery()
    return func.coalesce(func.nullif(func.octet_length(WorkspaceAttachment.data), 0), size, 0)


async def archive_metadata(db, documents):
    if not enabled() or not documents:
        return {}
    rows = (await db.execute(select(WorkspaceArchiveFile, LibraryFile.folder_id, LibraryFile.is_deleted, LibraryFolder.path)
        .join(LibraryFile, LibraryFile.id == WorkspaceArchiveFile.library_file_id)
        .outerjoin(LibraryFolder, LibraryFolder.id == LibraryFile.folder_id)
        .where(WorkspaceArchiveFile.document_id.in_([doc.id for doc in documents])))).all()
    return {link.document_id: {"storage": "drive", "archive_department": link.department, "archive_path": path or link.folder_path,
        "library_file_id": str(link.library_file_id), "library_folder_id": str(folder) if folder else None, "file_deleted": deleted} for link, folder, deleted, path in rows}


async def sync_document_reference(db, doc):
    if not enabled():
        return
    link = await db.get(WorkspaceArchiveFile, doc.id)
    if link:
        library = await db.get(LibraryFile, link.library_file_id)
        library.proposal_metadata = {**(library.proposal_metadata or {}), "workspace_task_id": str(doc.task_id) if doc.task_id else None}
        task = await db.get(WorkspaceTask, doc.task_id) if doc.task_id else None
        library.note = (f"WO-{task.wo_number} · {doc.kind}" if task else f"Dokumen Project · {doc.kind}")[:200]
