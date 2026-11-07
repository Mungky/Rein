"""Workspace router — project templates, projects, phases, tasks, completions.

Content is filtered by ASSIGNMENT, not role:
  - Users see projects where they are the manager OR have tasks assigned to them
  - Admins see everything
  - Permission gates (workspace:view / workspace:manage / workspace:complete_task)
    are set by the admin via the role_permissions table — no hardcoded role checks here.

Endpoints:
  GET    /api/workspace/templates
  POST   /api/workspace/templates           (workspace:manage)
  GET    /api/workspace/templates/{id}

  GET    /api/workspace/projects            (assignment-filtered)
  POST   /api/workspace/projects            (workspace:manage)
  GET    /api/workspace/projects/{id}
  PUT    /api/workspace/projects/{id}       (workspace:manage)

  GET    /api/workspace/projects/{id}/phases
  POST   /api/workspace/projects/{id}/phases  (workspace:manage)
  PUT    /api/workspace/phases/{id}           (workspace:manage)

  GET    /api/workspace/phases/{id}/tasks
  POST   /api/workspace/phases/{id}/tasks     (workspace:manage)
  PUT    /api/workspace/tasks/{id}

  GET    /api/workspace/my-tasks
  POST   /api/workspace/tasks/{id}/complete   (workspace:complete_task)
  GET    /api/workspace/tasks/{id}/completions

  GET    /api/workspace/summary
"""

import uuid
import logging
import os
from collections import defaultdict
from datetime import date, datetime, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, field_validator, model_validator
from sqlalchemy.exc import IntegrityError
from sqlalchemy import case, select, func, or_, delete, inspect
from sqlalchemy.ext.asyncio import AsyncSession

from app.dependencies import get_current_profile, require_permission, require_any_permission, _load_permissions
from db.models.profile import Profile, AppRole
from db.models.workspace import (
    ProjectTemplate, PhaseTemplate, TaskTemplate,
    WorkspaceProject, WorkspacePhase, WorkspaceTask, TaskCompletion,
    ProjectStatus, PhaseStatus, TaskStatus,
)
from db.session import get_db
from app.services.workspace_workflow import transition
from app.services import workspace_project as project_rules

logger = logging.getLogger(__name__)
router = APIRouter()


# ---------------------------------------------------------------------------
# Permission helper
# ---------------------------------------------------------------------------

async def _can(db: AsyncSession, profile: Profile, permission: str) -> bool:
    """Check whether the current user's role grants a specific permission."""
    granted = await _load_permissions(db, profile.role)
    return permission in granted


async def _visible_project_ids(db: AsyncSession, profile: Profile) -> list[uuid.UUID] | None:
    """Return the list of project IDs the user may see, or None for 'all'.

    A user sees a project if:
      - They are the assigned manager, OR
      - They have at least one task assigned to them in that project

    Admins always see all projects (returns None).
    """
    if profile.role == AppRole.admin or await _can(db, profile, "workspace:view_all"):
        return None  # no filter

    # Projects where user is manager
    manager_ids = (await db.execute(
        select(WorkspaceProject.id).where(WorkspaceProject.manager_id == profile.id)
    )).scalars().all()

    # Projects where user has tasks assigned
    task_phase_ids = (await db.execute(
        select(WorkspaceTask.phase_id).where(project_rules.assignment_filter(profile.id))
    )).scalars().all()

    assigned_project_ids: list[uuid.UUID] = []
    if task_phase_ids:
        assigned_project_ids = (await db.execute(
            select(WorkspacePhase.project_id)
            .where(WorkspacePhase.id.in_(task_phase_ids))
            .distinct()
        )).scalars().all()

    member_ids = []
    if os.getenv("WORKSPACE_COORDINATION_ENABLED") == "1":
        from db.models.workspace_coordination import WorkspaceMember
        member_ids = (await db.scalars(select(WorkspaceMember.project_id).where(WorkspaceMember.profile_id == profile.id))).all()
    all_ids = list({*manager_ids, *assigned_project_ids, *member_ids})
    return all_ids


async def _require_project_access(db: AsyncSession, profile: Profile, project_id: uuid.UUID):
    project = await db.get(WorkspaceProject, project_id)
    if not project:
        raise HTTPException(404, "Proyek tidak ditemukan")
    visible = await _visible_project_ids(db, profile)
    if visible is not None and project_id not in visible:
        raise HTTPException(403, "Tidak diotorisasi untuk proyek ini")
    return project


async def _require_task_access(db: AsyncSession, profile: Profile, task: WorkspaceTask):
    phase = await db.get(WorkspacePhase, task.phase_id)
    if not phase:
        raise HTTPException(404, "Fase tidak ditemukan")
    await _require_project_access(db, profile, phase.project_id)


async def _require_phase_access(db: AsyncSession, profile: Profile, phase_id: uuid.UUID):
    phase = await db.get(WorkspacePhase, phase_id)
    if not phase:
        raise HTTPException(404, "Fase tidak ditemukan")
    await _require_project_access(db, profile, phase.project_id)
    return phase


async def _locked_task(db, profile, task_id):
    task = await db.get(WorkspaceTask, task_id)
    if not task:
        raise HTTPException(404, "Task tidak ditemukan")
    await _require_task_access(db, profile, task)
    if project_rules.enabled():
        from app.routers.workspace_board import _lock_board
        phase = await db.get(WorkspacePhase, task.phase_id)
        board = await _lock_board(db, phase.project_id, None)
        board.version += 1
    return await db.scalar(select(WorkspaceTask).where(WorkspaceTask.id == task_id)
        .with_for_update(key_share=True).execution_options(populate_existing=True))


# ---------------------------------------------------------------------------
# Pydantic schemas
# ---------------------------------------------------------------------------

class TemplateOut(BaseModel):
    id: str
    name: str
    description: str | None

class PhaseTemplateOut(BaseModel):
    id: str
    name: str
    order: int
    estimated_days: int | None
    tasks: list[dict]

class TemplateDetailOut(BaseModel):
    id: str
    name: str
    description: str | None
    phases: list[PhaseTemplateOut]

class TemplateCreate(BaseModel):
    name: str
    description: str | None = None
    phases: list[dict] | None = None

class ProjectOut(BaseModel):
    id: str
    name: str
    rpo_number: str | None
    client_name: str | None
    status: str
    start_date: str | None
    deadline: str | None
    manager_id: str | None
    description: str | None
    progress: float
    archived_at: str | None = None

class ProjectCreate(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    rpo_number: str = Field(min_length=1, max_length=100)
    client_name: str = Field(min_length=1, max_length=255)
    template_id: str | None = None
    start_date: date
    deadline: date
    manager_id: str | None = None
    description: str | None = None

    @field_validator("name", "rpo_number", "client_name")
    @classmethod
    def clean_required(cls, value):
        if not value.strip():
            raise ValueError("Nama proyek, RPO dan klien wajib diisi")
        return value.strip()

    @model_validator(mode="after")
    def dates_in_order(self):
        if self.deadline < self.start_date:
            raise ValueError("Tanggal selesai harus setelah atau sama dengan tanggal mulai")
        return self

class ProjectUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=255)
    rpo_number: str | None = Field(default=None, min_length=1, max_length=100)
    client_name: str | None = Field(default=None, min_length=1, max_length=255)
    status: ProjectStatus | None = None
    start_date: date | None = None
    deadline: date | None = None
    manager_id: str | None = None
    description: str | None = None

    @field_validator("name", "rpo_number", "client_name")
    @classmethod
    def nonempty(cls, value):
        if value is not None and not value.strip():
            raise ValueError("Nama, RPO dan klien tidak boleh kosong")
        return value.strip() if value else value

class PhaseOut(BaseModel):
    id: str
    project_id: str
    name: str
    order: int
    status: str
    start_date: str | None
    deadline: str | None
    progress: float


class TimelinePhaseOut(BaseModel):
    """Compact phase row for the bulk /timeline endpoint."""
    id: str
    name: str
    order: int
    status: str
    start_date: str | None
    deadline: str | None
    progress: float


class TimelineProjectOut(ProjectOut):
    """Project + its phases — used by the Timeline view to avoid N+1."""
    phases: list[TimelinePhaseOut]

class PhaseCreate(BaseModel):
    name: str
    order: int = 1
    start_date: str | None = None
    deadline: str | None = None

class TaskOut(BaseModel):
    wo_number: int | None = None
    id: str
    phase_id: str
    name: str
    description: str | None
    location: str | None
    estimated_days: int | None
    assigned_to: str | None
    assigned_name: str | None
    assigned_avatar_url: str | None = None
    deadline: str | None
    status: str
    notes: str | None
    review_notes: str | None
    reviewed_by: str | None
    reviewed_at: str | None
    started_at: str | None
    order: int
    updated_at: str | None = None

class TaskCreate(BaseModel):
    name: str
    description: str | None = None
    location: str | None = None
    estimated_days: int | None = None
    assigned_to: str | None = None
    deadline: str | None = None
    notes: str | None = None
    order: int = 1

class TaskUpdate(BaseModel):
    name: str | None = None
    description: str | None = None
    location: str | None = None
    estimated_days: int | None = None
    assigned_to: str | None = None
    deadline: str | None = None
    status: str | None = None
    notes: str | None = None

class TaskReportSubmit(BaseModel):
    """Field worker submits report when finishing a WO."""
    photos_before: list[str] = []
    photos_after: list[str] = []
    notes: str | None = None

class TaskReviewDecision(BaseModel):
    """Engineer approves or asks for revision."""
    decision: str  # "approve" | "request_revision"
    review_notes: str | None = None

class CompletionCreate(BaseModel):
    """Legacy single-photo completion — kept for backwards compat."""
    photo_url: str | None = None
    notes: str | None = None

class CompletionOut(BaseModel):
    id: str
    task_id: str
    submitted_by: str
    submitted_name: str | None
    photo_url: str | None
    photos_before: list[str]
    photos_after: list[str]
    notes: str | None
    completed_at: str


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _date_str(d: date | None) -> str | None:
    return d.isoformat() if d else None


async def _task_progress(db: AsyncSession, phase_id: uuid.UUID) -> float:
    total = await db.scalar(select(func.count()).where(WorkspaceTask.phase_id == phase_id, WorkspaceTask.status != TaskStatus.cancelled))
    if not total:
        return 0.0
    done = await db.scalar(
        select(func.count()).where(
            WorkspaceTask.phase_id == phase_id,
            WorkspaceTask.status == TaskStatus.done,
        )
    )
    return round((done or 0) / total * 100, 1)


async def _project_progress(db: AsyncSession, project_id: uuid.UUID) -> float:
    phases = (await db.execute(
        select(WorkspacePhase.id).where(WorkspacePhase.project_id == project_id)
    )).scalars().all()
    if not phases:
        return 0.0
    total = await db.scalar(select(func.count()).where(WorkspaceTask.phase_id.in_(phases), WorkspaceTask.status != TaskStatus.cancelled))
    if not total:
        return 0.0
    done = await db.scalar(
        select(func.count()).where(
            WorkspaceTask.phase_id.in_(phases),
            WorkspaceTask.status == TaskStatus.done,
        )
    )
    return round((done or 0) / total * 100, 1)


async def _enrich_task(db: AsyncSession, t: WorkspaceTask) -> TaskOut:
    if "updated_at" in inspect(t).unloaded:
        await db.refresh(t, ["updated_at"])
    assigned_name = None
    assigned_avatar_url = None
    if t.assigned_to:
        p = await db.get(Profile, t.assigned_to)
        assigned_name = p.full_name if p else None
        assigned_avatar_url = p.avatar_url if p else None
    return TaskOut(
        id=str(t.id), wo_number=t.wo_number, phase_id=str(t.phase_id), updated_at=t.updated_at.isoformat(),
        name=t.name,
        description=t.description,
        location=t.location,
        estimated_days=t.estimated_days,
        assigned_to=str(t.assigned_to) if t.assigned_to else None,
        assigned_name=assigned_name, assigned_avatar_url=assigned_avatar_url,
        deadline=_date_str(t.deadline),
        status=t.status.value,
        notes=t.notes,
        review_notes=t.review_notes,
        reviewed_by=str(t.reviewed_by) if t.reviewed_by else None,
        reviewed_at=t.reviewed_at.isoformat() if t.reviewed_at else None,
        started_at=t.started_at.isoformat() if t.started_at else None,
        order=t.order,
    )


def _project_to_out(proj: WorkspaceProject, progress: float) -> ProjectOut:
    return ProjectOut(
        id=str(proj.id), name=proj.name,
        rpo_number=proj.rpo_number,
        client_name=proj.client_name,
        status=proj.status.value,
        start_date=_date_str(proj.start_date),
        deadline=_date_str(proj.deadline),
        manager_id=str(proj.manager_id) if proj.manager_id else None,
        description=proj.description,
        progress=progress,
        archived_at=proj.archived_at.isoformat() if proj.archived_at else None,
    )


# ---------------------------------------------------------------------------
# Templates
# ---------------------------------------------------------------------------

@router.get("/templates", response_model=list[TemplateOut])
async def list_templates(
    db: Annotated[AsyncSession, Depends(get_db)] = None,
    _profile: Annotated[Profile, Depends(require_permission("workspace:view"))] = None,
):
    rows = (await db.execute(select(ProjectTemplate).order_by(ProjectTemplate.name))).scalars().all()
    return [TemplateOut(id=str(r.id), name=r.name, description=r.description) for r in rows]


@router.get("/templates/{template_id}", response_model=TemplateDetailOut)
async def get_template(
    template_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)] = None,
    _profile: Annotated[Profile, Depends(require_permission("workspace:view"))] = None,
):
    tmpl = await db.get(ProjectTemplate, template_id)
    if not tmpl:
        raise HTTPException(404, "Template tidak ditemukan")
    phases = (await db.execute(
        select(PhaseTemplate).where(PhaseTemplate.template_id == template_id).order_by(PhaseTemplate.order)
    )).scalars().all()
    phase_list = []
    for ph in phases:
        tasks = (await db.execute(
            select(TaskTemplate).where(TaskTemplate.phase_template_id == ph.id).order_by(TaskTemplate.order)
        )).scalars().all()
        phase_list.append(PhaseTemplateOut(
            id=str(ph.id), name=ph.name, order=ph.order,
            estimated_days=ph.estimated_days,
            tasks=[{"id": str(t.id), "name": t.name, "estimated_days": t.estimated_days, "default_role": t.default_role} for t in tasks],
        ))
    return TemplateDetailOut(id=str(tmpl.id), name=tmpl.name, description=tmpl.description, phases=phase_list)


@router.post("/templates", response_model=TemplateOut, status_code=201)
async def create_template(
    body: TemplateCreate,
    db: Annotated[AsyncSession, Depends(get_db)] = None,
    _profile: Annotated[Profile, Depends(require_permission("workspace:manage"))] = None,
):
    tmpl = ProjectTemplate(name=body.name, description=body.description)
    db.add(tmpl)
    await db.flush()
    await db.refresh(tmpl)

    if body.phases:
        for pi, ph_data in enumerate(body.phases):
            ph = PhaseTemplate(
                template_id=tmpl.id,
                name=ph_data["name"],
                order=pi + 1,
                estimated_days=ph_data.get("estimated_days"),
            )
            db.add(ph)
            await db.flush()
            await db.refresh(ph)
            for ti, t_data in enumerate(ph_data.get("tasks", [])):
                db.add(TaskTemplate(
                    phase_template_id=ph.id,
                    name=t_data["name"],
                    estimated_days=t_data.get("estimated_days"),
                    default_role=t_data.get("default_role"),
                    order=ti + 1,
                ))

    return TemplateOut(id=str(tmpl.id), name=tmpl.name, description=tmpl.description)


# ---------------------------------------------------------------------------
# Projects — assignment-filtered
# ---------------------------------------------------------------------------

@router.get("/projects", response_model=list[ProjectOut])
async def list_projects(
    archived: bool = False,
    db: Annotated[AsyncSession, Depends(get_db)] = None,
    profile: Annotated[Profile, Depends(require_permission("workspace:view"))] = None,
):
    """Return projects the user is involved in (manager or has assigned tasks).
    Admins see all projects.
    """
    visible_ids = await _visible_project_ids(db, profile)

    q = select(WorkspaceProject).where(WorkspaceProject.archived_at.is_not(None) if archived else WorkspaceProject.archived_at.is_(None)).order_by(WorkspaceProject.created_at.desc())
    if visible_ids is not None:  # None = admin, sees all
        if not visible_ids:
            return []  # no projects assigned
        q = q.where(WorkspaceProject.id.in_(visible_ids))

    rows = (await db.execute(q)).scalars().all()
    counts = (await db.execute(select(WorkspacePhase.project_id, func.count(WorkspaceTask.id).filter(WorkspaceTask.status != TaskStatus.cancelled),
        func.sum(case((WorkspaceTask.status == TaskStatus.done, 1), else_=0)))
        .join(WorkspaceTask, WorkspaceTask.phase_id == WorkspacePhase.id)
        .where(WorkspacePhase.project_id.in_([p.id for p in rows])).group_by(WorkspacePhase.project_id))).all() if rows else []
    progress = {key: round(done / total * 100, 1) if total else 0 for key, total, done in counts}
    return [_project_to_out(p, progress.get(p.id, 0)) for p in rows]


@router.get("/timeline", response_model=list[TimelineProjectOut])
async def timeline(
    db: Annotated[AsyncSession, Depends(get_db)] = None,
    profile: Annotated[Profile, Depends(require_permission("workspace:view"))] = None,
):
    """Bulk endpoint for the Timeline view — returns all visible projects with
    their phases in 3 queries instead of N+1.

    Used by the frontend `CalendarView` global mode. Phases are ordered by
    their `order` column; tasks are NOT included (the WO-level detail view
    loads those per project).
    """
    visible_ids = await _visible_project_ids(db, profile)

    q = select(WorkspaceProject).where(WorkspaceProject.archived_at.is_(None)).order_by(WorkspaceProject.created_at.desc())
    if visible_ids is not None:
        if not visible_ids:
            return []
        q = q.where(WorkspaceProject.id.in_(visible_ids))

    projects = (await db.execute(q)).scalars().all()
    if not projects:
        return []

    project_ids = [p.id for p in projects]

    # All phases for these projects in one query
    phases = (await db.execute(
        select(WorkspacePhase)
        .where(WorkspacePhase.project_id.in_(project_ids))
        .order_by(WorkspacePhase.project_id, WorkspacePhase.order)
    )).scalars().all()

    # Task counts per phase (total + done) in one aggregate query — used for
    # both phase-level and project-level progress.
    phase_ids = [ph.id for ph in phases]
    task_counts: dict[uuid.UUID, tuple[int, int]] = {}
    if phase_ids:
        rows = (await db.execute(
            select(
                WorkspaceTask.phase_id,
                func.count().filter(WorkspaceTask.status != TaskStatus.cancelled).label("total"),
                func.sum(case((WorkspaceTask.status == TaskStatus.done, 1), else_=0)).label("done"),
            )
            .where(WorkspaceTask.phase_id.in_(phase_ids))
            .group_by(WorkspaceTask.phase_id)
        )).all()
        for r in rows:
            task_counts[r.phase_id] = (r.total or 0, int(r.done or 0))

    # Group phases by project_id
    phases_by_project: dict[uuid.UUID, list[TimelinePhaseOut]] = defaultdict(list)
    for ph in phases:
        total, done = task_counts.get(ph.id, (0, 0))
        progress = round(done / total * 100, 1) if total > 0 else 0.0
        phases_by_project[ph.project_id].append(TimelinePhaseOut(
            id=str(ph.id),
            name=ph.name,
            order=ph.order,
            status=ph.status.value,
            start_date=_date_str(ph.start_date),
            deadline=_date_str(ph.deadline),
            progress=progress,
        ))

    # Assemble output with per-project progress aggregated from task counts
    out: list[TimelineProjectOut] = []
    for p in projects:
        proj_phase_ids = [ph.id for ph in phases if ph.project_id == p.id]
        proj_total = sum(task_counts.get(phid, (0, 0))[0] for phid in proj_phase_ids)
        proj_done = sum(task_counts.get(phid, (0, 0))[1] for phid in proj_phase_ids)
        proj_progress = round(proj_done / proj_total * 100, 1) if proj_total > 0 else 0.0
        out.append(TimelineProjectOut(
            id=str(p.id),
            name=p.name,
            rpo_number=p.rpo_number,
            client_name=p.client_name,
            status=p.status.value,
            start_date=_date_str(p.start_date),
            deadline=_date_str(p.deadline),
            manager_id=str(p.manager_id) if p.manager_id else None,
            description=p.description,
            progress=proj_progress,
            phases=phases_by_project[p.id],
        ))
    return out


@router.post("/projects", response_model=ProjectOut, status_code=201)
async def create_project(
    body: ProjectCreate,
    db: Annotated[AsyncSession, Depends(get_db)] = None,
    profile: Annotated[Profile, Depends(require_permission("workspace:manage"))] = None,
):
    template_id = uuid.UUID(body.template_id) if body.template_id else None
    manager_id = uuid.UUID(body.manager_id) if body.manager_id else profile.id

    # RPO number is user-input free text. Strip whitespace, treat empty as None.
    rpo_clean = body.rpo_number.strip().upper()
    await db.execute(select(func.pg_advisory_xact_lock(func.hashtext("rein-rpo:" + rpo_clean.lower()))))
    if await db.scalar(select(WorkspaceProject.id).where(func.lower(WorkspaceProject.rpo_number) == rpo_clean.lower())):
        raise HTTPException(409, "Nomor RPO sudah digunakan proyek lain")
    proj = WorkspaceProject(
        name=body.name,
        rpo_number=rpo_clean,
        client_name=body.client_name,
        template_id=template_id,
        start_date=body.start_date,
        deadline=body.deadline,
        status=ProjectStatus.planning,
        manager_id=manager_id,
        description=body.description,
    )
    db.add(proj)
    try:
        await db.flush()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(409, "Nomor RPO sudah digunakan proyek lain")
    await db.refresh(proj)

    # Auto-create phases & tasks from template
    if template_id:
        phases = (await db.execute(
            select(PhaseTemplate).where(PhaseTemplate.template_id == template_id).order_by(PhaseTemplate.order)
        )).scalars().all()
        for ph_tmpl in phases:
            phase = WorkspacePhase(
                project_id=proj.id, name=ph_tmpl.name, order=ph_tmpl.order, status=PhaseStatus.pending,
            )
            db.add(phase)
            await db.flush()
            await db.refresh(phase)
            task_tmpls = (await db.execute(
                select(TaskTemplate).where(TaskTemplate.phase_template_id == ph_tmpl.id).order_by(TaskTemplate.order)
            )).scalars().all()
            for t_tmpl in task_tmpls:
                db.add(WorkspaceTask(
                    phase_id=phase.id, name=t_tmpl.name, status=TaskStatus.todo, order=t_tmpl.order,
                ))

    if not template_id:
        db.add(WorkspacePhase(project_id=proj.id, name="Pekerjaan", order=1, status=PhaseStatus.pending))
    return _project_to_out(proj, 0.0)


@router.get("/projects/{project_id}", response_model=ProjectOut)
async def get_project(
    project_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)] = None,
    profile: Annotated[Profile, Depends(require_permission("workspace:view"))] = None,
):
    proj = await db.get(WorkspaceProject, project_id)
    if not proj:
        raise HTTPException(404, "Proyek tidak ditemukan")
    # Access check: must be manager or have tasks assigned
    visible_ids = await _visible_project_ids(db, profile)
    if visible_ids is not None and project_id not in visible_ids:
        raise HTTPException(403, "Tidak diotorisasi untuk proyek ini")
    return _project_to_out(proj, await _project_progress(db, proj.id))


@router.put("/projects/{project_id}", response_model=ProjectOut)
async def update_project(
    project_id: uuid.UUID,
    body: ProjectUpdate,
    db: Annotated[AsyncSession, Depends(get_db)] = None,
    _profile: Annotated[Profile, Depends(require_permission("workspace:manage"))] = None,
):
    proj = await db.get(WorkspaceProject, project_id)
    if not proj:
        raise HTTPException(404, "Proyek tidak ditemukan")
    await _require_project_access(db, _profile, project_id)
    if proj.archived_at:
        raise HTTPException(409, "Pulihkan proyek sebelum mengubah data")
    start, end = body.start_date or proj.start_date, body.deadline or proj.deadline
    if start and end and end < start:
        raise HTTPException(422, "Tanggal selesai tidak boleh sebelum tanggal mulai")
    if body.name is not None: proj.name = body.name
    if body.rpo_number is not None:
        rpo_clean = body.rpo_number.strip().upper()
        await db.execute(select(func.pg_advisory_xact_lock(func.hashtext("rein-rpo:" + rpo_clean.lower()))))
        if await db.scalar(select(WorkspaceProject.id).where(func.lower(WorkspaceProject.rpo_number) == rpo_clean.lower(), WorkspaceProject.id != project_id)):
            raise HTTPException(409, "Nomor RPO sudah digunakan proyek lain")
        proj.rpo_number = rpo_clean
    if body.client_name is not None: proj.client_name = body.client_name
    if body.status == ProjectStatus.completed and proj.status != ProjectStatus.completed:
        if await db.scalar(select(WorkspaceTask.id).join(WorkspacePhase).where(WorkspacePhase.project_id == project_id, WorkspaceTask.status.notin_([TaskStatus.done, TaskStatus.cancelled])).limit(1)):
            raise HTTPException(409, "Selesaikan dan setujui semua WO sebelum menutup proyek")
        if os.getenv("WORKSPACE_COORDINATION_ENABLED") == "1":
            from db.models.workspace_coordination import WorkspaceIssue
            if await db.scalar(select(WorkspaceIssue.id).where(WorkspaceIssue.project_id == project_id, WorkspaceIssue.kind == "blocker", WorkspaceIssue.status != "verified").limit(1)):
                raise HTTPException(409, "Verifikasi semua kendala sebelum menutup proyek")
    if body.status is not None: proj.status = ProjectStatus(body.status)
    if body.start_date is not None: proj.start_date = body.start_date
    if body.deadline is not None: proj.deadline = body.deadline
    if body.manager_id is not None: proj.manager_id = uuid.UUID(body.manager_id)
    if body.description is not None: proj.description = body.description
    await db.flush()
    await project_rules.record_event(db, proj.id, _profile.id, "Data proyek diperbarui",
        payload={"name": proj.name, "changes": body.model_dump(exclude_unset=True, mode="json")})
    return _project_to_out(proj, await _project_progress(db, proj.id))


# ---------------------------------------------------------------------------
# Phases
# ---------------------------------------------------------------------------

@router.get("/projects/{project_id}/phases", response_model=list[PhaseOut])
async def list_phases(
    project_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)] = None,
    _profile: Annotated[Profile, Depends(require_permission("workspace:view"))] = None,
):
    await _require_project_access(db, _profile, project_id)
    rows = (await db.execute(
        select(WorkspacePhase).where(WorkspacePhase.project_id == project_id).order_by(WorkspacePhase.order)
    )).scalars().all()
    return [
        PhaseOut(
            id=str(r.id), project_id=str(r.project_id),
            name=r.name, order=r.order, status=r.status.value,
            start_date=_date_str(r.start_date), deadline=_date_str(r.deadline),
            progress=await _task_progress(db, r.id),
        )
        for r in rows
    ]


@router.post("/projects/{project_id}/phases", response_model=PhaseOut, status_code=201)
async def create_phase(
    project_id: uuid.UUID,
    body: PhaseCreate,
    db: Annotated[AsyncSession, Depends(get_db)] = None,
    _profile: Annotated[Profile, Depends(require_permission("workspace:manage"))] = None,
):
    proj = await db.get(WorkspaceProject, project_id)
    if not proj:
        raise HTTPException(404, "Proyek tidak ditemukan")
    await _require_project_access(db, _profile, project_id)
    ph = WorkspacePhase(
        project_id=project_id, name=body.name, order=body.order,
        start_date=date.fromisoformat(body.start_date) if body.start_date else None,
        deadline=date.fromisoformat(body.deadline) if body.deadline else None,
        status=PhaseStatus.pending,
    )
    db.add(ph)
    await db.flush()
    await db.refresh(ph)
    return PhaseOut(
        id=str(ph.id), project_id=str(ph.project_id),
        name=ph.name, order=ph.order, status=ph.status.value,
        start_date=_date_str(ph.start_date), deadline=_date_str(ph.deadline),
        progress=0.0,
    )


@router.put("/phases/{phase_id}", response_model=PhaseOut)
async def update_phase(
    phase_id: uuid.UUID,
    body: PhaseCreate,
    db: Annotated[AsyncSession, Depends(get_db)] = None,
    _profile: Annotated[Profile, Depends(require_permission("workspace:manage"))] = None,
):
    ph = await db.get(WorkspacePhase, phase_id)
    if not ph:
        raise HTTPException(404, "Phase tidak ditemukan")
    await _require_project_access(db, _profile, ph.project_id)
    ph.name = body.name
    ph.order = body.order
    if body.start_date: ph.start_date = date.fromisoformat(body.start_date)
    if body.deadline: ph.deadline = date.fromisoformat(body.deadline)
    await db.flush()
    return PhaseOut(
        id=str(ph.id), project_id=str(ph.project_id),
        name=ph.name, order=ph.order, status=ph.status.value,
        start_date=_date_str(ph.start_date), deadline=_date_str(ph.deadline),
        progress=await _task_progress(db, ph.id),
    )


# ---------------------------------------------------------------------------
# Tasks
# ---------------------------------------------------------------------------

@router.get("/phases/{phase_id}/tasks", response_model=list[TaskOut])
async def list_tasks(
    phase_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)] = None,
    _profile: Annotated[Profile, Depends(require_permission("workspace:view"))] = None,
):
    await _require_phase_access(db, _profile, phase_id)
    rows = (await db.execute(
        select(WorkspaceTask).where(WorkspaceTask.phase_id == phase_id).order_by(WorkspaceTask.order)
    )).scalars().all()
    return [await _enrich_task(db, t) for t in rows]


@router.get("/my-tasks", response_model=list[TaskOut])
async def my_tasks(
    db: Annotated[AsyncSession, Depends(get_db)] = None,
    profile: Annotated[Profile, Depends(require_permission("workspace:view"))] = None,
):
    """All non-done tasks assigned to the current user, ordered by deadline."""
    rows = (await db.execute(
        select(WorkspaceTask)
        .where(
            project_rules.assignment_filter(profile.id),
            WorkspaceTask.status.notin_([TaskStatus.done, TaskStatus.cancelled]),
        )
        .order_by(WorkspaceTask.deadline.asc().nullslast())
    )).scalars().all()
    return [await _enrich_task(db, t) for t in rows]


@router.post("/phases/{phase_id}/tasks", response_model=TaskOut, status_code=201)
async def create_task(
    phase_id: uuid.UUID,
    body: TaskCreate,
    db: Annotated[AsyncSession, Depends(get_db)] = None,
    _profile: Annotated[Profile, Depends(require_any_permission("workspace:manage", "workspace:create_wo"))] = None,
):
    ph = await db.get(WorkspacePhase, phase_id)
    if not ph:
        raise HTTPException(404, "Phase tidak ditemukan")
    await _require_project_access(db, _profile, ph.project_id)
    t = WorkspaceTask(
        phase_id=phase_id,
        name=body.name,
        description=body.description,
        location=body.location,
        estimated_days=body.estimated_days,
        assigned_to=uuid.UUID(body.assigned_to) if body.assigned_to else None,
        deadline=date.fromisoformat(body.deadline) if body.deadline else None,
        notes=body.notes,
        order=body.order,
        status=TaskStatus.todo,
    )
    db.add(t)
    await db.flush()
    await db.refresh(t)
    if os.getenv("WORKSPACE_STAGES_ENABLED") == "1":
        from app.routers.workspace_board import _lock_board
        board = await _lock_board(db, ph.project_id, None)
        board.version += 1
        await db.flush()
    await project_rules.task_event(db, t, _profile, "WO dibuat")
    return await _enrich_task(db, t)


@router.put("/tasks/{task_id}", response_model=TaskOut)
async def update_task(
    task_id: uuid.UUID,
    body: TaskUpdate,
    db: Annotated[AsyncSession, Depends(get_db)] = None,
    profile: Annotated[Profile, Depends(require_permission("workspace:view"))] = None,
):
    t = await _locked_task(db, profile, task_id)
    if not t:
        raise HTTPException(404, "Task tidak ditemukan")
    await _require_task_access(db, profile, t)
    if body.status is not None and body.status != t.status.value:
        raise HTTPException(409, "Gunakan aksi Mulai, Kirim Laporan, atau Review untuk mengubah status WO.")

    # Use permission-based check — not role-based
    can_manage = await _can(db, profile, "workspace:manage") or await _can(db, profile, "workspace:create_wo")

    # Non-managers can only update tasks assigned to them
    if not can_manage and not await project_rules.is_assignee(db, t, profile):
        raise HTTPException(403, "Tidak diotorisasi")

    if body.name is not None and can_manage:
        t.name = body.name
    if body.description is not None and can_manage:
        t.description = body.description
    if body.location is not None and can_manage:
        t.location = body.location
    if body.estimated_days is not None and can_manage:
        t.estimated_days = body.estimated_days
    if body.assigned_to is not None and can_manage:
        try:
            assigned_to = uuid.UUID(body.assigned_to) if body.assigned_to else None
        except ValueError:
            raise HTTPException(422, "ID penanggung jawab tidak valid")
        if assigned_to:
            assigned = await db.get(Profile, assigned_to)
            if not assigned or not assigned.is_active:
                raise HTTPException(422, "Penanggung jawab harus pengguna aktif")
        if project_rules.enabled():
            from db.models.workspace_project import WorkspaceTaskAssignee
            if t.assigned_to:
                await db.execute(delete(WorkspaceTaskAssignee).where(WorkspaceTaskAssignee.task_id == t.id,
                    WorkspaceTaskAssignee.profile_id == t.assigned_to))
            if assigned_to and not await db.get(WorkspaceTaskAssignee, (t.id, assigned_to)):
                db.add(WorkspaceTaskAssignee(task_id=t.id, profile_id=assigned_to))
        t.assigned_to = assigned_to
    if body.deadline is not None and can_manage:
        t.deadline = date.fromisoformat(body.deadline) if body.deadline else None
    if body.notes is not None:
        t.notes = body.notes
    await project_rules.task_event(db, t, profile, "WO diubah")
    await db.flush()
    return await _enrich_task(db, t)


# ---------------------------------------------------------------------------
# Work Order lifecycle: start → submit-report → review (approve | revision)
# ---------------------------------------------------------------------------

@router.post("/tasks/{task_id}/start", response_model=TaskOut)
async def start_task(
    task_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)] = None,
    profile: Annotated[Profile, Depends(require_permission("workspace:view"))] = None,
):
    """Field worker taps 'Mulai' — transitions todo → in_progress."""
    t = await _locked_task(db, profile, task_id)
    if not t:
        raise HTTPException(404, "Task tidak ditemukan")
    await _require_task_access(db, profile, t)
    # Either the assignee or someone with execute_wo / manage permission
    can_execute = await _can(db, profile, "workspace:manage") or (
        await _can(db, profile, "workspace:execute_wo") and await project_rules.is_assignee(db, t, profile)
    )
    if not can_execute:
        raise HTTPException(403, "Tidak diotorisasi untuk memulai WO ini")
    await project_rules.require_ready(db, t)
    t.status = transition(t.status, "start")
    if t.started_at is None:
        t.started_at = datetime.now(timezone.utc)
    await project_rules.task_event(db, t, profile, "WO dimulai")
    await db.flush()
    return await _enrich_task(db, t)


@router.post("/tasks/{task_id}/submit-report", response_model=CompletionOut)
async def submit_report(
    task_id: uuid.UUID,
    body: TaskReportSubmit,
    db: Annotated[AsyncSession, Depends(get_db)] = None,
    profile: Annotated[Profile, Depends(require_permission("workspace:view"))] = None,
):
    """Field worker submits report with before/after photos.

    Transitions in_progress → pending_review.
    Creates a TaskCompletion row holding photos + notes.
    """
    t = await _locked_task(db, profile, task_id)
    if not t:
        raise HTTPException(404, "Task tidak ditemukan")
    await _require_task_access(db, profile, t)
    can_execute = await _can(db, profile, "workspace:manage") or (
        await _can(db, profile, "workspace:execute_wo") and await project_rules.is_assignee(db, t, profile)
    )
    if not can_execute:
        raise HTTPException(403, "Tidak diotorisasi untuk submit laporan WO ini")
    await project_rules.require_ready(db, t)
    target = transition(t.status, "submit")
    if not (body.photos_before or body.photos_after or (body.notes and body.notes.strip())):
        raise HTTPException(422, "Tambahkan minimal satu foto atau catatan laporan")

    completion = TaskCompletion(
        task_id=task_id,
        submitted_by=profile.id,
        photos_before=body.photos_before or [],
        photos_after=body.photos_after or [],
        notes=body.notes,
        completed_at=datetime.now(timezone.utc),
    )
    db.add(completion)
    t.status = target
    await project_rules.task_event(db, t, profile, "Laporan dikirim")
    if t.started_at is None:
        t.started_at = datetime.now(timezone.utc)
    await db.flush()
    await db.refresh(completion)

    return CompletionOut(
        id=str(completion.id),
        task_id=str(completion.task_id),
        submitted_by=str(completion.submitted_by),
        submitted_name=profile.full_name,
        photo_url=completion.photo_url,
        photos_before=completion.photos_before or [],
        photos_after=completion.photos_after or [],
        notes=completion.notes,
        completed_at=completion.completed_at.isoformat(),
    )


@router.post("/tasks/{task_id}/review", response_model=TaskOut)
async def review_task(
    task_id: uuid.UUID,
    body: TaskReviewDecision,
    db: Annotated[AsyncSession, Depends(get_db)] = None,
    profile: Annotated[Profile, Depends(require_permission("workspace:view"))] = None,
):
    """Engineer/manager approves or asks for revision.

    decision = 'approve'           → status = done, reviewed_at/by recorded
    decision = 'request_revision'  → status = in_progress, review_notes set
    """
    t = await _locked_task(db, profile, task_id)
    if not t:
        raise HTTPException(404, "Task tidak ditemukan")
    await _require_task_access(db, profile, t)
    can_review = (
        await _can(db, profile, "workspace:review_wo")
        or await _can(db, profile, "workspace:manage")
    )
    if not can_review:
        raise HTTPException(403, "Tidak diotorisasi untuk review WO")
    if not await db.scalar(select(func.count()).where(TaskCompletion.task_id == t.id)):
        raise HTTPException(409, "Laporan WO belum tersedia untuk ditinjau")

    if body.decision == "approve":
        await project_rules.require_ready(db, t, completing=True)
        t.status = transition(t.status, "approve")
        t.reviewed_at = datetime.now(timezone.utc)
        t.reviewed_by = profile.id
        # Clear any prior revision note since it's now approved
        t.review_notes = None
    elif body.decision == "request_revision":
        if not (body.review_notes and body.review_notes.strip()):
            raise HTTPException(400, "Catatan revisi wajib diisi")
        t.status = transition(t.status, "request_revision")
        t.reviewed_at = datetime.now(timezone.utc)
        t.reviewed_by = profile.id
        t.review_notes = body.review_notes.strip()
    else:
        raise HTTPException(400, "decision harus 'approve' atau 'request_revision'")

    await project_rules.task_event(db, t, profile, "WO disetujui" if body.decision == "approve" else "Revisi diminta")
    await db.flush()
    return await _enrich_task(db, t)


# ---------------------------------------------------------------------------
# Completions
# ---------------------------------------------------------------------------

@router.post("/tasks/{task_id}/complete", response_model=CompletionOut, status_code=201)
async def complete_task(
    task_id: uuid.UUID,
    body: CompletionCreate,
    db: Annotated[AsyncSession, Depends(get_db)] = None,
    profile: Annotated[Profile, Depends(require_permission("workspace:complete_task"))] = None,
):
    t = await _locked_task(db, profile, task_id)
    if not t:
        raise HTTPException(404, "Task tidak ditemukan")
    await _require_task_access(db, profile, t)
    if (not await project_rules.is_assignee(db, t, profile)
            and not await _can(db, profile, "workspace:execute_wo")
            and not await _can(db, profile, "workspace:manage")):
        raise HTTPException(403, "Tidak diotorisasi untuk submit laporan WO ini")
    await project_rules.require_ready(db, t)
    target = transition(t.status, "submit")
    if not (body.photo_url or (body.notes and body.notes.strip())):
        raise HTTPException(422, "Tambahkan minimal satu foto atau catatan laporan")

    completion = TaskCompletion(
        task_id=task_id,
        submitted_by=profile.id,
        photo_url=body.photo_url,
        photos_before=[],
        photos_after=[],
        notes=body.notes,
        completed_at=datetime.now(timezone.utc),
    )
    db.add(completion)
    t.status = target
    await project_rules.task_event(db, t, profile, "Laporan dikirim")
    if t.started_at is None:
        t.started_at = datetime.now(timezone.utc)
    await db.flush()
    await db.refresh(completion)

    return CompletionOut(
        id=str(completion.id),
        task_id=str(completion.task_id),
        submitted_by=str(completion.submitted_by),
        submitted_name=profile.full_name,
        photo_url=completion.photo_url,
        photos_before=completion.photos_before or [],
        photos_after=completion.photos_after or [],
        notes=completion.notes,
        completed_at=completion.completed_at.isoformat(),
    )


@router.get("/tasks/{task_id}/completions", response_model=list[CompletionOut])
async def list_completions(
    task_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)] = None,
    _profile: Annotated[Profile, Depends(require_permission("workspace:view"))] = None,
):
    task = await db.get(WorkspaceTask, task_id)
    if not task:
        raise HTTPException(404, "Task tidak ditemukan")
    await _require_task_access(db, _profile, task)
    rows = (await db.execute(
        select(TaskCompletion).where(TaskCompletion.task_id == task_id).order_by(TaskCompletion.completed_at.desc())
    )).scalars().all()
    out = []
    for c in rows:
        p = await db.get(Profile, c.submitted_by)
        out.append(CompletionOut(
            id=str(c.id), task_id=str(c.task_id),
            submitted_by=str(c.submitted_by),
            submitted_name=p.full_name if p else None,
            photo_url=c.photo_url,
            photos_before=c.photos_before or [],
            photos_after=c.photos_after or [],
            notes=c.notes,
            completed_at=c.completed_at.isoformat(),
        ))
    return out


# ---------------------------------------------------------------------------
# Summary — returns both managed-project data and personal-task data.
# Frontend decides what to show based on the user's permissions.
# ---------------------------------------------------------------------------

@router.get("/summary")
async def workspace_summary(
    db: Annotated[AsyncSession, Depends(get_db)] = None,
    profile: Annotated[Profile, Depends(require_permission("workspace:view"))] = None,
):
    """Returns combined summary. Frontend picks what to display based on permissions."""
    from datetime import date as date_cls
    today = date_cls.today()

    # -- Managed projects section --
    visible_ids = await _visible_project_ids(db, profile)
    proj_q = select(WorkspaceProject).where(WorkspaceProject.manager_id == profile.id)
    if profile.role == AppRole.admin:
        proj_q = select(WorkspaceProject)  # admin sees all

    managed_projects = (await db.execute(proj_q.order_by(WorkspaceProject.created_at.desc()))).scalars().all()
    active_count = sum(1 for p in managed_projects if p.status == ProjectStatus.active)

    # Overdue tasks in managed projects
    managed_phase_ids: list[uuid.UUID] = []
    if managed_projects:
        managed_phase_ids = (await db.execute(
            select(WorkspacePhase.id).where(WorkspacePhase.project_id.in_([p.id for p in managed_projects]))
        )).scalars().all()

    overdue_managed = await db.scalar(
        select(func.count()).where(
            WorkspaceTask.phase_id.in_(managed_phase_ids),
            WorkspaceTask.deadline < today,
            WorkspaceTask.status.notin_([TaskStatus.done, TaskStatus.cancelled]),
        )
    ) or 0 if managed_phase_ids else 0

    projects_out = []
    for p in managed_projects[:10]:
        projects_out.append({
            "id": str(p.id),
            "name": p.name,
            "client_name": p.client_name,
            "status": p.status.value,
            "deadline": _date_str(p.deadline),
            "progress": await _project_progress(db, p.id),
        })

    # -- Personal tasks section --
    my_task_rows = (await db.execute(
        select(WorkspaceTask)
        .where(
            WorkspaceTask.assigned_to == profile.id,
            WorkspaceTask.status.notin_([TaskStatus.done, TaskStatus.cancelled]),
        )
        .order_by(WorkspaceTask.deadline.asc().nullslast())
    )).scalars().all()

    today_tasks = [t for t in my_task_rows if t.deadline == today]
    overdue_tasks = [t for t in my_task_rows if t.deadline and t.deadline < today]
    upcoming_tasks = [t for t in my_task_rows if t.deadline and t.deadline > today]

    done_this_month = await db.scalar(
        select(func.count()).select_from(TaskCompletion).where(
            TaskCompletion.submitted_by == profile.id,
            func.date_trunc("month", TaskCompletion.completed_at) == func.date_trunc("month", func.now()),
        )
    ) or 0

    return {
        # Managed projects data (shown when user has workspace:manage)
        "managed": {
            "active_projects": active_count,
            "total_projects": len(managed_projects),
            "overdue_tasks": overdue_managed,
            "projects": projects_out,
        },
        # Personal tasks data (shown when user has workspace:complete_task or workspace:view)
        "personal": {
            "today_count": len(today_tasks),
            "upcoming_count": len(upcoming_tasks),
            "overdue_count": len(overdue_tasks),
            "done_this_month": done_this_month,
            "today_tasks": [
                {"id": str(t.id), "name": t.name, "deadline": _date_str(t.deadline), "status": t.status.value}
                for t in today_tasks[:5]
            ],
            "overdue_tasks": [
                {"id": str(t.id), "name": t.name, "deadline": _date_str(t.deadline), "status": t.status.value}
                for t in overdue_tasks[:5]
            ],
        },
    }
