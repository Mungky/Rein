import uuid
from sqlalchemy import text
from tests.test_workspace_coordination import coordinated, suite, client
from tests.test_workspace_board import PROJECT, OTHER_PROJECT, WORKER, OUTSIDER, ADMIN, TASKS


def test_delete_requires_permission_access_archive_and_exact_confirmation(coordinated):
    http = coordinated
    path = f"/api/workspace/projects/{PROJECT}"
    assert http.delete(path, params={"confirmation": "Test"}, headers={"X-Test-User": str(WORKER)}).status_code == 403
    assert http.delete(path, params={"confirmation": "Test"}).status_code == 409
    assert http.post(path + "/archive").status_code == 200
    assert http.delete(path, params={"confirmation": "wrong"}).status_code == 422
    with http.sync_engine.begin() as conn:
        conn.execute(text("INSERT INTO role_permissions (role, permission) VALUES ('engineer_mechanical', 'workspace:manage')"))
    assert http.delete(path, params={"confirmation": "Test"}, headers={"X-Test-User": str(OUTSIDER)}).status_code == 403
    assert http.get(path).status_code == 200


def test_delete_archived_project_cascades_its_wo_documents_and_preserves_other_project(coordinated):
    http = coordinated
    document = http.post(f"/api/workspace/projects/{PROJECT}/documents", data={"code": "DELETE-TEST", "title": "Drawing", "kind": "Gambar Detail", "task_id": str(TASKS[0])}, files={"file": ("drawing.pdf", b"test", "application/pdf")})
    assert document.status_code == 201, document.text
    assert http.post(f"/api/workspace/projects/{PROJECT}/archive").status_code == 200
    result = http.delete(f"/api/workspace/projects/{PROJECT}", params={"confirmation": "Test"})
    assert result.status_code == 200, result.text
    assert http.get(f"/api/workspace/projects/{PROJECT}").status_code == 404
    assert http.get(f"/api/workspace/project-documents/{document.json()['id']}/download").status_code == 404
    assert http.get(f"/api/workspace/projects/{OTHER_PROJECT}").status_code == 200
    with http.sync_engine.begin() as conn:
        assert conn.execute(text("SELECT count(*) FROM workspace_tasks WHERE id=:id"), {"id": TASKS[0]}).scalar() == 0


def test_warehouse_history_prevents_deletion_without_changing_stock(coordinated):
    http = coordinated
    item, request, movement = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
    with http.sync_engine.begin() as conn:
        conn.execute(text("INSERT INTO material_items (id, sku, name, unit) VALUES (:id,'STOCK-KEEP','Plate','pcs')"), {"id": item})
        conn.execute(text("INSERT INTO material_requests (id,project_id,item_id,quantity,author_id) VALUES (:id,:project,:item,1,:actor)"), {"id": request, "project": PROJECT, "item": item, "actor": ADMIN})
        conn.execute(text("INSERT INTO stock_movements (id,item_id,material_request_id,kind,request_hash,quantity,reference,notes,actor_id) VALUES (:id,:item,:request,'receive','test',1,'GRN-1','',:actor)"), {"id": movement, "item": item, "request": request, "actor": ADMIN})
    assert http.post(f"/api/workspace/projects/{PROJECT}/archive").status_code == 200
    result = http.delete(f"/api/workspace/projects/{PROJECT}", params={"confirmation": "Test"})
    assert result.status_code == 409 and "transaksi gudang" in result.text
    with http.sync_engine.begin() as conn:
        assert conn.execute(text("SELECT quantity FROM stock_movements WHERE id=:id"), {"id": movement}).scalar() == 1
    assert http.get(f"/api/workspace/projects/{PROJECT}").status_code == 200


def test_complete_requires_closed_work_then_can_be_reopened_and_archived(coordinated):
    http = coordinated
    path = f"/api/workspace/projects/{PROJECT}"
    assert http.put(path, json={"status": "completed"}).status_code == 409
    with http.sync_engine.begin() as conn:
        conn.execute(text("UPDATE workspace_tasks SET status='done' WHERE phase_id IN (SELECT id FROM workspace_phases WHERE project_id=:id)"), {"id": PROJECT})
    result = http.put(path, json={"status": "completed"})
    assert result.status_code == 200 and result.json()["status"] == "completed"
    assert http.post(path + "/archive").status_code == 200
    assert http.post(path + "/archive?archive=false").status_code == 200
    assert http.get(path).json()["status"] == "completed"
    assert http.put(path, json={"status": "active"}).json()["status"] == "active"
