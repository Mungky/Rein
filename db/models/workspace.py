"""Workspace models — project templates, running projects, phases, tasks, completions.

Hierarchy:
  ProjectTemplate → PhaseTemplate → TaskTemplate   (blueprints)
  WorkspaceProject → WorkspacePhase → WorkspaceTask → TaskCompletion  (actuals)
"""

import enum
import uuid
from datetime import date, datetime

from sqlalchemy import (
    Date, DateTime, Enum, ForeignKey, Integer, String, Text, func, text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base, TimestampMixin, UUIDMixin


def _empty_jsonb_array():
    """server_default helper for jsonb array columns."""
    return text("'[]'::jsonb")


# ---------------------------------------------------------------------------
# Enums
# ---------------------------------------------------------------------------

class ProjectStatus(str, enum.Enum):
    planning = "planning"
    active = "active"
    on_hold = "on_hold"
    completed = "completed"


class PhaseStatus(str, enum.Enum):
    pending = "pending"
    active = "active"
    completed = "completed"


class TaskStatus(str, enum.Enum):
    todo = "todo"
    in_progress = "in_progress"
    pending_review = "pending_review"  # field worker submitted report, engineer reviewing
    done = "done"
    overdue = "overdue"


# ---------------------------------------------------------------------------
# Template tables (blueprints)
# ---------------------------------------------------------------------------

class ProjectTemplate(UUIDMixin, TimestampMixin, Base):
    """Blueprint for a type of project (e.g. 'Reactor Tank', 'Refurbishment')."""
    __tablename__ = "project_templates"

    name: Mapped[str] = mapped_column(String(255), nullable=False, unique=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)


class PhaseTemplate(UUIDMixin, TimestampMixin, Base):
    """An ordered phase within a project template."""
    __tablename__ = "phase_templates"

    template_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("project_templates.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    order: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    estimated_days: Mapped[int | None] = mapped_column(Integer, nullable=True)


class TaskTemplate(UUIDMixin, TimestampMixin, Base):
    """A task within a phase template."""
    __tablename__ = "task_templates"

    phase_template_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("phase_templates.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    estimated_days: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # Role/division that typically handles this task (e.g. "engineer_mechanical")
    default_role: Mapped[str | None] = mapped_column(String(64), nullable=True)
    order: Mapped[int] = mapped_column(Integer, nullable=False, default=1)


# ---------------------------------------------------------------------------
# Actual project tables
# ---------------------------------------------------------------------------

class WorkspaceProject(UUIDMixin, TimestampMixin, Base):
    """A running project at Remula Inti Rekayasa."""
    __tablename__ = "workspace_projects"

    name: Mapped[str] = mapped_column(String(255), nullable=False)
    client_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    # Manual RPO (Remula Purchase Order) number — user inputs format themselves.
    # Unique-when-not-null via partial index. NULL allowed for ad-hoc projects.
    rpo_number: Mapped[str | None] = mapped_column(Text, nullable=True)
    # FK to template used to spawn this project (nullable — can be created ad-hoc)
    template_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("project_templates.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    start_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    deadline: Mapped[date | None] = mapped_column(Date, nullable=True)
    status: Mapped[ProjectStatus] = mapped_column(
        Enum(ProjectStatus, name="project_status", create_constraint=True),
        nullable=False,
        default=ProjectStatus.planning,
        server_default="planning",
    )
    # Manager responsible for the project (FK to profiles)
    manager_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("profiles.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    description: Mapped[str | None] = mapped_column(Text, nullable=True)


class WorkspacePhase(UUIDMixin, TimestampMixin, Base):
    """A phase within a running project."""
    __tablename__ = "workspace_phases"

    project_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("workspace_projects.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    order: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    start_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    deadline: Mapped[date | None] = mapped_column(Date, nullable=True)
    status: Mapped[PhaseStatus] = mapped_column(
        Enum(PhaseStatus, name="phase_status", create_constraint=True),
        nullable=False,
        default=PhaseStatus.pending,
        server_default="pending",
    )


class WorkspaceTask(UUIDMixin, TimestampMixin, Base):
    """A task / Work Order within a phase.

    A Work Order extends a plain Task with:
      - `description`: detailed scope (what to do)
      - `location`: where the work happens
      - `estimated_days`: planning estimate
      - `started_at`: when field worker tapped "Mulai" (transitions todo → in_progress)
      - Review fields: `reviewed_by`, `reviewed_at`, `review_notes` — populated
        when engineer approves or asks for revision after the field worker submits.
    """
    __tablename__ = "workspace_tasks"

    phase_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("workspace_phases.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    # Detailed scope of the Work Order
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Physical location where the work happens
    location: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Engineer planning estimate in days
    estimated_days: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # Engineer assigned to this task
    assigned_to: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("profiles.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    deadline: Mapped[date | None] = mapped_column(Date, nullable=True)
    status: Mapped[TaskStatus] = mapped_column(
        Enum(TaskStatus, name="task_status", create_constraint=True),
        nullable=False,
        default=TaskStatus.todo,
        server_default="todo",
    )
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    order: Mapped[int] = mapped_column(Integer, nullable=False, default=1)

    # Lifecycle timestamps
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    reviewed_by: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("profiles.id", ondelete="SET NULL"),
        nullable=True,
    )
    # Engineer's revision feedback (filled when status flips back to in_progress)
    review_notes: Mapped[str | None] = mapped_column(Text, nullable=True)


class TaskCompletion(UUIDMixin, TimestampMixin, Base):
    """Completion record submitted by a field worker when a Work Order is done.

    Each completion can hold multiple photos in two groups: BEFORE and AFTER.
    The legacy `photo_url` column is preserved for backwards compat — new
    submissions should populate `photos_before` and `photos_after` arrays.
    """
    __tablename__ = "task_completions"

    task_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("workspace_tasks.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    submitted_by: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("profiles.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    # Legacy single-photo URL — kept for backwards compat with old records.
    photo_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Multi-photo groups (jsonb arrays of URLs)
    photos_before: Mapped[list[str]] = mapped_column(
        JSONB,
        nullable=False,
        server_default=_empty_jsonb_array(),
        default=list,
    )
    photos_after: Mapped[list[str]] = mapped_column(
        JSONB,
        nullable=False,
        server_default=_empty_jsonb_array(),
        default=list,
    )
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    completed_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )
