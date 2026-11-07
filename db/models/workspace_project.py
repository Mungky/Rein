"""Planning, collaboration and customer sharing for Workspace projects."""
import uuid
from datetime import date, datetime

from sqlalchemy import Boolean, CheckConstraint, Date, DateTime, ForeignKey, Integer, LargeBinary, String, Text, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base, UUIDMixin, TimestampMixin


class WorkspaceMilestone(UUIDMixin, TimestampMixin, Base):
    __tablename__ = "workspace_milestones"
    project_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("workspace_projects.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(160))
    deadline: Mapped[date | None] = mapped_column(Date)
    reached_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class WorkspaceTaskPlan(Base):
    __tablename__ = "workspace_task_plans"
    __table_args__ = (CheckConstraint("priority BETWEEN 0 AND 3", name="ck_task_priority"),
        CheckConstraint("estimated_minutes >= 0", name="ck_task_estimate"),
        CheckConstraint("parent_id IS NULL OR parent_id <> task_id", name="ck_task_parent_not_self"))
    task_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("workspace_tasks.id", ondelete="CASCADE"), primary_key=True)
    parent_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("workspace_tasks.id", ondelete="SET NULL"), index=True)
    milestone_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("workspace_milestones.id", ondelete="SET NULL"), index=True)
    priority: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    estimated_minutes: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    portal_visible: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")


class WorkspaceTaskAssignee(Base):
    __tablename__ = "workspace_task_assignees"
    task_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("workspace_tasks.id", ondelete="CASCADE"), primary_key=True)
    profile_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("profiles.id", ondelete="CASCADE"), primary_key=True, index=True)


class WorkspaceTaskDependency(Base):
    __tablename__ = "workspace_task_dependencies"
    __table_args__ = (CheckConstraint("task_id <> predecessor_id", name="ck_dependency_not_self"),)
    task_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("workspace_tasks.id", ondelete="CASCADE"), primary_key=True)
    predecessor_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("workspace_tasks.id", ondelete="CASCADE"), primary_key=True)


class WorkspaceTag(UUIDMixin, Base):
    __tablename__ = "workspace_tags"
    __table_args__ = (UniqueConstraint("project_id", "name", name="uq_workspace_tag_name"),)
    project_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("workspace_projects.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(60))


class WorkspaceTaskTag(Base):
    __tablename__ = "workspace_task_tags"
    task_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("workspace_tasks.id", ondelete="CASCADE"), primary_key=True)
    tag_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("workspace_tags.id", ondelete="CASCADE"), primary_key=True)


class WorkspaceComment(UUIDMixin, Base):
    __tablename__ = "workspace_comments"
    task_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("workspace_tasks.id", ondelete="CASCADE"), index=True)
    author_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("profiles.id", ondelete="SET NULL"))
    body: Mapped[str] = mapped_column(Text)
    external: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class WorkspaceAttachment(UUIDMixin, Base):
    __tablename__ = "workspace_attachments"
    task_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("workspace_tasks.id", ondelete="CASCADE"), index=True)
    uploaded_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("profiles.id", ondelete="SET NULL"))
    name: Mapped[str] = mapped_column(String(180))
    content_type: Mapped[str] = mapped_column(String(80))
    sha256: Mapped[str] = mapped_column(String(64))
    data: Mapped[bytes] = mapped_column(LargeBinary)
    external: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class WorkspaceTimeEntry(UUIDMixin, TimestampMixin, Base):
    __tablename__ = "workspace_time_entries"
    __table_args__ = (CheckConstraint("minutes BETWEEN 1 AND 1440", name="ck_time_minutes"),)
    task_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("workspace_tasks.id", ondelete="CASCADE"), index=True)
    profile_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("profiles.id", ondelete="CASCADE"), index=True)
    work_date: Mapped[date] = mapped_column(Date, index=True)
    minutes: Mapped[int] = mapped_column(Integer)
    description: Mapped[str] = mapped_column(String(1000))


class WorkspaceEvent(UUIDMixin, Base):
    __tablename__ = "workspace_events"
    project_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("workspace_projects.id", ondelete="CASCADE"), index=True)
    task_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("workspace_tasks.id", ondelete="SET NULL"), index=True)
    actor_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("profiles.id", ondelete="SET NULL"))
    action: Mapped[str] = mapped_column(String(60))
    payload: Mapped[dict] = mapped_column(JSONB, default=dict, server_default="{}")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), index=True)


class WorkspaceNotification(UUIDMixin, Base):
    __tablename__ = "workspace_notifications"
    project_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("workspace_projects.id", ondelete="CASCADE"), index=True)
    task_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("workspace_tasks.id", ondelete="CASCADE"))
    profile_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("profiles.id", ondelete="CASCADE"), index=True)
    message: Mapped[str] = mapped_column(String(300))
    read_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class WorkspaceProjectUpdate(UUIDMixin, Base):
    __tablename__ = "workspace_project_updates"
    project_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("workspace_projects.id", ondelete="CASCADE"), index=True)
    author_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("profiles.id", ondelete="SET NULL"))
    health: Mapped[str] = mapped_column(String(20))
    summary: Mapped[str] = mapped_column(Text)
    external: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class WorkspaceRecurrence(UUIDMixin, Base):
    __tablename__ = "workspace_recurrences"
    __table_args__ = (CheckConstraint("interval BETWEEN 1 AND 365", name="ck_recurrence_interval"),
        CheckConstraint("unit IN ('daily', 'weekly', 'monthly')", name="ck_recurrence_unit"))
    task_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("workspace_tasks.id", ondelete="CASCADE"), unique=True)
    unit: Mapped[str] = mapped_column(String(10))
    interval: Mapped[int] = mapped_column(Integer)
    next_date: Mapped[date] = mapped_column(Date, index=True)
    anchor_day: Mapped[int] = mapped_column(Integer)
    end_date: Mapped[date | None] = mapped_column(Date)
    active: Mapped[bool] = mapped_column(Boolean, default=True, server_default="true")


class WorkspaceRecurrenceRun(Base):
    __tablename__ = "workspace_recurrence_runs"
    recurrence_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("workspace_recurrences.id", ondelete="CASCADE"), primary_key=True)
    scheduled_for: Mapped[date] = mapped_column(Date, primary_key=True)
    generated_task_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("workspace_tasks.id", ondelete="CASCADE"), unique=True)


class WorkspacePortalShare(UUIDMixin, Base):
    __tablename__ = "workspace_portal_shares"
    project_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("workspace_projects.id", ondelete="CASCADE"), index=True)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True)
    label: Mapped[str] = mapped_column(String(120))
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class WorkspaceSalesOrder(UUIDMixin, TimestampMixin, Base):
    __tablename__ = "workspace_sales_orders"
    reference: Mapped[str] = mapped_column(String(100), unique=True)
    customer: Mapped[str] = mapped_column(String(255))
    client_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("clients.id", ondelete="SET NULL"))
    project_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("workspace_projects.id", ondelete="CASCADE"), unique=True)


PROJECT_MODELS = (WorkspaceMilestone, WorkspaceTaskPlan, WorkspaceTaskAssignee,
    WorkspaceTaskDependency, WorkspaceTag, WorkspaceTaskTag, WorkspaceComment,
    WorkspaceAttachment, WorkspaceTimeEntry, WorkspaceEvent, WorkspaceNotification,
    WorkspaceProjectUpdate, WorkspaceRecurrence, WorkspaceRecurrenceRun,
    WorkspacePortalShare, WorkspaceSalesOrder)
