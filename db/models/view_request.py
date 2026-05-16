"""View request model — 5-minute approval window for file content access."""

import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Index, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base, TimestampMixin, UUIDMixin

VIEW_REQUEST_TTL_SECONDS = 300  # 5 minutes

# Status constants (stored as String in DB)
VIEW_STATUS_PENDING = "pending"
VIEW_STATUS_APPROVED = "approved"
VIEW_STATUS_DENIED = "denied"
VIEW_STATUS_EXPIRED = "expired"


class ViewRequestStatus:
    pending = VIEW_STATUS_PENDING
    approved = VIEW_STATUS_APPROVED
    denied = VIEW_STATUS_DENIED
    expired = VIEW_STATUS_EXPIRED


class ViewRequest(UUIDMixin, TimestampMixin, Base):
    __tablename__ = "view_requests"

    file_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("library_files.id", ondelete="CASCADE"), nullable=False
    )
    requester_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("profiles.id"), nullable=False
    )
    status: Mapped[str] = mapped_column(
        String(20), default="pending", nullable=False
    )
    # Unique token embedded in the one-click email link
    approve_token: Mapped[str] = mapped_column(String(100), nullable=False, unique=True)
    approved_by: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("profiles.id"), nullable=True
    )
    approved_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    # When the 5-minute window closes
    expires_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )
    # Temporary GDrive link (30 min), set on approval
    temp_link: Mapped[str | None] = mapped_column(Text, nullable=True)
    link_expires_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    __table_args__ = (
        Index("idx_view_requests_file_id", "file_id"),
        Index("idx_view_requests_requester_id", "requester_id"),
        Index("idx_view_requests_status", "status"),
        Index("idx_view_requests_token", "approve_token"),
    )
