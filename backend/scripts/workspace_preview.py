"""Isolated, loopback-only Workspace preview. Never uses DATABASE_URL/.env data.

Run: python scripts/workspace_preview.py
Postgres: 127.0.0.1:55439, database rein_workspace_preview (see docs).
"""
import importlib.util
import os
from pathlib import Path
import sys
import uuid
import asyncio
from contextlib import asynccontextmanager
from datetime import timedelta

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "backend"))

from alembic.migration import MigrationContext
from alembic.operations import Operations
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import inspect, select
from sqlalchemy import text
from sqlalchemy.engine import make_url
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.dependencies import get_current_profile
from app.routers import workspace, workspace_board, workspace_project, workspace_reports, workspace_project_factory, workspace_coordination
from app.routers import workspace_materials
from app.routers import workspace_work_orders
from db.models import Base, Profile, AppRole
from db.models.client import Client
from db.models.role_permission import RolePermission
from db.models.library_folder import LibraryFolder
from db.models.library_file import LibraryFile
from db.models.library_audit_log import LibraryAuditLog
from db.models.folder_permission import FolderPermission
from db.models.workspace import (
    ProjectTemplate, PhaseTemplate, TaskTemplate, WorkspaceProject,
    WorkspacePhase, WorkspaceTask, TaskCompletion, ProjectStatus, PhaseStatus, TaskStatus,
)
from db.session import get_db

ADMIN_ID = uuid.UUID("11111111-1111-4111-8111-111111111111")
PROJECT_ID = uuid.UUID("22222222-2222-4222-8222-222222222222")
PHASE_ID = uuid.UUID("33333333-3333-4333-8333-333333333333")
LEGACY_TABLES = [Client.__table__, Profile.__table__, RolePermission.__table__, ProjectTemplate.__table__,
    PhaseTemplate.__table__, TaskTemplate.__table__, WorkspaceProject.__table__,
    WorkspacePhase.__table__, WorkspaceTask.__table__, TaskCompletion.__table__,
    LibraryFolder.__table__, LibraryFile.__table__, LibraryAuditLog.__table__, FolderPermission.__table__]
URL = os.getenv("WORKSPACE_PREVIEW_DATABASE_URL",
    "postgresql+asyncpg://rein:rein_preview_local@127.0.0.1:55439/rein_workspace_preview")


def checked_url(url):
    parsed = make_url(url)
    if (parsed.host not in {"127.0.0.1", "localhost"}
            or parsed.database not in {"rein_workspace_preview", "rein_workspace_preview_test"}
            or parsed.drivername != "postgresql+asyncpg"):
        raise RuntimeError("Preview requires the dedicated loopback PostgreSQL database")
    return url


engine = create_async_engine(checked_url(URL))
sessions = async_sessionmaker(engine, expire_on_commit=False)


def run_stage_migration(connection, direction="upgrade"):
    path = ROOT / "db/alembic/versions/20261106_01_workspace_stages.py"
    spec = importlib.util.spec_from_file_location("workspace_stage_migration", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    with Operations.context(MigrationContext.configure(connection)):
        getattr(module, direction)()


def run_project_migration(connection, direction="upgrade"):
    path = ROOT / "db/alembic/versions/20261106_02_workspace_suite.py"
    spec = importlib.util.spec_from_file_location("workspace_project_migration", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    with Operations.context(MigrationContext.configure(connection)):
        getattr(module, direction)()


def run_coordination_migration(connection, direction="upgrade"):
    path = ROOT / "db/alembic/versions/20261106_03_workspace_coordination.py"
    spec = importlib.util.spec_from_file_location("workspace_coordination_migration", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    with Operations.context(MigrationContext.configure(connection)):
        getattr(module, direction)()


def run_logbook_migration(connection, direction="upgrade"):
    path = ROOT / "db/alembic/versions/20261106_04_workspace_logbook.py"
    spec = importlib.util.spec_from_file_location("workspace_logbook_migration", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    with Operations.context(MigrationContext.configure(connection)):
        getattr(module, direction)()


def run_cancelled_migration(connection):
    connection.exec_driver_sql("ALTER TYPE task_status ADD VALUE IF NOT EXISTS 'cancelled'")


def run_archive_migration(connection):
    path = ROOT / "db/alembic/versions/20261106_07_workspace_archive.py"
    spec = importlib.util.spec_from_file_location("workspace_archive_migration", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    with Operations.context(MigrationContext.configure(connection)):
        module.upgrade()


def run_integration_migration(connection):
    path = ROOT / "db/alembic/versions/20261106_06_workspace_integration.py"
    spec = importlib.util.spec_from_file_location("workspace_integration_migration", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    with Operations.context(MigrationContext.configure(connection)):
        module.upgrade()


async def prepare():
    async with engine.begin() as connection:
        await connection.run_sync(lambda conn: Base.metadata.create_all(conn, tables=LEGACY_TABLES))
        await connection.execute(text("ALTER TABLE workspace_projects ADD COLUMN IF NOT EXISTS archived_at timestamptz"))
        await connection.execute(text("CREATE SEQUENCE IF NOT EXISTS workspace_wo_number_seq"))
        await connection.execute(text("ALTER TABLE workspace_tasks ADD COLUMN IF NOT EXISTS wo_number integer DEFAULT nextval('workspace_wo_number_seq')"))
    async with sessions.begin() as db:
        if not await db.get(Profile, ADMIN_ID):
            db.add(Profile(id=ADMIN_ID, username="project_preview", full_name="Admin Preview", initials="AP", role=AppRole.admin))
            await db.flush()
        if not await db.get(WorkspaceProject, PROJECT_ID):
            db.add(WorkspaceProject(id=PROJECT_ID, name="Fabrikasi Reactor Tank — Demo Lokal", client_name="Klien Demo",
                rpo_number="DEMO-2026-001", manager_id=ADMIN_ID, status=ProjectStatus.active))
            await db.flush()
            db.add(WorkspacePhase(id=PHASE_ID, project_id=PROJECT_ID, name="Engineering & Fabrikasi", order=1, status=PhaseStatus.active))
            await db.flush()
            for index, (name, status) in enumerate([
                ("Review gambar fabrikasi", TaskStatus.todo),
                ("Pengadaan material utama", TaskStatus.todo),
                ("Pemotongan dan rolling shell", TaskStatus.in_progress),
                ("Inspeksi sambungan las", TaskStatus.pending_review),
                ("Dokumen material diterima", TaskStatus.done),
            ]):
                db.add(WorkspaceTask(id=uuid.uuid5(PROJECT_ID, name), phase_id=PHASE_ID, name=name,
                    assigned_to=ADMIN_ID, status=status, order=index, location="Workshop — Demo",
                    description="Data contoh lokal untuk mencoba tahap kerja dan review WO."))
        report_task = uuid.uuid5(PROJECT_ID, "Inspeksi sambungan las")
        await db.flush()
        if not await db.scalar(select(TaskCompletion.id).where(TaskCompletion.task_id == report_task)):
            db.add(TaskCompletion(task_id=report_task, submitted_by=ADMIN_ID,
                notes="Contoh laporan inspeksi lokal: sambungan siap untuk ditinjau."))
    async with engine.begin() as connection:
        exists = await connection.run_sync(lambda conn: inspect(conn).has_table("workspace_boards"))
        if not exists:
            await connection.run_sync(run_stage_migration)
        if not await connection.run_sync(lambda conn: inspect(conn).has_table("workspace_task_plans")):
            await connection.run_sync(run_project_migration)
        if not await connection.run_sync(lambda conn: inspect(conn).has_table("workspace_members")):
            await connection.run_sync(run_coordination_migration)
        if not await connection.run_sync(lambda conn: inspect(conn).has_table("workspace_work_logs")):
            await connection.run_sync(run_logbook_migration)
        await connection.run_sync(run_cancelled_migration)
        await connection.run_sync(run_integration_migration)
        await connection.run_sync(run_archive_migration)
    await seed_project_features()


async def seed_project_features():
    from app.services.workspace_project import local_today
    from app.routers.workspace_board import _place_unassigned
    from db.models.workspace_project import (WorkspaceMilestone, WorkspaceTaskPlan, WorkspaceTag,
        WorkspaceTaskTag, WorkspaceTaskAssignee, WorkspaceTaskDependency, WorkspaceTimeEntry,
        WorkspaceProjectUpdate, WorkspaceNotification, WorkspaceRecurrence)
    worker_id = uuid.UUID("44444444-4444-4444-8444-444444444444")
    milestone_id = uuid.uuid5(PROJECT_ID, "demo:milestone")
    tag_id = uuid.uuid5(PROJECT_ID, "demo:tag")
    child_id = uuid.uuid5(PROJECT_ID, "demo:subtask")
    today = local_today()
    async with sessions.begin() as db:
        if not await db.get(Profile, worker_id):
            db.add(Profile(id=worker_id, username="engineer_preview", full_name="Engineer Demo", initials="ED", role=AppRole.engineer_mechanical))
        if not await db.get(WorkspaceMilestone, milestone_id):
            db.add(WorkspaceMilestone(id=milestone_id, project_id=PROJECT_ID, name="Engineering Release", deadline=today + timedelta(days=7)))
        if not await db.get(WorkspaceTag, tag_id):
            db.add(WorkspaceTag(id=tag_id, project_id=PROJECT_ID, name="Quality Assurance"))
        await db.flush()
        source_names = ["Review gambar fabrikasi", "Pengadaan material utama", "Pemotongan dan rolling shell", "Inspeksi sambungan las", "Dokumen material diterima"]
        for index, name in enumerate(source_names):
            task_id = uuid.uuid5(PROJECT_ID, name)
            if not await db.get(WorkspaceTaskPlan, task_id):
                db.add(WorkspaceTaskPlan(task_id=task_id, milestone_id=milestone_id if index == 0 else None,
                    priority=2 if index == 0 else 0, estimated_minutes=120, portal_visible=index == 0))
                task = await db.get(WorkspaceTask, task_id)
                if not task.deadline:
                    task.deadline = today + timedelta(days=index + 2)
                if not task.estimated_days:
                    task.estimated_days = index + 1
                db.add(WorkspaceTaskAssignee(task_id=task_id, profile_id=ADMIN_ID))
                if index == 0:
                    db.add(WorkspaceTaskAssignee(task_id=task_id, profile_id=worker_id))
                    db.add(WorkspaceTaskTag(task_id=task_id, tag_id=tag_id))
        if not await db.get(WorkspaceTask, child_id):
            db.add(WorkspaceTask(id=child_id, phase_id=PHASE_ID, name="Verifikasi sertifikat material", assigned_to=worker_id,
                status=TaskStatus.todo, order=6, deadline=today + timedelta(days=3), estimated_days=1))
            await db.flush()
            db.add(WorkspaceTaskPlan(task_id=child_id, parent_id=uuid.uuid5(PROJECT_ID, "Pengadaan material utama"), estimated_minutes=60))
            db.add(WorkspaceTaskAssignee(task_id=child_id, profile_id=worker_id))
            db.add(WorkspaceTaskDependency(task_id=uuid.uuid5(PROJECT_ID, "Pengadaan material utama"), predecessor_id=uuid.uuid5(PROJECT_ID, "Review gambar fabrikasi")))
        time_id = uuid.uuid5(PROJECT_ID, "demo:time")
        if not await db.get(WorkspaceTimeEntry, time_id):
            db.add(WorkspaceTimeEntry(id=time_id, task_id=uuid.uuid5(PROJECT_ID, "Review gambar fabrikasi"), profile_id=ADMIN_ID,
                work_date=today, minutes=60, description="Review awal gambar — contoh lokal"))
        update_id = uuid.uuid5(PROJECT_ID, "demo:update")
        if not await db.get(WorkspaceProjectUpdate, update_id):
            db.add(WorkspaceProjectUpdate(id=update_id, project_id=PROJECT_ID, author_id=ADMIN_ID,
                health="on_track", summary="Review engineering berjalan. Pengadaan dimulai setelah gambar disetujui. Data ini adalah contoh lokal.", external=True))
            db.add(WorkspaceNotification(project_id=PROJECT_ID, profile_id=ADMIN_ID, message="Proyek contoh siap dicoba: perencanaan, laporan waktu, dan portal pelanggan."))
        recurrence_task = uuid.uuid5(PROJECT_ID, "Inspeksi sambungan las")
        if not await db.scalar(select(WorkspaceRecurrence.id).where(WorkspaceRecurrence.task_id == recurrence_task)):
            db.add(WorkspaceRecurrence(task_id=recurrence_task, unit="weekly", interval=1, next_date=today + timedelta(days=7), anchor_day=today.day))
        await _place_unassigned(db, PROJECT_ID)


async def preview_db():
    async with sessions() as db:
        try:
            yield db
            await db.commit()
        except Exception:
            await db.rollback()
            raise


async def preview_profile():
    async with sessions() as db:
        return await db.get(Profile, ADMIN_ID)


@asynccontextmanager
async def preview_lifespan(app):
    os.environ["WORKSPACE_STAGES_ENABLED"] = "1"
    os.environ["WORKSPACE_PROJECT_SUITE_ENABLED"] = "1"
    os.environ["WORKSPACE_COORDINATION_ENABLED"] = "1"
    os.environ["WORKSPACE_RECURRENCE_WORKER_ENABLED"] = "1"
    await prepare()
    from app.services.workspace_recurrence import recurrence_loop
    worker = asyncio.create_task(recurrence_loop(sessions))
    try:
        yield
    finally:
        worker.cancel()
        await asyncio.gather(worker, return_exceptions=True)
        await engine.dispose()


app = FastAPI(title="REIN isolated Project preview", lifespan=preview_lifespan)
app.add_middleware(CORSMiddleware, allow_origins=["http://localhost:3000", "http://127.0.0.1:3000", "http://localhost:3001", "http://127.0.0.1:3001"],
    allow_credentials=True, allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["Content-Type", "Authorization"])
app.dependency_overrides[get_db] = preview_db
app.dependency_overrides[get_current_profile] = preview_profile
from app.routers import library
from app.limiter import limiter
app.state.limiter = limiter
app.include_router(library.router, prefix="/api/library")
app.include_router(workspace.router, prefix="/api/workspace")
app.include_router(workspace_board.router, prefix="/api/workspace")
app.include_router(workspace_project.router, prefix="/api/workspace")
app.include_router(workspace_reports.router, prefix="/api/workspace")
app.include_router(workspace_project_factory.router, prefix="/api/workspace")
app.include_router(workspace_coordination.router, prefix="/api/workspace")
app.include_router(workspace_materials.router, prefix="/api/workspace")
app.include_router(workspace_work_orders.router, prefix="/api/workspace")
app.include_router(workspace_project.public_router, prefix="/api/project-portal")


@app.get("/api/health")
async def health():
    return {"status": "ok", "mode": "isolated-project-preview"}


if __name__ == "__main__":
    import uvicorn
    # No background workers, production routes, or production authentication.
    uvicorn.run(app, host="127.0.0.1", port=8001)
