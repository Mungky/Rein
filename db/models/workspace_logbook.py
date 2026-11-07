"""Daily WO records and their documentation; one PIC and schedule live on the WO."""
import uuid
from datetime import date, datetime

from sqlalchemy import CheckConstraint, Date, DateTime, ForeignKey, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base, UUIDMixin


class WorkspaceWorkLog(UUIDMixin, Base):
    __tablename__ = "workspace_work_logs"
    task_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("workspace_tasks.id", ondelete="CASCADE"), index=True)
    author_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("profiles.id"), index=True)
    work_date: Mapped[date] = mapped_column(Date, index=True)
    body: Mapped[str] = mapped_column(Text)
    minutes: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    request_hash: Mapped[str] = mapped_column(String(64))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    __table_args__ = (CheckConstraint("minutes BETWEEN 0 AND 1440", name="ck_work_log_minutes"),)


class WorkspaceWorkLogAttachment(Base):
    __tablename__ = "workspace_work_log_attachments"
    log_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("workspace_work_logs.id", ondelete="CASCADE"), primary_key=True)
    attachment_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("workspace_attachments.id", ondelete="CASCADE"), primary_key=True, unique=True)


LOGBOOK_MODELS = [WorkspaceWorkLog, WorkspaceWorkLogAttachment]
