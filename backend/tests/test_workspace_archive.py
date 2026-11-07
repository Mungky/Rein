import hashlib
import json
import uuid
from datetime import date
import pytest
from fastapi import HTTPException
from sqlalchemy import select, text
from sqlalchemy.orm import Session
from tests.test_workspace_coordination import coordinated, suite, client
from tests.test_workspace_board import ADMIN, WORKER, OUTSIDER, PROJECT, TASKS
from tests.test_workspace_logbook import brief, create
from app.services import workspace_archive as archive
from db.models.library_folder import LibraryFolder, DEPT_LABELS, DEPT_ROLE_MAP
from db.models.library_file import LibraryFile
from db.models.profile import Profile, AppRole
from db.models.role_permission import RolePermission
from db.models.workspace_coordination import WorkspaceMember


@pytest.fixture
def archived(coordinated, monkeypatch):
    monkeypatch.setenv("WORKSPACE_ARCHIVE_ENABLED", "1")
    calls = {"folders": [], "uploads": [], "content": {}}
    async def folder(name, parent):
        calls["folders"].append((name, parent))
        return "drive-folder-" + hashlib.sha256((parent+name).encode()).hexdigest()[:12]
    async def upload(document, parent, name, mime, content, department):
        calls["uploads"].append((document, parent, name, department))
        key = "drive-file-" + str(document)
        calls["content"][key] = content
        return {"id": key, "webViewLink": "https://drive.example.test/"+key}
    async def download(key):
        return calls["content"][key]
    monkeypatch.setattr(archive, "remote_folder", folder)
    monkeypatch.setattr(archive, "remote_upload", upload)
    monkeypatch.setattr(archive, "remote_content", download)
    with coordinated.sync_engine.begin() as conn:
        conn.execute(text("UPDATE workspace_projects SET rpo_number='1717',name='Tea Extractor' WHERE id=:id"), {"id": PROJECT})
    with Session(coordinated.sync_engine) as db:
        for key, label in DEPT_LABELS.items():
            db.add(LibraryFolder(department=key, name=label, path=label, gdrive_folder_id="root-"+key))
        db.commit()
    coordinated.archive_calls = calls
    return coordinated


def publish(http, headers=None, **fields):
    body = {"code": "ENG-1", "title": "Detail Drawing", "kind": "Gambar Detail", "request_id": str(uuid.uuid4()), **fields}
    return http.post(f"/api/workspace/projects/{PROJECT}/documents", data=body, files={"file": ("drawing.pdf", b"actual drawing", "application/pdf")}, headers=headers or {})


def test_every_business_role_maps_to_existing_division_and_admin_must_choose():
    for key, roles in DEPT_ROLE_MAP.items():
        for role in roles:
            assert archive.department_for(Profile(role=AppRole(role))) == key
    with pytest.raises(HTTPException) as exc:
        archive.department_for(Profile(role=AppRole.admin))
    assert exc.value.status_code == 422


def test_engineer_document_is_one_drive_object_and_appears_in_document_manager(archived):
    http = archived
    request = str(uuid.uuid4())
    response = publish(http, {"X-Test-User": str(WORKER)}, request_id=request)
    assert response.status_code == 201, response.text
    again = publish(http, {"X-Test-User": str(WORKER)}, request_id=request)
    assert again.status_code == 201 and again.json() == response.json()
    assert len(http.archive_calls["uploads"]) == 1
    assert http.archive_calls["folders"] == [("RPO 1717 - Tea Extractor", "root-engineering")]
    doc_id = response.json()["id"]
    doc = next(d for d in http.get(f"/api/workspace/projects/{PROJECT}/coordination").json()["documents"] if d["id"] == doc_id)
    assert doc["archive_department"] == "engineering" and doc["storage"] == "drive"
    assert http.get(f"/api/workspace/project-documents/{doc_id}/download").content == b"actual drawing"
    assert http.get(f"/api/workspace/project-documents/{doc_id}/download", headers={"X-Test-User": str(OUTSIDER)}).status_code == 403
    with http.sync_engine.begin() as conn:
        assert conn.execute(text("SELECT content IS NULL FROM workspace_documents WHERE id=:id"), {"id": doc_id}).scalar()
    # The existing Document Manager endpoint reads the same LibraryFile.
    from app.routers import library
    from app.limiter import limiter
    http.app.state.limiter = limiter
    http.app.include_router(library.router, prefix="/api/library")
    listing = http.get(f"/api/library/folders/{doc['library_folder_id']}/files")
    assert listing.status_code == 200, listing.text
    assert listing.json()["files"][0]["id"] == doc["library_file_id"]
    assert listing.json()["files"][0]["workspace_project_id"] == str(PROJECT)


def test_wrong_division_and_admin_without_choice_do_not_upload_or_persist(archived):
    http = archived
    assert publish(http, {"X-Test-User": str(WORKER)}, archive_department="warehouse").status_code == 403
    assert publish(http).status_code == 422
    assert publish(http, {"X-Test-User": str(OUTSIDER)}).status_code == 403
    assert http.archive_calls["uploads"] == []
    with Session(http.sync_engine) as db:
        assert db.scalar(select(LibraryFile.id)) is None
    assert http.get(f"/api/workspace/projects/{PROJECT}/upload-destination", headers={"X-Test-User": str(OUTSIDER)}).status_code == 403


def test_admin_can_choose_warehouse_and_project_folder_is_reused(archived):
    http = archived
    for code in ("WH-1", "WH-2"):
        assert publish(http, code=code, archive_department="warehouse").status_code == 201
    assert http.archive_calls["folders"] == [("RPO 1717 - Tea Extractor", "root-warehouse")]
    assert all(call[3] == "warehouse" for call in http.archive_calls["uploads"])


def test_wo_and_logbook_attachments_share_drive_metadata_and_keep_nonzero_sizes(archived):
    http = archived
    body = brief(archive_department="warehouse")
    response = create(http, body, [("files", ("wo.pdf", b"WO reference", "application/pdf"))])
    assert response.status_code == 201, response.text
    task = response.json()["id"]
    assert create(http, body, [("files", ("wo.pdf", b"WO reference", "application/pdf"))]).status_code == 201
    headers = {"X-Test-User": str(WORKER)}
    assert http.post(f"/api/workspace/tasks/{task}/start", headers=headers).status_code == 200
    log = {"request_id": str(uuid.uuid4()), "work_date": str(date.today()), "body": "Fabrikasi berjalan", "is_issue": True}
    path = f"/api/workspace/tasks/{task}/logbook"
    for _ in range(2):
        result = http.post(path, data={"metadata": json.dumps(log)}, files=[("files", ("progress.png", b"progress photo", "image/png"))], headers=headers)
        assert result.status_code == 201, result.text
    detail = http.get(f"/api/workspace/tasks/{task}/work-order").json()
    assert detail["attachments"][0]["bytes"] == len(b"WO reference")
    assert detail["logs"][0]["attachments"][0]["bytes"] == len(b"progress photo")
    assert len(http.archive_calls["uploads"]) == 2
    assert {row[3] for row in http.archive_calls["uploads"]} == {"engineering", "warehouse"}
    with http.sync_engine.begin() as conn:
        assert conn.execute(text("SELECT sum(octet_length(data)) FROM workspace_attachments WHERE task_id=:task"), {"task": task}).scalar() == 0


def test_drive_failure_rolls_back_and_legacy_document_can_be_migrated(archived, monkeypatch):
    http = archived
    upload = archive.remote_upload
    async def fail(*args):
        raise HTTPException(503, "Drive unavailable")
    monkeypatch.setattr(archive, "remote_upload", fail)
    assert publish(http, archive_department="engineering").status_code == 503
    with Session(http.sync_engine) as db:
        assert db.scalar(select(LibraryFile.id)) is None
    monkeypatch.setenv("WORKSPACE_ARCHIVE_ENABLED", "0")
    old = publish(http)
    assert old.status_code == 201
    monkeypatch.setenv("WORKSPACE_ARCHIVE_ENABLED", "1")
    monkeypatch.setattr(archive, "remote_upload", upload)
    path = f"/api/workspace/project-documents/{old.json()['id']}/archive"
    assert http.post(path, json={"department": "engineering"}).status_code == 200
    assert http.get(f"/api/workspace/project-documents/{old.json()['id']}/download").content == b"actual drawing"


def test_cad_document_mime_is_supported_and_html_stays_rejected(archived):
    http = archived
    fields = {"code": "CAD-1", "title": "Drawing CAD", "kind": "Gambar Detail"}
    result = http.post(f"/api/workspace/projects/{PROJECT}/documents", data=fields,
        files={"file": ("layout.dwg", b"cad data", "image/vnd.dwg")}, headers={"X-Test-User": str(WORKER)})
    assert result.status_code == 201, result.text
    result = http.post(f"/api/workspace/projects/{PROJECT}/documents", data=fields,
        files={"file": ("page.html", b"<script>alert(1)</script>", "text/html")}, headers={"X-Test-User": str(WORKER)})
    assert result.status_code == 415


def test_drive_retry_reuses_remote_object_and_rejects_changed_content(monkeypatch):
    import asyncio
    from types import SimpleNamespace
    state = {"files": [], "creates": 0}
    def response(value):
        return SimpleNamespace(execute=lambda: value)
    class Files:
        def list(self, **kwargs):
            return response({"files": state["files"]})
        def create(self, body, media_body, **kwargs):
            state["creates"] += 1
            content = media_body.getbytes(0, media_body.size())
            row = {"id": "one-object", "parents": body["parents"], "appProperties": body["appProperties"],
                "md5Checksum": hashlib.md5(content, usedforsecurity=False).hexdigest()}
            state["files"].append(row)
            return response(row)
    monkeypatch.setattr(archive.gdrive, "_build_drive_service", lambda: SimpleNamespace(files=lambda: Files()))
    key = uuid.uuid4()
    for _ in range(2):
        result = asyncio.run(archive.remote_upload(key, "engineering", "detail.pdf", "application/pdf", b"drawing", "engineering"))
        assert result["id"] == "one-object"
    assert state["creates"] == 1
    with pytest.raises(HTTPException) as exc:
        asyncio.run(archive.remote_upload(key, "engineering", "detail.pdf", "application/pdf", b"different", "engineering"))
    assert exc.value.status_code == 409 and state["creates"] == 1
