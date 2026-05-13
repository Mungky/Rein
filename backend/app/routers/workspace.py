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
from datetime import date, datetime, timezone
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select, func, or_
from sqlalchemy.ext.asyncio import AsyncSession

from app.dependencies import get_current_profile, require_permission, _load_permissions
from db.models.profile import Profile, AppRole
from db.models.workspace import (
    ProjectTemplate, PhaseTemplate, TaskTemplate,
    WorkspaceProject, WorkspacePhase, WorkspaceTask, TaskCompletion,
    ProjectStatus, PhaseStatus, TaskStatus,
)
from db.session import get_db

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
    if profile.role == AppRole.admin:
        return None  # no filter

    # Projects where user is manager
    manager_ids = (await db.execute(
        select(WorkspaceProject.id).where(WorkspaceProject.manager_id == profile.id)
    )).scalars().all()

    # Projects where user has tasks assigned
    task_phase_ids = (await db.execute(
        select(WorkspaceTask.phase_id).where(WorkspaceTask.assigned_to == profile.id)
    )).scalars().all()

    assigned_project_ids: list[uuid.UUID] = []
    if task_phase_ids:
        assigned_project_ids = (await db.execute(
            select(WorkspacePhase.project_id)
            .where(WorkspacePhase.id.in_(task_phase_ids))
            .distinct()
        )).scalars().all()

    all_ids = list({*manager_ids, *assigned_project_ids})
    return all_ids


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
    client_name: str | None
    status: str
    start_date: str | None
    deadline: str | None
    manager_id: str | None
    description: str | None
    progress: float

class ProjectCreate(BaseModel):
    name: str
    client_name: str | None = None
    template_id: str | None = None
    start_date: str | None = None
    deadline: str | None = None
    manager_id: str | None = None
    description: str | None = None

class ProjectUpdate(BaseModel):
    name: str | None = None
    client_name: str | None = None
    status: str | None = None
    start_date: str | None = None
    deadline: str | None = None
    manager_id: str | None = None
    description: str | None = None

class PhaseOut(BaseModel):
    id: str
    project_id: str
    name: str
    order: int
    status: str
    start_date: str | None
    deadline: str | None
    progress: float

class PhaseCreate(BaseModel):
    name: str
    order: int = 1
    start_date: str | None = None
    deadline: str | None = None

class TaskOut(BaseModel):
    id: str
    phase_id: str
    name: str
    assigned_to: str | None
    assigned_name: str | None
    deadline: str | None
    status: str
    notes: str | None
    order: int

class TaskCreate(BaseModel):
    name: str
    assigned_to: str | None = None
    deadline: str | None = None
    notes: str | None = None
    order: int = 1

class TaskUpdate(BaseModel):
    name: str | None = None
    assigned_to: str | None = None
    deadline: str | None = None
    status: str | None = None
    notes: str | None = None

class CompletionCreate(BaseModel):
    photo_url: str | None = None
    notes: str | None = None

class CompletionOut(BaseModel):
    id: str
    task_id: str
    submitted_by: str
    submitted_name: str | None
    photo_url: str | None
    notes: str | None
    completed_at: str


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _date_str(d: date | None) -> str | None:
    return d.isoformat() if d else None


async def _task_progress(db: AsyncSession, phase_id: uuid.UUID) -> float:
    total = await db.scalar(select(func.count()).where(WorkspaceTask.phase_id == phase_id))
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
    total = await db.scalar(select(func.count()).where(WorkspaceTask.phase_id.in_(phases)))
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
    assigned_name = None
    if t.assigned_to:
        p = await db.get(Profile, t.assigned_to)
        assigned_name = p.full_name if p else None
    return TaskOut(
        id=str(t.id), phase_id=str(t.phase_id),
        name=t.name,
        assigned_to=str(t.assigned_to) if t.assigned_to else None,
        assigned_name=assigned_name,
        deadline=_date_str(t.deadline),
        status=t.status.value,
        notes=t.notes,
        order=t.order,
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
    db: Annotated[AsyncSession, Depends(get_db)] = None,
    profile: Annotated[Profile, Depends(require_permission("workspace:view"))] = None,
):
    """Return projects the user is involved in (manager or has assigned tasks).
    Admins see all projects.
    """
    visible_ids = await _visible_project_ids(db, profile)

    q = select(WorkspaceProject).order_by(WorkspaceProject.created_at.desc())
    if visible_ids is not None:  # None = admin, sees all
        if not visible_ids:
            return []  # no projects assigned
        q = q.where(WorkspaceProject.id.in_(visible_ids))

    rows = (await db.execute(q)).scalars().all()
    out = []
    for r in rows:
        out.append(ProjectOut(
            id=str(r.id), name=r.name, client_name=r.client_name,
            status=r.status.value,
            start_date=_date_str(r.start_date),
            deadline=_date_str(r.deadline),
            manager_id=str(r.manager_id) if r.manager_id else None,
            description=r.description,
            progress=await _project_progress(db, r.id),
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

    proj = WorkspaceProject(
        name=body.name,
        client_name=body.client_name,
        template_id=template_id,
        start_date=date.fromisoformat(body.start_date) if body.start_date else None,
        deadline=date.fromisoformat(body.deadline) if body.deadline else None,
        status=ProjectStatus.planning,
        manager_id=manager_id,
        description=body.description,
    )
    db.add(proj)
    await db.flush()
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

    return ProjectOut(
        id=str(proj.id), name=proj.name, client_name=proj.client_name,
        status=proj.status.value,
        start_date=_date_str(proj.start_date),
        deadline=_date_str(proj.deadline),
        manager_id=str(proj.manager_id) if proj.manager_id else None,
        description=proj.description,
        progress=0.0,
    )


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
    return ProjectOut(
        id=str(proj.id), name=proj.name, client_name=proj.client_name,
        status=proj.status.value,
        start_date=_date_str(proj.start_date),
        deadline=_date_str(proj.deadline),
        manager_id=str(proj.manager_id) if proj.manager_id else None,
        description=proj.description,
        progress=await _project_progress(db, proj.id),
    )


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
    if body.name is not None: proj.name = body.name
    if body.client_name is not None: proj.client_name = body.client_name
    if body.status is not None: proj.status = ProjectStatus(body.status)
    if body.start_date is not None: proj.start_date = date.fromisoformat(body.start_date)
    if body.deadline is not None: proj.deadline = date.fromisoformat(body.deadline)
    if body.manager_id is not None: proj.manager_id = uuid.UUID(body.manager_id)
    if body.description is not None: proj.description = body.description
    await db.flush()
    return ProjectOut(
        id=str(proj.id), name=proj.name, client_name=proj.client_name,
        status=proj.status.value,
        start_date=_date_str(proj.start_date),
        deadline=_date_str(proj.deadline),
        manager_id=str(proj.manager_id) if proj.manager_id else None,
        description=proj.description,
        progress=await _project_progress(db, proj.id),
    )


# ---------------------------------------------------------------------------
# Phases
# ---------------------------------------------------------------------------

@router.get("/projects/{project_id}/phases", response_model=list[PhaseOut])
async def list_phases(
    project_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)] = None,
    _profile: Annotated[Profile, Depends(require_permission("workspace:view"))] = None,
):
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
            WorkspaceTask.assigned_to == profile.id,
            WorkspaceTask.status != TaskStatus.done,
        )
        .order_by(WorkspaceTask.deadline.asc().nullslast())
    )).scalars().all()
    return [await _enrich_task(db, t) for t in rows]


@router.post("/phases/{phase_id}/tasks", response_model=TaskOut, status_code=201)
async def create_task(
    phase_id: uuid.UUID,
    body: TaskCreate,
    db: Annotated[AsyncSession, Depends(get_db)] = None,
    _profile: Annotated[Profile, Depends(require_permission("workspace:manage"))] = None,
):
    ph = await db.get(WorkspacePhase, phase_id)
    if not ph:
        raise HTTPException(404, "Phase tidak ditemukan")
    t = WorkspaceTask(
        phase_id=phase_id,
        name=body.name,
        assigned_to=uuid.UUID(body.assigned_to) if body.assigned_to else None,
        deadline=date.fromisoformat(body.deadline) if body.deadline else None,
        notes=body.notes,
        order=body.order,
        status=TaskStatus.todo,
    )
    db.add(t)
    await db.flush()
    await db.refresh(t)
    return await _enrich_task(db, t)


@router.put("/tasks/{task_id}", response_model=TaskOut)
async def update_task(
    task_id: uuid.UUID,
    body: TaskUpdate,
    db: Annotated[AsyncSession, Depends(get_db)] = None,
    profile: Annotated[Profile, Depends(require_permission("workspace:view"))] = None,
):
    t = await db.get(WorkspaceTask, task_id)
    if not t:
        raise HTTPException(404, "Task tidak ditemukan")

    # Use permission-based check — not role-based
    can_manage = await _can(db, profile, "workspace:manage")

    # Non-managers can only update tasks assigned to them
    if not can_manage and t.assigned_to != profile.id:
        raise HTTPException(403, "Tidak diotorisasi")

    if body.name is not None and can_manage:
        t.name = body.name
    if body.assigned_to is not None and can_manage:
        t.assigned_to = uuid.UUID(body.assigned_to) if body.assigned_to else None
    if body.deadline is not None and can_manage:
        t.deadline = date.fromisoformat(body.deadline) if body.deadline else None
    if body.status is not None:
        t.status = TaskStatus(body.status)
    if body.notes is not None:
        t.notes = body.notes
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
    t = await db.get(WorkspaceTask, task_id)
    if not t:
        raise HTTPException(404, "Task tidak ditemukan")

    completion = TaskCompletion(
        task_id=task_id,
        submitted_by=profile.id,
        photo_url=body.photo_url,
        notes=body.notes,
        completed_at=datetime.now(timezone.utc),
    )
    db.add(completion)
    t.status = TaskStatus.done
    await db.flush()
    await db.refresh(completion)

    return CompletionOut(
        id=str(completion.id),
        task_id=str(completion.task_id),
        submitted_by=str(completion.submitted_by),
        submitted_name=profile.full_name,
        photo_url=completion.photo_url,
        notes=completion.notes,
        completed_at=completion.completed_at.isoformat(),
    )


@router.get("/tasks/{task_id}/completions", response_model=list[CompletionOut])
async def list_completions(
    task_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_db)] = None,
    _profile: Annotated[Profile, Depends(require_permission("workspace:view"))] = None,
):
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
            photo_url=c.photo_url, notes=c.notes,
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
            WorkspaceTask.status != TaskStatus.done,
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
            WorkspaceTask.status != TaskStatus.done,
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
