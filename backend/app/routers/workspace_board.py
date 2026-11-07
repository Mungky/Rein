"""Versioned project stages; board moves never change a Work Order's status."""
import os
import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.dependencies import require_permission
from app.routers.workspace import TaskOut, _can, _date_str, _require_project_access
from db.models.profile import Profile
from db.models.workspace import WorkspacePhase, WorkspaceTask, WorkspaceProject
from db.models.workspace_board import WorkspaceBoard, WorkspaceTaskPlacement, WorkspaceTaskStage
from db.session import get_db
from app.services import workspace_project as project_rules
from app.services.workspace_workflow import status_targets


def require_stages():
    if os.getenv("WORKSPACE_STAGES_ENABLED") != "1":
        raise HTTPException(503, "Tahap proyek belum diaktifkan. Migrasi database diperlukan.")


router = APIRouter(dependencies=[Depends(require_stages)])
DB = Annotated[AsyncSession, Depends(get_db)]
Reader = Annotated[Profile, Depends(require_permission("workspace:view"))]
Manager = Annotated[Profile, Depends(require_permission("workspace:view", "workspace:manage"))]


class BoardVersion(BaseModel):
    expected_version: int = Field(ge=0)


class StageCreate(BoardVersion):
    name: str = Field(min_length=1, max_length=80)

    @field_validator("name")
    @classmethod
    def clean_name(cls, value):
        value = value.strip()
        if not value:
            raise ValueError("Nama tahap wajib diisi")
        return value


class StageUpdate(StageCreate):
    sequence: int = Field(ge=0)
    folded: bool = False


class TaskMove(BoardVersion):
    stage_id: uuid.UUID
    before_task_id: uuid.UUID | None = None


class StageOut(BaseModel):
    id: str
    name: str
    sequence: int
    folded: bool


class BoardTaskOut(TaskOut):
    stage_id: str | None
    board_order: int
    phase_name: str
    planning: dict | None = None
    allowed_statuses: list[str] = []


class BoardOut(BaseModel):
    version: int
    stages: list[StageOut]
    tasks: list[BoardTaskOut]


async def _stages(db, project_id):
    return (await db.scalars(select(WorkspaceTaskStage)
        .where(WorkspaceTaskStage.project_id == project_id)
        .order_by(WorkspaceTaskStage.sequence, WorkspaceTaskStage.id))).all()


async def _place_unassigned(db, project_id):
    stages = await _stages(db, project_id)
    if not stages:
        return
    task_ids = (await db.scalars(select(WorkspaceTask.id).join(WorkspacePhase)
        .outerjoin(WorkspaceTaskPlacement, WorkspaceTaskPlacement.task_id == WorkspaceTask.id)
        .where(WorkspacePhase.project_id == project_id, WorkspaceTaskPlacement.task_id.is_(None))
        .order_by(WorkspaceTask.order, WorkspaceTask.id))).all()
    # Append after explicit cards in the first stage, preserving their relative order.
    existing = (await db.scalars(select(WorkspaceTaskPlacement.sequence)
        .where(WorkspaceTaskPlacement.stage_id == stages[0].id))).all()
    start = max(existing, default=-1) + 1
    for index, task_id in enumerate(task_ids, start):
        db.add(WorkspaceTaskPlacement(task_id=task_id, stage_id=stages[0].id, sequence=index))
    await db.flush()


async def _lock_board(db, project_id, expected):
    await db.execute(insert(WorkspaceBoard).values(project_id=project_id, version=0)
        .on_conflict_do_nothing(index_elements=[WorkspaceBoard.project_id]))
    board = await db.scalar(select(WorkspaceBoard).where(WorkspaceBoard.project_id == project_id)
        .with_for_update().execution_options(populate_existing=True))
    if expected is not None and board.version != expected:
        raise HTTPException(409, "Papan telah berubah. Muat ulang dan ulangi perubahan Anda.")
    await _place_unassigned(db, project_id)
    return board


async def _stage(db, project_id, stage_id):
    stage = await db.get(WorkspaceTaskStage, stage_id)
    if not stage or stage.project_id != project_id:
        raise HTTPException(404, "Tahap tidak ditemukan pada proyek ini")
    return stage


async def _board_out(db, project_id, profile=None):
    stages = await _stages(db, project_id)
    version = await db.get(WorkspaceBoard, project_id)
    rows = (await db.execute(select(WorkspaceTask, WorkspacePhase.name, Profile.full_name,
        WorkspaceTaskPlacement.stage_id, WorkspaceTaskPlacement.sequence)
        .join(WorkspacePhase, WorkspaceTask.phase_id == WorkspacePhase.id)
        .outerjoin(Profile, WorkspaceTask.assigned_to == Profile.id)
        .outerjoin(WorkspaceTaskPlacement, WorkspaceTaskPlacement.task_id == WorkspaceTask.id)
        .where(WorkspacePhase.project_id == project_id)
        .order_by(WorkspaceTaskPlacement.sequence.asc().nullslast(), WorkspaceTask.order, WorkspaceTask.id))).all()
    tasks = []
    planning = await project_rules.planning_map(db, project_id)
    project = await db.get(WorkspaceProject, project_id)
    manage = bool(profile and await _can(db, profile, "workspace:manage"))
    edit = manage or bool(profile and await _can(db, profile, "workspace:create_wo"))
    review = manage or bool(profile and await _can(db, profile, "workspace:review_wo"))
    execute = manage or bool(profile and await _can(db, profile, "workspace:execute_wo"))
    writable = not project.archived_at and project.status.value not in {"on_hold", "completed"}
    for task, phase_name, assigned_name, stage_id, sequence in rows:
        assigned = profile and (profile.id == task.assigned_to or any(a["id"] == str(profile.id) for a in planning.get(task.id, {}).get("assignees", [])))
        # New tasks default to the first stage without changing the task API/schema.
        fallback = stages[0].id if stages else None
        tasks.append(BoardTaskOut(
            id=str(task.id), wo_number=task.wo_number, phase_id=str(task.phase_id), name=task.name, updated_at=task.updated_at.isoformat(),
            description=task.description, location=task.location, estimated_days=task.estimated_days,
            assigned_to=str(task.assigned_to) if task.assigned_to else None, assigned_name=assigned_name,
            deadline=_date_str(task.deadline), status=task.status.value, notes=task.notes,
            review_notes=task.review_notes, reviewed_by=str(task.reviewed_by) if task.reviewed_by else None,
            reviewed_at=task.reviewed_at.isoformat() if task.reviewed_at else None,
            started_at=task.started_at.isoformat() if task.started_at else None, order=task.order,
            stage_id=str(stage_id or fallback) if (stage_id or fallback) else None,
            board_order=sequence if sequence is not None else task.order, phase_name=phase_name,
            planning=planning.get(task.id),
            allowed_statuses=[state.value for state in status_targets(task.status, manage=manage, edit=edit, review=review, execute=execute and bool(manage or assigned))] if writable else [],
        ))
    return BoardOut(version=version.version if version else 0,
        stages=[StageOut(id=str(s.id), name=s.name, sequence=s.sequence, folded=s.folded) for s in stages], tasks=tasks)


@router.get("/projects/{project_id}/board", response_model=BoardOut)
async def get_board(project_id: uuid.UUID, db: DB, profile: Reader):
    await _require_project_access(db, profile, project_id)
    return await _board_out(db, project_id, profile)


@router.post("/projects/{project_id}/board/initialize", response_model=BoardOut)
async def initialize_board(project_id: uuid.UUID, body: BoardVersion, db: DB, profile: Manager):
    await _require_project_access(db, profile, project_id)
    board = await _lock_board(db, project_id, body.expected_version)
    if await _stages(db, project_id):
        raise HTTPException(409, "Papan sudah memiliki tahap")
    for index, name in enumerate(("Persiapan", "Pelaksanaan", "Pemeriksaan", "Penyerahan")):
        db.add(WorkspaceTaskStage(project_id=project_id, name=name, sequence=index))
    board.version += 1
    await db.flush()
    await _place_unassigned(db, project_id)
    return await _board_out(db, project_id, profile)


@router.post("/projects/{project_id}/board/stages", response_model=BoardOut, status_code=201)
async def create_stage(project_id: uuid.UUID, body: StageCreate, db: DB, profile: Manager):
    await _require_project_access(db, profile, project_id)
    board = await _lock_board(db, project_id, body.expected_version)
    stages = await _stages(db, project_id)
    db.add(WorkspaceTaskStage(project_id=project_id, name=body.name, sequence=len(stages)))
    board.version += 1
    await db.flush()
    return await _board_out(db, project_id, profile)


@router.put("/projects/{project_id}/board/stages/{stage_id}", response_model=BoardOut)
async def update_stage(project_id: uuid.UUID, stage_id: uuid.UUID, body: StageUpdate, db: DB, profile: Manager):
    await _require_project_access(db, profile, project_id)
    board = await _lock_board(db, project_id, body.expected_version)
    stage = await _stage(db, project_id, stage_id)
    stages = [s for s in await _stages(db, project_id) if s.id != stage.id]
    stages.insert(min(body.sequence, len(stages)), stage)
    for index, item in enumerate(stages):
        item.sequence = index
    stage.name, stage.folded = body.name, body.folded
    board.version += 1
    await db.flush()
    return await _board_out(db, project_id, profile)


@router.delete("/projects/{project_id}/board/stages/{stage_id}", response_model=BoardOut)
async def delete_stage(project_id: uuid.UUID, stage_id: uuid.UUID, expected_version: int, db: DB, profile: Manager):
    await _require_project_access(db, profile, project_id)
    board = await _lock_board(db, project_id, expected_version)
    stage = await _stage(db, project_id, stage_id)
    current = await _board_out(db, project_id, profile)
    if len(current.stages) == 1 or any(t.stage_id == str(stage.id) for t in current.tasks):
        raise HTTPException(409, "Pindahkan semua WO terlebih dahulu. Papan harus menyisakan satu tahap.")
    await db.delete(stage)
    board.version += 1
    await db.flush()
    return await _board_out(db, project_id, profile)


@router.put("/projects/{project_id}/board/tasks/{task_id}", response_model=BoardOut)
async def move_task(project_id: uuid.UUID, task_id: uuid.UUID, body: TaskMove, db: DB, profile: Reader):
    await _require_project_access(db, profile, project_id)
    board = await _lock_board(db, project_id, body.expected_version)
    stage = await _stage(db, project_id, body.stage_id)
    task = await db.scalar(select(WorkspaceTask).join(WorkspacePhase)
        .where(WorkspaceTask.id == task_id, WorkspacePhase.project_id == project_id))
    if not task:
        raise HTTPException(404, "WO tidak ditemukan pada proyek ini")
    if not await project_rules.is_assignee(db, task, profile) and not await _can(db, profile, "workspace:manage"):
        raise HTTPException(403, "Hanya penanggung jawab WO atau pengelola yang boleh memindahkan kartu")
    current = await _board_out(db, project_id, profile)
    target_tasks = [t for t in current.tasks if t.stage_id == str(stage.id) and t.id != str(task_id)]
    ids = [uuid.UUID(t.id) for t in target_tasks]
    if body.before_task_id is not None:
        if body.before_task_id not in ids:
            raise HTTPException(409, "Kartu tujuan sudah berpindah. Muat ulang papan.")
        ids.insert(ids.index(body.before_task_id), task_id)
    else:
        ids.append(task_id)
    for index, item_id in enumerate(ids):
        await db.execute(insert(WorkspaceTaskPlacement).values(task_id=item_id, stage_id=stage.id, sequence=index)
            .on_conflict_do_update(index_elements=[WorkspaceTaskPlacement.task_id],
                set_={"stage_id": stage.id, "sequence": index}))
    board.version += 1
    await project_rules.record_event(db, project_id, profile.id, "Tahap WO diubah", task.id,
        {"name": task.name, "stage_id": str(stage.id)})
    await db.flush()
    return await _board_out(db, project_id, profile)
