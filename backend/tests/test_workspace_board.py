"""Real PostgreSQL migration/API tests. Explicit loopback test database only."""
import os
import uuid
from datetime import datetime, timezone

import pytest
from fastapi import FastAPI, Header
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select, inspect
from sqlalchemy.orm import Session
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker
from sqlalchemy.pool import NullPool

from app.dependencies import get_current_profile
from app.routers import workspace, workspace_board
from db.models import Base, Profile, AppRole
from db.models.role_permission import RolePermission
from db.models.workspace import WorkspaceProject, WorkspacePhase, WorkspaceTask, TaskCompletion, TaskStatus
from db.models.workspace_board import WorkspaceBoard, WorkspaceTaskStage, WorkspaceTaskPlacement
from db.models.workspace_project import PROJECT_MODELS
from db.models.workspace_coordination import COORDINATION_MODELS
from db.models.workspace_logbook import LOGBOOK_MODELS
from db.models.workspace_archive import WorkspaceArchiveFile
from db.session import get_db
from scripts.workspace_preview import LEGACY_TABLES, checked_url, run_stage_migration

URL = os.getenv("WORKSPACE_TEST_DATABASE_URL", "")
pytestmark = pytest.mark.skipif(not URL, reason="Set explicit WORKSPACE_TEST_DATABASE_URL to the dedicated local test database")
ADMIN, WORKER, OUTSIDER, OTHER = [uuid.uuid4() for _ in range(4)]
PROJECT, OTHER_PROJECT, PHASE, OTHER_PHASE = [uuid.uuid4() for _ in range(4)]
TASKS = [uuid.uuid4() for _ in range(5)]
BOARD_TABLES = [WorkspaceBoard.__table__, WorkspaceTaskStage.__table__, WorkspaceTaskPlacement.__table__]


@pytest.fixture
def client(monkeypatch):
    checked_url(URL)
    assert URL.endswith("/rein_workspace_preview_test"), "Tests may reset only the dedicated test database"
    monkeypatch.setenv("WORKSPACE_STAGES_ENABLED", "1")
    monkeypatch.setenv("WORKSPACE_ARCHIVE_ENABLED", "0")
    monkeypatch.setenv("WORKSPACE_PROJECT_SUITE_ENABLED", "0")
    monkeypatch.setenv("WORKSPACE_COORDINATION_ENABLED", "0")
    sync_engine = create_engine(URL.replace("+asyncpg", "+psycopg2"))
    with sync_engine.begin() as conn:
        Base.metadata.drop_all(conn, tables=[WorkspaceArchiveFile.__table__] + [model.__table__ for model in [*LOGBOOK_MODELS, *COORDINATION_MODELS, *PROJECT_MODELS]] + BOARD_TABLES + LEGACY_TABLES)
        Base.metadata.create_all(conn, tables=LEGACY_TABLES)
    with Session(sync_engine) as db:
        for user_id, name, role in [(ADMIN, "Admin", AppRole.admin), (WORKER, "Worker", AppRole.engineer_mechanical),
                                    (OUTSIDER, "Outsider", AppRole.engineer_mechanical), (OTHER, "Other", AppRole.engineer_mechanical)]:
            db.add(Profile(id=user_id, username=name, full_name=name, role=role))
        for key in ("workspace:view", "workspace:execute_wo", "workspace:complete_task"):
            db.add(RolePermission(role=AppRole.engineer_mechanical, permission=key))
        db.flush()
        db.add_all([WorkspaceProject(id=PROJECT, name="Test", manager_id=ADMIN),
                    WorkspaceProject(id=OTHER_PROJECT, name="Other", manager_id=OUTSIDER)])
        db.flush()
        db.add_all([WorkspacePhase(id=PHASE, project_id=PROJECT, name="Phase"),
                    WorkspacePhase(id=OTHER_PHASE, project_id=OTHER_PROJECT, name="Other Phase")])
        db.flush()
        for index, state in enumerate((TaskStatus.todo, TaskStatus.in_progress, TaskStatus.pending_review, TaskStatus.done, TaskStatus.overdue)):
            db.add(WorkspaceTask(id=TASKS[index], phase_id=PHASE, name=f"Task {index}", status=state,
                assigned_to=WORKER if index != 1 else OTHER, order=index, review_notes="keep me",
                reviewed_by=ADMIN if state == TaskStatus.done else None))
        db.flush()
        db.add(TaskCompletion(task_id=TASKS[2], submitted_by=WORKER, notes="Inspection report", completed_at=datetime.now(timezone.utc)))
        db.commit()
    with sync_engine.begin() as conn:
        run_stage_migration(conn)
    async_engine = create_async_engine(URL, poolclass=NullPool)
    sessions = async_sessionmaker(async_engine, expire_on_commit=False)

    async def database():
        async with sessions() as db:
            try:
                yield db
                await db.commit()
            except Exception:
                await db.rollback()
                raise

    async def profile(x_test_user: str = Header(default=str(ADMIN))):
        async with sessions() as db:
            return await db.get(Profile, uuid.UUID(x_test_user))

    app = FastAPI()
    app.dependency_overrides[get_db] = database
    app.dependency_overrides[get_current_profile] = profile
    app.include_router(workspace.router, prefix="/api/workspace")
    app.include_router(workspace_board.router, prefix="/api/workspace")
    with TestClient(app) as http:
        http.sync_engine = sync_engine
        yield http
    sync_engine.dispose()


def board(client):
    result = client.get(f"/api/workspace/projects/{PROJECT}/board")
    assert result.status_code == 200, result.text
    return result.json()


def move(client, state, task_id, stage_id, **extra):
    return client.put(f"/api/workspace/projects/{PROJECT}/board/tasks/{task_id}",
        json={"stage_id": stage_id, "expected_version": state["version"], **extra})


def test_migration_backfills_all_tasks_without_changing_status(client):
    state = board(client)
    assert len(state["stages"]) == 4
    assert len(state["tasks"]) == 5
    assert {t["status"] for t in state["tasks"]} == {s.value for s in TaskStatus if s != TaskStatus.cancelled}
    overdue = next(t for t in state["tasks"] if t["status"] == "overdue")
    assert overdue["stage_id"] == state["stages"][1]["id"]
    with client.sync_engine.connect() as conn:
        for table in BOARD_TABLES:
            assert conn.exec_driver_sql(f"SELECT relrowsecurity FROM pg_class WHERE relname = '{table.name}'").scalar()


def test_move_preserves_review_and_lifecycle_and_persists_order(client):
    state = board(client)
    response = move(client, state, TASKS[3], state["stages"][0]["id"], before_task_id=str(TASKS[0]))
    assert response.status_code == 200, response.text
    refreshed = board(client)
    task = next(t for t in refreshed["tasks"] if t["id"] == str(TASKS[3]))
    assert task["status"] == "done" and task["reviewed_by"] == str(ADMIN) and task["review_notes"] == "keep me"
    target = [t["id"] for t in refreshed["tasks"] if t["stage_id"] == state["stages"][0]["id"]]
    assert target == [str(TASKS[3]), str(TASKS[0])]
    assert refreshed["version"] == state["version"] + 1


def test_stale_board_write_is_rejected_without_overwriting(client):
    state = board(client)
    assert move(client, state, TASKS[0], state["stages"][1]["id"]).status_code == 200
    assert move(client, state, TASKS[0], state["stages"][2]["id"]).status_code == 409
    assert next(t for t in board(client)["tasks"] if t["id"] == str(TASKS[0]))["stage_id"] == state["stages"][1]["id"]


def test_create_rename_reorder_fold_delete_empty_stage(client):
    state = board(client)
    url = f"/api/workspace/projects/{PROJECT}/board/stages"
    result = client.post(url, json={"name": "  Pengadaan  ", "expected_version": state["version"]})
    assert result.status_code == 201
    state = result.json(); stage = state["stages"][-1]
    result = client.put(f"{url}/{stage['id']}", json={"name": "Procurement", "sequence": 0, "folded": True, "expected_version": state["version"]})
    assert result.status_code == 200
    state = result.json()
    assert state["stages"][0]["name"] == "Procurement" and state["stages"][0]["folded"]
    result = client.delete(f"{url}/{stage['id']}?expected_version={state['version']}")
    assert result.status_code == 200 and len(result.json()["stages"]) == 4


def test_nonempty_stage_cannot_be_deleted(client):
    state = board(client)
    url = f"/api/workspace/projects/{PROJECT}/board/stages/{state['stages'][0]['id']}?expected_version={state['version']}"
    assert client.delete(url).status_code == 409
    assert len(board(client)["stages"]) == 4


def test_cross_project_target_is_rejected(client):
    response = client.get(f"/api/workspace/projects/{OTHER_PROJECT}/board")
    assert move(client, board(client), TASKS[0], response.json()["stages"][0]["id"]).status_code == 404


@pytest.mark.parametrize("path", [f"projects/{PROJECT}/board", f"projects/{PROJECT}/phases", f"phases/{PHASE}/tasks", f"tasks/{TASKS[2]}/completions"])
def test_outsider_cannot_read_records_by_id(client, path):
    assert client.get(f"/api/workspace/{path}", headers={"X-Test-User": str(OUTSIDER)}).status_code == 403


def test_assignee_can_move_own_but_not_another_workers_task(client):
    state = board(client)
    path = f"/api/workspace/projects/{PROJECT}/board/tasks/"
    headers = {"X-Test-User": str(WORKER)}
    body = {"stage_id": state["stages"][2]["id"], "expected_version": state["version"]}
    assert client.put(path + str(TASKS[1]), json=body, headers=headers).status_code == 403
    assert client.put(path + str(TASKS[0]), json=body, headers=headers).status_code == 200


def test_generic_status_update_cannot_skip_review(client):
    result = client.put(f"/api/workspace/tasks/{TASKS[0]}", json={"status": "done"}, headers={"X-Test-User": str(WORKER)})
    assert result.status_code == 409
    assert next(t for t in board(client)["tasks"] if t["id"] == str(TASKS[0]))["status"] == "todo"


def test_legacy_completion_now_submits_report_then_requires_review(client):
    headers = {"X-Test-User": str(WORKER)}
    result = client.post(f"/api/workspace/tasks/{TASKS[0]}/complete", json={"notes": "Finished in field"}, headers=headers)
    assert result.status_code == 201, result.text
    assert next(t for t in board(client)["tasks"] if t["id"] == str(TASKS[0]))["status"] == "pending_review"
    assert client.post(f"/api/workspace/tasks/{TASKS[0]}/review", json={"decision": "approve"}, headers=headers).status_code == 403
    result = client.post(f"/api/workspace/tasks/{TASKS[0]}/review", json={"decision": "approve"})
    assert result.status_code == 200 and result.json()["status"] == "done"
    assert result.json()["reviewed_by"] == str(ADMIN) and result.json()["reviewed_at"]
    assert client.post(f"/api/workspace/tasks/{TASKS[0]}/complete", json={"notes": "stale"}, headers=headers).status_code == 409


def test_empty_report_is_rejected_and_review_requires_report(client):
    assert client.post(f"/api/workspace/tasks/{TASKS[0]}/submit-report", json={}).status_code == 422
    assert client.post(f"/api/workspace/tasks/{TASKS[0]}/review", json={"decision": "approve"}).status_code == 409


def test_revision_note_and_status_validation(client):
    assert client.post(f"/api/workspace/tasks/{TASKS[2]}/review", json={"decision": "request_revision", "review_notes": "  "}).status_code == 400
    result = client.post(f"/api/workspace/tasks/{TASKS[2]}/review", json={"decision": "request_revision", "review_notes": " Perbaiki sambungan "})
    assert result.status_code == 200
    assert result.json()["status"] == "in_progress" and result.json()["review_notes"] == "Perbaiki sambungan"


def test_feature_disabled_does_not_query_unmigrated_board_tables(client, monkeypatch):
    monkeypatch.delenv("WORKSPACE_STAGES_ENABLED")
    assert client.get(f"/api/workspace/projects/{PROJECT}/board").status_code == 503


def test_downgrade_keeps_legacy_work_orders(client):
    with client.sync_engine.begin() as conn:
        run_stage_migration(conn, "downgrade")
        assert not inspect(conn).has_table("workspace_boards")
        assert len(conn.execute(select(WorkspaceTask.id)).all()) == 5
        run_stage_migration(conn)
    assert len(board(client)["tasks"]) == 5


def test_new_task_invalidates_board_version_and_keeps_stage_when_reordered(client):
    state = board(client)
    result = client.post(f"/api/workspace/phases/{PHASE}/tasks", json={"name": "New WO"})
    assert result.status_code == 201, result.text
    task_id = result.json()["id"]
    new_state = board(client)
    assert new_state["version"] == state["version"] + 1
    first_stage = new_state["stages"][0]
    stage_id = next(t for t in new_state["tasks"] if t["id"] == task_id)["stage_id"]
    result = client.put(f"/api/workspace/projects/{PROJECT}/board/stages/{first_stage['id']}",
        json={"name": first_stage["name"], "sequence": 2, "expected_version": new_state["version"]})
    assert result.status_code == 200
    assert next(t for t in result.json()["tasks"] if t["id"] == task_id)["stage_id"] == stage_id


def test_simultaneous_moves_only_one_wins(client):
    from concurrent.futures import ThreadPoolExecutor
    state = board(client)
    with ThreadPoolExecutor(max_workers=2) as workers:
        results = list(workers.map(lambda target: move(client, state, TASKS[0], target).status_code,
            [state["stages"][1]["id"], state["stages"][2]["id"]]))
    assert sorted(results) == [200, 409]
    assert board(client)["version"] == state["version"] + 1


def test_new_project_can_initialize_board_once(client):
    result = client.post("/api/workspace/projects", json={"name": "New project", "rpo_number":"RPO-TEST-NEW", "client_name":"Client", "start_date":"2026-11-06", "deadline":"2026-11-20"})
    assert result.status_code == 201
    project_id = result.json()["id"]
    url = f"/api/workspace/projects/{project_id}/board"
    state = client.get(url).json()
    assert state == {"version": 0, "stages": [], "tasks": []}
    result = client.post(url + "/initialize", json={"expected_version": 0})
    assert result.status_code == 200 and len(result.json()["stages"]) == 4
    assert client.post(url + "/initialize", json={"expected_version": 1}).status_code == 409
