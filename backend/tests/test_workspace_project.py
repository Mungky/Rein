import uuid
from datetime import date
import pytest

from tests.test_workspace_board import client, PROJECT, PHASE, TASKS, ADMIN, WORKER, OUTSIDER, OTHER
from scripts.workspace_preview import run_project_migration
from app.routers import workspace_project, workspace_reports, workspace_project_factory


@pytest.fixture
def suite(client, monkeypatch):
    monkeypatch.setenv("WORKSPACE_PROJECT_SUITE_ENABLED", "1")
    with client.sync_engine.begin() as conn:
        run_project_migration(conn)
    client.app.include_router(workspace_project.router, prefix="/api/workspace")
    client.app.include_router(workspace_reports.router, prefix="/api/workspace")
    client.app.include_router(workspace_project_factory.router, prefix="/api/workspace")
    client.app.include_router(workspace_project.public_router, prefix="/api/project-portal")
    return client


def planning(suite):
    response = suite.get(f"/api/workspace/projects/{PROJECT}/planning")
    assert response.status_code == 200, response.text
    return response.json()


def save(suite, task_id, **values):
    return suite.put(f"/api/workspace/tasks/{task_id}/planning", json={"expected_version": planning(suite)["version"], **values})


def test_multi_assignee_grants_visibility_and_execution(suite):
    assert save(suite, TASKS[0], assignee_ids=[str(WORKER), str(OUTSIDER)]).status_code == 200
    headers = {"X-Test-User": str(OUTSIDER)}
    response = suite.get(f"/api/workspace/projects/{PROJECT}/board", headers=headers)
    assert response.status_code == 200, response.text
    assert suite.post(f"/api/workspace/tasks/{TASKS[0]}/start", headers=headers).status_code == 200


def test_dependencies_block_execution_and_cycles_are_rejected(suite):
    assert save(suite, TASKS[0], dependency_ids=[str(TASKS[1])]).status_code == 200
    assert suite.post(f"/api/workspace/tasks/{TASKS[0]}/start").status_code == 409
    assert save(suite, TASKS[1], dependency_ids=[str(TASKS[0])]).status_code == 409
    assert save(suite, TASKS[0], dependency_ids=[str(TASKS[0])]).status_code == 422


def test_parent_dependency_cycle_and_cross_project_link_are_rejected(suite):
    assert save(suite, TASKS[0], parent_id=str(TASKS[1])).status_code == 200
    assert save(suite, TASKS[0], parent_id=str(TASKS[1]), dependency_ids=[str(TASKS[1])]).status_code == 409
    assert save(suite, TASKS[0], parent_id=str(uuid.uuid4())).status_code == 422


def test_milestone_requires_closed_tasks_and_tags_are_project_scoped(suite):
    state = planning(suite)
    response = suite.post(f"/api/workspace/projects/{PROJECT}/milestones", json={"name": "Delivery", "expected_version": state["version"]})
    assert response.status_code == 201, response.text
    milestone_id = response.json()["id"]
    assert save(suite, TASKS[0], milestone_id=milestone_id).status_code == 200
    response = suite.put(f"/api/workspace/projects/{PROJECT}/milestones/{milestone_id}", json={"name": "Delivery", "reached": True, "expected_version": planning(suite)["version"]})
    assert response.status_code == 409
    assert save(suite, TASKS[0], tag_ids=[str(uuid.uuid4())]).status_code == 422


def test_comments_notifications_and_internal_history(suite):
    response = suite.post(f"/api/workspace/tasks/{TASKS[0]}/comments", json={"body": "Please inspect", "mention_ids": [str(WORKER)]})
    assert response.status_code == 201, response.text
    result = suite.get(f"/api/workspace/tasks/{TASKS[0]}/details")
    assert result.status_code == 200, result.text
    assert result.json()["comments"][0]["body"] == "Please inspect"
    assert any(e["action"] == "Komentar ditambahkan" for e in result.json()["events"])
    assert suite.post(f"/api/workspace/tasks/{TASKS[0]}/comments", json={"body": "x", "external": True}, headers={"X-Test-User": str(WORKER)}).status_code == 403


def test_timesheets_are_idempotent_and_cannot_exceed_day_or_edit_others(suite):
    body = {"request_id": str(uuid.uuid4()), "work_date": str(date.today()), "minutes": 1000, "description": "Fabrication"}
    path = f"/api/workspace/tasks/{TASKS[0]}/time-entries"
    headers = {"X-Test-User": str(WORKER)}
    first = suite.post(path, json=body, headers=headers)
    assert first.status_code == 201, first.text
    assert suite.post(path, json=body, headers=headers).json()["id"] == first.json()["id"]
    assert suite.post(path, json={**body, "request_id": str(uuid.uuid4())}, headers=headers).status_code == 409
    assert suite.delete(f"/api/workspace/time-entries/{first.json()['id']}", headers={"X-Test-User": str(OTHER)}).status_code == 403


def test_attachment_download_is_scoped_and_safe(suite):
    response = suite.post(f"/api/workspace/tasks/{TASKS[0]}/attachments", files={"file": ("../report.txt", b"local report", "text/plain")})
    assert response.status_code == 201, response.text
    attachment = response.json()
    assert attachment["name"] == "report.txt"
    result = suite.get(f"/api/workspace/attachments/{attachment['id']}")
    assert result.content == b"local report" and result.headers["x-content-type-options"] == "nosniff"
    assert suite.get(f"/api/workspace/attachments/{attachment['id']}", headers={"X-Test-User": str(OUTSIDER)}).status_code == 403
    assert suite.post(f"/api/workspace/tasks/{TASKS[0]}/attachments", files={"file": ("script.html", b"<script/>", "text/html")}).status_code == 415


def test_recurrence_generates_once_and_does_not_copy_review_status(suite):
    body = {"unit": "monthly", "interval": 1, "next_date": str(date.today()), "active": True,
        "expected_version": planning(suite)["version"]}
    response = suite.put(f"/api/workspace/tasks/{TASKS[3]}/recurrence", json=body)
    assert response.status_code == 200, response.text
    url = f"/api/workspace/projects/{PROJECT}/recurrences/run"
    response = suite.post(url)
    assert response.status_code == 200 and response.json()["generated"] == 1, response.text
    assert suite.post(url).json()["generated"] == 0
    board = suite.get(f"/api/workspace/projects/{PROJECT}/board").json()
    generated = [t for t in board["tasks"] if t["id"] not in {str(key) for key in TASKS}]
    assert len(generated) == 1 and generated[0]["status"] == "todo" and not generated[0]["reviewed_at"]


def test_portal_never_exposes_internal_tasks_comments_or_files_and_can_revoke(suite):
    assert save(suite, TASKS[0], portal_visible=True).status_code == 200
    suite.post(f"/api/workspace/tasks/{TASKS[0]}/comments", json={"body": "Internal secret"})
    suite.post(f"/api/workspace/tasks/{TASKS[0]}/comments", json={"body": "Customer update", "external": True})
    private_file = suite.post(f"/api/workspace/tasks/{TASKS[0]}/attachments", files={"file": ("secret.txt", b"internal", "text/plain")}).json()
    public_file = suite.post(f"/api/workspace/tasks/{TASKS[0]}/attachments", files={"file": ("customer.txt", b"public", "text/plain")}, data={"external": "true"}).json()
    share = suite.post(f"/api/workspace/projects/{PROJECT}/shares", json={"label": "Customer", "expires_in_days": 7}).json()
    token = share["token"]
    response = suite.get(f"/api/project-portal/{token}")
    assert response.status_code == 200, response.text
    assert len(response.json()["tasks"]) == 1
    assert "Internal secret" not in response.text and "Customer update" in response.text
    assert "secret.txt" not in response.text and "customer.txt" in response.text
    assert suite.get(f"/api/project-portal/{token}/attachments/{private_file['id']}").status_code == 404
    assert suite.get(f"/api/project-portal/{token}/attachments/{public_file['id']}").content == b"public"
    assert suite.delete(f"/api/workspace/projects/{PROJECT}/shares/{share['share']['id']}").status_code == 200
    assert suite.get(f"/api/project-portal/{token}").status_code == 404


def test_expired_portal_token_is_rejected_and_raw_token_not_stored(suite):
    from sqlalchemy import select
    from datetime import datetime, timedelta, timezone
    from sqlalchemy.orm import Session
    from db.models.workspace_project import WorkspacePortalShare
    share = suite.post(f"/api/workspace/projects/{PROJECT}/shares", json={"label": "Customer", "expires_in_days": 1}).json()
    with Session(suite.sync_engine) as db:
        record = db.scalar(select(WorkspacePortalShare))
        assert record.token_hash != share["token"]
        record.expires_at = datetime.now(timezone.utc) - timedelta(seconds=1)
        db.commit()
    assert suite.get(f"/api/project-portal/{share['token']}").status_code == 404


def test_copy_project_resets_execution_and_retries_are_idempotent(suite):
    assert save(suite, TASKS[0], parent_id=str(TASKS[1])).status_code == 200
    body = {"name": "Reusable project", "request_id": str(uuid.uuid4())}
    url = f"/api/workspace/projects/{PROJECT}/duplicate"
    first = suite.post(url, json=body)
    assert first.status_code == 201, first.text
    assert suite.post(url, json=body).json()["project_id"] == first.json()["project_id"]
    board = suite.get(f"/api/workspace/projects/{first.json()['project_id']}/board").json()
    assert len(board["tasks"]) == 5 and all(t["status"] == "todo" and not t["reviewed_by"] for t in board["tasks"])
    assert any(t["planning"]["parent_id"] for t in board["tasks"])


def test_sale_reference_creates_work_orders_once(suite):
    body = {"reference": "so-001", "customer": "Local customer", "project_name": "Service project", "lines": ["Inspect", "Commission"]}
    first = suite.post("/api/workspace/sales-orders", json=body)
    assert first.status_code == 201, first.text
    again = suite.post("/api/workspace/sales-orders", json={**body, "reference": "SO-001"})
    assert again.json()["project_id"] == first.json()["project_id"]
    board = suite.get(f"/api/workspace/projects/{first.json()['project_id']}/board").json()
    assert len(board["tasks"]) == 2


def test_reports_notifications_and_search(suite):
    suite.post(f"/api/workspace/tasks/{TASKS[0]}/comments", json={"body": "Notify worker"})
    notifications = suite.get(f"/api/workspace/projects/{PROJECT}/notifications", headers={"X-Test-User": str(WORKER)}).json()
    assert len(notifications) == 1
    assert suite.post(f"/api/workspace/notifications/{notifications[0]['id']}/read").status_code == 404
    assert suite.post(f"/api/workspace/notifications/{notifications[0]['id']}/read", headers={"X-Test-User": str(WORKER)}).status_code == 200
    report = suite.get(f"/api/workspace/projects/{PROJECT}/report")
    assert report.status_code == 200 and report.json()["total"] == 5 and report.json()["done"] == 1, report.text
    assert len(report.json()["burndown"]) == 30
    result = suite.get(f"/api/workspace/projects/{PROJECT}/task-search?status=todo&limit=1")
    assert result.status_code == 200 and result.json()["total"] == 1


def test_suite_migration_down_and_up_preserves_core_tasks(suite):
    from sqlalchemy import select, inspect
    from db.models.workspace import WorkspaceTask
    from db.models.workspace_project import PROJECT_MODELS
    with suite.sync_engine.begin() as conn:
        for model in PROJECT_MODELS:
            assert conn.exec_driver_sql(f"SELECT relrowsecurity FROM pg_class WHERE relname='{model.__tablename__}'").scalar()
        run_project_migration(conn, "downgrade")
        assert not inspect(conn).has_table("workspace_task_plans")
        assert len(conn.execute(select(WorkspaceTask.id)).all()) == 5
        run_project_migration(conn)


def test_parent_approval_waits_for_all_subtasks(suite):
    response = suite.post(f"/api/workspace/tasks/{TASKS[2]}/subtasks", json={"name": "Child inspection", "expected_version": planning(suite)["version"]})
    assert response.status_code == 201, response.text
    child_id = response.json()["id"]
    assert suite.post(f"/api/workspace/tasks/{TASKS[2]}/review", json={"decision": "approve"}).status_code == 409
    assert suite.post(f"/api/workspace/tasks/{child_id}/submit-report", json={"notes": "Child ready"}).status_code == 200
    assert suite.post(f"/api/workspace/tasks/{child_id}/review", json={"decision": "approve"}).status_code == 200
    assert suite.post(f"/api/workspace/tasks/{TASKS[2]}/review", json={"decision": "approve"}).status_code == 200


def test_legacy_assignee_edit_removes_old_primary_without_losing_secondary(suite):
    assert save(suite, TASKS[0], assignee_ids=[str(WORKER), str(OTHER)]).status_code == 200
    response = suite.put(f"/api/workspace/tasks/{TASKS[0]}", json={"assigned_to": str(OUTSIDER)})
    assert response.status_code == 200, response.text
    metadata = suite.get(f"/api/workspace/tasks/{TASKS[0]}/details").json()["metadata"]
    assert {p["id"] for p in metadata["assignees"]} == {str(OUTSIDER), str(OTHER)}


def test_search_treats_wildcards_as_literal_and_filters_blocked(suite):
    assert save(suite, TASKS[0], dependency_ids=[str(TASKS[1])]).status_code == 200
    url = f"/api/workspace/projects/{PROJECT}/task-search"
    assert suite.get(url + "?q=%25").json()["total"] == 0
    assert suite.get(url + "?blocked=true").json()["total"] == 1


def test_two_sale_retries_create_only_one_project(suite):
    from concurrent.futures import ThreadPoolExecutor
    body = {"reference": "SO-CONCURRENT", "customer": "Test", "project_name": "Concurrent", "lines": ["One task"]}
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(lambda _: suite.post("/api/workspace/sales-orders", json=body), range(2)))
    assert all(result.status_code == 201 for result in results)
    assert len({result.json()["project_id"] for result in results}) == 1


def test_assignment_notifies_new_assignee(suite):
    assert save(suite, TASKS[0], assignee_ids=[str(OUTSIDER)]).status_code == 200
    notifications = suite.get(f"/api/workspace/projects/{PROJECT}/notifications", headers={"X-Test-User": str(OUTSIDER)}).json()
    assert any("Penanggung jawab" in item["message"] for item in notifications)


def test_time_request_id_cannot_silently_change_payload(suite):
    body = {"request_id": str(uuid.uuid4()), "work_date": str(date.today()), "minutes": 30, "description": "Original"}
    path = f"/api/workspace/tasks/{TASKS[0]}/time-entries"
    assert suite.post(path, json=body).status_code == 201
    assert suite.post(path, json={**body, "minutes": 90}).status_code == 409


def test_concurrent_timesheets_cannot_exceed_daily_budget(suite):
    from concurrent.futures import ThreadPoolExecutor
    def log(task_id):
        return suite.post(f"/api/workspace/tasks/{task_id}/time-entries", json={
            "request_id": str(uuid.uuid4()), "work_date": str(date.today()), "minutes": 1000, "description": "Concurrent work"}).status_code
    with ThreadPoolExecutor(max_workers=2) as pool:
        statuses = list(pool.map(log, TASKS[:2]))
    assert sorted(statuses) == [201, 409]


def test_logging_time_and_starting_wo_can_run_together(suite):
    from concurrent.futures import ThreadPoolExecutor
    def action(kind):
        if kind == "start":
            return suite.post(f"/api/workspace/tasks/{TASKS[0]}/start").status_code
        return suite.post(f"/api/workspace/tasks/{TASKS[0]}/time-entries", json={
            "request_id": str(uuid.uuid4()), "work_date": str(date.today()), "minutes": 60, "description": "Start inspection"}).status_code
    with ThreadPoolExecutor(max_workers=2) as pool:
        statuses = list(pool.map(action, ["start", "time"]))
    assert statuses == [200, 201]
