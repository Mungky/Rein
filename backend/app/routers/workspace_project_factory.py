"""Create clean project copies and turn service-order references into projects."""
import uuid
from datetime import date
from pydantic import BaseModel, Field, field_validator
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select

from app.routers.workspace_project import require_suite, CleanName, _tasks
from app.routers.workspace import _require_project_access
from app.routers.workspace_board import DB, Manager, _lock_board, _place_unassigned
from app.services import workspace_project as rules
from db.models.client import Client
from db.models.workspace import WorkspaceProject, WorkspacePhase, WorkspaceTask, ProjectStatus, PhaseStatus, TaskStatus
from db.models.workspace_board import WorkspaceBoard, WorkspaceTaskStage, WorkspaceTaskPlacement
from db.models.workspace_project import (WorkspaceMilestone, WorkspaceTag, WorkspaceTaskPlan,
    WorkspaceTaskAssignee, WorkspaceTaskDependency, WorkspaceTaskTag, WorkspaceSalesOrder)

router = APIRouter(dependencies=[Depends(require_suite)])


async def operational_fields(db, name, rpo, client, start, end):
    from app.services.workspace_coordination import enabled
    if not enabled():
        return {}
    from app.routers.workspace import ProjectCreate
    try:
        value = ProjectCreate(name=name, rpo_number=rpo, client_name=client, start_date=start, deadline=end)
    except ValueError:
        raise HTTPException(422, "Proyek baru memerlukan nama, RPO, klien serta tanggal mulai dan selesai yang valid")
    rpo = value.rpo_number.upper()
    await db.execute(select(func.pg_advisory_xact_lock(func.hashtext("rein-rpo:" + rpo.lower()))))
    if await db.scalar(select(WorkspaceProject.id).where(func.lower(WorkspaceProject.rpo_number) == rpo.lower())):
        raise HTTPException(409, "Nomor RPO sudah digunakan proyek lain")
    return {"rpo_number": rpo, "client_name": value.client_name, "start_date": value.start_date, "deadline": value.deadline}


class DuplicateIn(CleanName):
    request_id: uuid.UUID
    rpo_number: str | None = None
    client_name: str | None = None
    start_date: date | None = None
    deadline: date | None = None


class SaleIn(BaseModel):
    reference: str = Field(min_length=1, max_length=100)
    customer: str = Field(min_length=1, max_length=255)
    project_name: str = Field(min_length=1, max_length=255)
    client_id: uuid.UUID | None = None
    lines: list[str] = Field(min_length=1, max_length=100)
    start_date: date | None = None
    deadline: date | None = None

    @field_validator("reference", "customer", "project_name")
    @classmethod
    def clean(cls, value):
        if not value.strip():
            raise ValueError("Data pesanan wajib diisi")
        return value.strip()

    @field_validator("lines")
    @classmethod
    def clean_lines(cls, lines):
        if any(not line.strip() or len(line.strip()) > 255 for line in lines):
            raise ValueError("Setiap pekerjaan harus berisi 1–255 karakter")
        return [line.strip() for line in lines]


@router.post("/projects/{project_id}/duplicate", status_code=201)
async def duplicate_project(project_id: uuid.UUID, body: DuplicateIn, db: DB, profile: Manager):
    source = await _require_project_access(db, profile, project_id)
    await _lock_board(db, project_id, None)
    new_id = uuid.uuid5(project_id, "clone:" + str(body.request_id))
    if await db.get(WorkspaceProject, new_id):
        await _require_project_access(db, profile, new_id)
        return {"project_id": str(new_id), "reused": True}
    operational = await operational_fields(db, body.name, body.rpo_number, body.client_name, body.start_date, body.deadline)
    project = WorkspaceProject(id=new_id, name=body.name, client_name=source.client_name,
        manager_id=profile.id, status=ProjectStatus.planning, start_date=rules.local_today(),
        description=source.description, template_id=source.template_id)
    for key, value in operational.items():
        setattr(project, key, value)
    db.add(project)
    await db.flush()
    phases = (await db.scalars(select(WorkspacePhase).where(WorkspacePhase.project_id == project_id))).all()
    phase_map = {phase.id: uuid.uuid4() for phase in phases}
    db.add_all([WorkspacePhase(id=phase_map[p.id], project_id=new_id, name=p.name, order=p.order, status=PhaseStatus.pending) for p in phases])
    tags = (await db.scalars(select(WorkspaceTag).where(WorkspaceTag.project_id == project_id))).all()
    tag_map = {tag.id: uuid.uuid4() for tag in tags}
    db.add_all([WorkspaceTag(id=tag_map[tag.id], project_id=new_id, name=tag.name) for tag in tags])
    milestones = (await db.scalars(select(WorkspaceMilestone).where(WorkspaceMilestone.project_id == project_id))).all()
    milestone_map = {m.id: uuid.uuid4() for m in milestones}
    db.add_all([WorkspaceMilestone(id=milestone_map[m.id], project_id=new_id, name=m.name) for m in milestones])
    stages = (await db.scalars(select(WorkspaceTaskStage).where(WorkspaceTaskStage.project_id == project_id))).all()
    stage_map = {stage.id: uuid.uuid4() for stage in stages}
    db.add_all([WorkspaceTaskStage(id=stage_map[s.id], project_id=new_id, name=s.name, sequence=s.sequence) for s in stages])
    db.add(WorkspaceBoard(project_id=new_id, version=1))
    await db.flush()
    tasks = await _tasks(db, project_id)
    task_map = {task.id: uuid.uuid4() for task in tasks}
    for task in tasks:
        db.add(WorkspaceTask(id=task_map[task.id], phase_id=phase_map[task.phase_id], name=task.name,
            description=task.description, location=task.location, estimated_days=task.estimated_days,
            assigned_to=task.assigned_to, status=TaskStatus.todo, order=task.order))
    await db.flush()
    plans = (await db.scalars(select(WorkspaceTaskPlan).where(WorkspaceTaskPlan.task_id.in_(task_map)))).all()
    for plan in plans:
        db.add(WorkspaceTaskPlan(task_id=task_map[plan.task_id], parent_id=task_map.get(plan.parent_id),
            milestone_id=milestone_map.get(plan.milestone_id), priority=plan.priority,
            estimated_minutes=plan.estimated_minutes, portal_visible=False))
    assignees = (await db.scalars(select(WorkspaceTaskAssignee).where(WorkspaceTaskAssignee.task_id.in_(task_map)))).all()
    db.add_all([WorkspaceTaskAssignee(task_id=task_map[a.task_id], profile_id=a.profile_id) for a in assignees])
    dependencies = (await db.scalars(select(WorkspaceTaskDependency).where(WorkspaceTaskDependency.task_id.in_(task_map)))).all()
    db.add_all([WorkspaceTaskDependency(task_id=task_map[d.task_id], predecessor_id=task_map[d.predecessor_id]) for d in dependencies if d.predecessor_id in task_map])
    task_tags = (await db.scalars(select(WorkspaceTaskTag).where(WorkspaceTaskTag.task_id.in_(task_map)))).all()
    db.add_all([WorkspaceTaskTag(task_id=task_map[t.task_id], tag_id=tag_map[t.tag_id]) for t in task_tags])
    placements = (await db.scalars(select(WorkspaceTaskPlacement).where(WorkspaceTaskPlacement.task_id.in_(task_map)))).all()
    db.add_all([WorkspaceTaskPlacement(task_id=task_map[p.task_id], stage_id=stage_map[p.stage_id], sequence=p.sequence) for p in placements])
    await _place_unassigned(db, new_id)
    await rules.record_event(db, new_id, profile.id, "Proyek dibuat dari salinan", payload={"name": body.name})
    return {"project_id": str(new_id), "reused": False}


@router.post("/sales-orders", status_code=201)
async def project_from_sale(body: SaleIn, db: DB, profile: Manager):
    reference = body.reference.upper()
    # Serialize retries by reference, including concurrent first submissions.
    await db.execute(select(func.pg_advisory_xact_lock(func.hashtext("rein-project-order:" + reference))))
    existing = await db.scalar(select(WorkspaceSalesOrder).where(WorkspaceSalesOrder.reference == reference))
    if existing:
        await _require_project_access(db, profile, existing.project_id)
        return {"project_id": str(existing.project_id), "reused": True}
    customer = body.customer
    if body.client_id:
        client = await db.get(Client, body.client_id)
        if not client or not client.is_active:
            raise HTTPException(422, "Klien tidak ditemukan atau tidak aktif")
        customer = client.name
    project = WorkspaceProject(name=body.project_name, client_name=customer, manager_id=profile.id,
        rpo_number=reference, status=ProjectStatus.planning, start_date=rules.local_today())
    operational = await operational_fields(db, body.project_name, reference, customer, body.start_date, body.deadline)
    for key, value in operational.items():
        setattr(project, key, value)
    db.add(project)
    await db.flush()
    phase = WorkspacePhase(project_id=project.id, name="Pekerjaan pesanan", order=1, status=PhaseStatus.pending)
    db.add(phase)
    await db.flush()
    for index, name in enumerate(body.lines):
        db.add(WorkspaceTask(phase_id=phase.id, name=name, status=TaskStatus.todo, order=index))
    db.add(WorkspaceSalesOrder(reference=reference, customer=customer, client_id=body.client_id, project_id=project.id))
    db.add(WorkspaceBoard(project_id=project.id, version=1))
    for index, name in enumerate(("Persiapan", "Pelaksanaan", "Pemeriksaan", "Penyerahan")):
        db.add(WorkspaceTaskStage(project_id=project.id, name=name, sequence=index))
    await db.flush()
    await _place_unassigned(db, project.id)
    await rules.record_event(db, project.id, profile.id, "Proyek dibuat dari pesanan", payload={"name": reference})
    return {"project_id": str(project.id), "reused": False}
