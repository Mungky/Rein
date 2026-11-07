import uuid
from datetime import datetime, timedelta, timezone, date
import pytest

from tests.test_workspace_project import suite
from tests.test_workspace_board import client, PROJECT, OTHER_PROJECT, TASKS, ADMIN, WORKER, OUTSIDER
from scripts.workspace_preview import run_coordination_migration, run_logbook_migration, run_integration_migration, run_archive_migration
from app.routers import workspace_coordination
from app.routers import workspace_materials
from app.routers import workspace_work_orders


@pytest.fixture
def coordinated(suite, monkeypatch):
    monkeypatch.setenv("WORKSPACE_COORDINATION_ENABLED", "1")
    with suite.sync_engine.begin() as conn:
        run_coordination_migration(conn)
        run_logbook_migration(conn)
        run_integration_migration(conn)
        run_archive_migration(conn)
    suite.app.include_router(workspace_coordination.router, prefix="/api/workspace")
    suite.app.include_router(workspace_materials.router, prefix="/api/workspace")
    suite.app.include_router(workspace_work_orders.router, prefix="/api/workspace")
    return suite


def state(http):
    response = http.get(f"/api/workspace/projects/{PROJECT}/coordination")
    assert response.status_code == 200, response.text
    return response.json()


def control(http, **extra):
    start = datetime.now(timezone.utc)
    body = {"division": "Engineering", "pic_id": str(ADMIN), "planned_start": start.isoformat(),
        "planned_end": (start + timedelta(hours=3)).isoformat(), "drawing_required": False, "material_required": False, **extra}
    response = http.put(f"/api/workspace/projects/{PROJECT}/work-controls/{TASKS[0]}", json=body)
    assert response.status_code == 200, response.text


def release(http):
    return http.post(f"/api/workspace/projects/{PROJECT}/work-controls/{TASKS[0]}/release", json={"note": "Pekerjaan dapat dilaksanakan"})


def test_assigned_wo_starts_without_reentering_pic_or_release(coordinated):
    assert coordinated.post(f"/api/workspace/tasks/{TASKS[0]}/start").status_code == 200


def test_documents_revision_client_approval_and_acknowledgment(coordinated):
    control(coordinated, drawing_required=True)
    assert release(coordinated).status_code == 409
    path = f"/api/workspace/projects/{PROJECT}/documents"
    body = {"code": "ENG-001", "title": "Gambar pompa", "kind": "Gambar Detail", "task_id": str(TASKS[0]), "recipient_ids": str(WORKER)}
    result = coordinated.post(path, data=body, files={"file": ("drawing.pdf", b"drawing", "application/pdf")})
    assert result.status_code == 201, result.text
    key = result.json()["id"]
    assert coordinated.post(f"/api/workspace/project-documents/{key}/approval", json={"decision": "approved", "client_approved": True, "evidence": "Persetujuan klien tanggal hari ini"}).status_code == 200
    assert release(coordinated).status_code == 409
    assert coordinated.post(f"/api/workspace/project-documents/{key}/acknowledge").status_code == 403
    assert coordinated.post(f"/api/workspace/project-documents/{key}/acknowledge", headers={"X-Test-User": str(WORKER)}).status_code == 200
    assert release(coordinated).status_code == 200
    revision = coordinated.post(path, data=body, files={"file": ("rev2.pdf", b"revised", "application/pdf")})
    assert revision.json()["revision"] == 2
    assert coordinated.post(f"/api/workspace/tasks/{TASKS[0]}/start").status_code == 200
    assert len(state(coordinated)["documents"]) == 2
    assert coordinated.get(f"/api/workspace/project-documents/{key}/download", headers={"X-Test-User": str(OUTSIDER)}).status_code == 403


def test_blocker_requires_resolution_and_verification_then_new_release(coordinated):
    control(coordinated)
    assert release(coordinated).status_code == 200
    result = coordinated.post(f"/api/workspace/projects/{PROJECT}/issues", json={"kind": "blocker", "task_id": str(TASKS[0]),
        "title": "Akses ke site tertutup", "pic_id": str(WORKER), "due_date": str(date.today())})
    assert result.status_code == 201, result.text
    key = result.json()["id"]
    assert release(coordinated).status_code == 409
    assert coordinated.post(f"/api/workspace/project-issues/{key}/verify").status_code == 409
    assert coordinated.post(f"/api/workspace/project-issues/{key}/resolve", json={"resolution": "Akses dibuka kembali", "evidence": "Konfirmasi security site"}).status_code == 200
    assert release(coordinated).status_code == 409
    assert coordinated.post(f"/api/workspace/project-issues/{key}/verify").status_code == 200
    assert release(coordinated).status_code == 200


def test_project_required_fields_and_archive_restore(coordinated):
    assert coordinated.post("/api/workspace/projects", json={"name": "Tidak lengkap"}).status_code == 422
    assert coordinated.post(f"/api/workspace/projects/{PROJECT}/archive").status_code == 200
    assert str(PROJECT) not in {p["id"] for p in coordinated.get("/api/workspace/projects").json()}
    assert str(PROJECT) in {p["id"] for p in coordinated.get("/api/workspace/projects?archived=true").json()}
    assert coordinated.post(f"/api/workspace/projects/{PROJECT}/archive?archive=false").status_code == 200


def test_stock_ledger_reservations_quality_returns_and_idempotency(coordinated):
    http = coordinated
    item = http.post("/api/workspace/materials/catalog", json={"sku":"PLATE-001", "name":"Plat SS316", "unit":"lembar"}).json()["id"]
    def move(kind, quantity, **extra):
        body = {"request_id": str(uuid.uuid4()), "item_id": item, "kind": kind, "quantity": quantity,
            "reference": "SJ-001 / Petugas gudang", "notes": "Mutasi untuk pengujian", **extra}
        response = http.post("/api/workspace/materials/movements", json=body)
        return response, body
    first, body = move("receipt", 10)
    assert first.status_code == 201, first.text
    assert http.post("/api/workspace/materials/movements", json=body).json()["reused"]
    assert http.post("/api/workspace/materials/movements", json={**body,"quantity":11}).status_code == 409
    req = http.post(f"/api/workspace/projects/{PROJECT}/materials", json={"request_id":str(uuid.uuid4()), "item_id":item,
        "task_id":str(TASKS[0]), "quantity":8, "notes":"Kebutuhan fabrikasi"})
    assert req.status_code == 201, req.text
    request_id = req.json()["id"]
    assert move("reserve", 8, material_request_id=request_id)[0].status_code == 201
    assert move("loan", 3)[0].status_code == 409
    assert move("quarantine", 2)[0].status_code == 201
    assert move("stocktake", 7)[0].status_code == 409
    issued, _ = move("issue", 3, material_request_id=request_id)
    assert issued.status_code == 201, issued.text
    assert move("return_project", 2, material_request_id=request_id, related_move_id=issued.json()["id"])[0].status_code == 201
    assert move("return_project", 2, material_request_id=request_id, related_move_id=issued.json()["id"])[0].status_code == 409
    stock = http.get("/api/workspace/materials/catalog").json()[0]
    assert stock["usable"] == 7 and stock["reserved"] == 5 and stock["unusable"] == 2
    history = http.get("/api/workspace/materials/movements").json()
    assert history["total"] == 5


def test_purchase_material_readiness_and_unauthorized_warehouse(coordinated):
    http = coordinated
    control(http, material_required=True)
    assert release(http).status_code == 409
    item = http.post("/api/workspace/materials/catalog", json={"sku":"PIPE-001", "name":"Pipa SS", "unit":"batang"}).json()["id"]
    req = http.post(f"/api/workspace/projects/{PROJECT}/materials", json={"request_id":str(uuid.uuid4()),"item_id":item,
        "task_id":str(TASKS[0]), "quantity":2,"notes":"Kebutuhan pipa"}).json()["id"]
    purchase = http.put(f"/api/workspace/material-requests/{req}/purchase", json={"status":"purchased","order_reference":"PO-001","eta":str(date.today()),"notes":"Dibeli dari pemasok"})
    assert purchase.status_code == 200, purchase.text
    body = {"request_id":str(uuid.uuid4()),"item_id":item,"material_request_id":req,"kind":"receipt","quantity":2,"reference":"SJ-001","notes":"Diterima baik"}
    assert http.post("/api/workspace/materials/movements", json=body,headers={"X-Test-User":str(WORKER)}).status_code == 403
    assert http.post("/api/workspace/materials/movements", json=body).status_code == 201
    assert release(http).status_code == 409
    assert http.post("/api/workspace/materials/movements", json={**body,"request_id":str(uuid.uuid4()),"kind":"reserve"}).status_code == 201
    assert release(http).status_code == 200
    assert http.get("/api/workspace/operations/summary").status_code == 200
    assert http.get("/api/workspace/operations/manpower").status_code == 200


def test_two_projects_cannot_reserve_the_same_stock_concurrently(coordinated):
    from concurrent.futures import ThreadPoolExecutor
    http = coordinated
    item = http.post("/api/workspace/materials/catalog",json={"sku":"SHARED-001","name":"Shared material","unit":"pcs"}).json()["id"]
    def movement(kind, qty, **extra):
        return {"request_id":str(uuid.uuid4()),"item_id":item,"kind":kind,"quantity":qty,"reference":"SJ-SHARED","notes":"Concurrent allocation",**extra}
    assert http.post("/api/workspace/materials/movements",json=movement("receipt",10)).status_code == 201
    requests = [http.post(f"/api/workspace/projects/{project}/materials",json={"request_id":str(uuid.uuid4()),"item_id":item,"quantity":6,"notes":"Shared material required"}).json()["id"] for project in [PROJECT,OTHER_PROJECT]]
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(lambda key:http.post("/api/workspace/materials/movements",json=movement("reserve",6,material_request_id=key)).status_code,requests))
    assert sorted(results) == [201,409]
    stock = http.get("/api/workspace/materials/catalog").json()[0]
    assert stock["reserved"] == 6 and stock["available"] == 4


def test_assigned_worker_still_requires_execute_role_permission(coordinated):
    from sqlalchemy import delete
    from db.models.role_permission import RolePermission
    from db.models.profile import AppRole
    control(coordinated)
    assert release(coordinated).status_code == 200
    with coordinated.sync_engine.begin() as conn:
        conn.execute(delete(RolePermission).where(RolePermission.role==AppRole.engineer_mechanical,RolePermission.permission=="workspace:execute_wo"))
    assert coordinated.post(f"/api/workspace/tasks/{TASKS[0]}/start",headers={"X-Test-User":str(WORKER)}).status_code == 403


def test_drawing_must_reach_every_executor_before_work_release(coordinated):
    http=coordinated
    control(http,drawing_required=True)
    doc=http.post(f"/api/workspace/projects/{PROJECT}/documents",data={"code":"ENG-ALL","title":"Approved drawing","kind":"Gambar Detail","task_id":str(TASKS[0]),"recipient_ids":str(ADMIN)},files={"file":("drawing.pdf",b"drawing","application/pdf")}).json()["id"]
    assert http.post(f"/api/workspace/project-documents/{doc}/approval",json={"decision":"approved","client_approved":True,"evidence":"Client approved reference"}).status_code==200
    assert http.post(f"/api/workspace/project-documents/{doc}/acknowledge").status_code==200
    assert release(http).status_code==409
    assert http.post(f"/api/workspace/project-documents/{doc}/recipients",json={"profile_ids":[str(WORKER)]}).status_code==200
    assert http.post(f"/api/workspace/project-documents/{doc}/acknowledge",headers={"X-Test-User":str(WORKER)}).status_code==200
    assert release(http).status_code==200
