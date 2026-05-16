"""Audit job model — one row per layer per file in the 4-layer audit pipeline."""

import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Index, Integer, String, Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base, TimestampMixin, UUIDMixin


LAYER_NAMES: dict[int, str] = {
    1: "format_name",
    2: "path",
    3: "duplicate",
    4: "content_ai",
}

LAYER_LABELS: dict[int, str] = {
    1: "Format Nama",
    2: "Validasi Path",
    3: "Cek Duplikasi",
    4: "Audit Isi (AI)",
}

# Status constants (stored as String in DB)
AUDIT_STATUS_PENDING = "pending"
AUDIT_STATUS_RUNNING = "running"
AUDIT_STATUS_PASSED = "passed"
AUDIT_STATUS_FAILED = "failed"
AUDIT_STATUS_SKIPPED = "skipped"


# Keep this as a string alias for backwards compat in type hints
class AuditJobStatus:
    pending = AUDIT_STATUS_PENDING
    running = AUDIT_STATUS_RUNNING
    passed = AUDIT_STATUS_PASSED
    failed = AUDIT_STATUS_FAILED
    skipped = AUDIT_STATUS_SKIPPED


class AuditJob(UUIDMixin, TimestampMixin, Base):
    __tablename__ = "audit_jobs"

    file_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("library_files.id", ondelete="CASCADE"), nullable=False
    )
    layer: Mapped[int] = mapped_column(Integer, nullable=False)
    layer_name: Mapped[str] = mapped_column(String(30), nullable=False)
    status: Mapped[str] = mapped_column(
        String(20), default="pending", nullable=False
    )
    result: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    started_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    finished_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    __table_args__ = (
        Index("idx_audit_jobs_file_id", "file_id"),
        Index("idx_audit_jobs_status", "status"),
    )
