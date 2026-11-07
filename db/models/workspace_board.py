"""Project board placement is independent of the Work Order lifecycle."""
import uuid

from sqlalchemy import Boolean, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base, UUIDMixin


class WorkspaceBoard(Base):
    __tablename__ = "workspace_boards"
    project_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("workspace_projects.id", ondelete="CASCADE"), primary_key=True)
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1, server_default="1")


class WorkspaceTaskStage(UUIDMixin, Base):
    __tablename__ = "workspace_task_stages"
    project_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("workspace_projects.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(80), nullable=False)
    sequence: Mapped[int] = mapped_column(Integer, nullable=False)
    folded: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="false")


class WorkspaceTaskPlacement(Base):
    __tablename__ = "workspace_task_placements"
    task_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("workspace_tasks.id", ondelete="CASCADE"), primary_key=True)
    stage_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("workspace_task_stages.id", ondelete="RESTRICT"), index=True)
    sequence: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
