"""Library audit log — full activity trail, visible to admin only."""

import uuid

from sqlalchemy import BigInteger, ForeignKey, Index, String
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base, TimestampMixin

# Action constants
LOG_UPLOAD = "upload"
LOG_PROPOSE = "propose"
LOG_CONFIRM = "confirm"
LOG_CANCEL = "cancel"
LOG_AUDIT_PASS = "audit_pass"
LOG_AUDIT_FAIL = "audit_fail"
LOG_VIEW_REQUEST = "view_request"
LOG_VIEW_APPROVED = "view_approved"
LOG_VIEW_DENIED = "view_denied"
LOG_VIEW_EXPIRED = "view_expired"
LOG_FILE_DELETE = "file_delete"
LOG_FOLDER_CREATE = "folder_create"
LOG_FOLDER_EDIT = "folder_edit"


class LibraryAuditLog(TimestampMixin, Base):
    __tablename__ = "library_audit_log"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    actor_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("profiles.id"), nullable=True
    )
    action: Mapped[str] = mapped_column(String(50), nullable=False)
    target_type: Mapped[str | None] = mapped_column(String(30), nullable=True)
    target_id: Mapped[uuid.UUID | None] = mapped_column(nullable=True)
    log_metadata: Mapped[dict | None] = mapped_column("metadata", JSONB, nullable=True)

    __table_args__ = (
        Index("idx_library_audit_log_actor_id", "actor_id"),
        Index("idx_library_audit_log_action", "action"),
        Index("idx_library_audit_log_created_at", "created_at"),
    )
