"""Access request model — temporary document access with expiry."""

import enum
import uuid
from datetime import datetime

from sqlalchemy import Enum, ForeignKey, String, Text, DateTime
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base, TimestampMixin, UUIDMixin


class AccessStatus(str, enum.Enum):
    pending = "pending"
    approved = "approved"
    denied = "denied"
    expired = "expired"


class AccessRequest(UUIDMixin, TimestampMixin, Base):
    __tablename__ = "access_requests"

    document_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("documents.id", ondelete="CASCADE"), nullable=False
    )
    requested_by: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("profiles.id"), nullable=False
    )
    reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[AccessStatus] = mapped_column(
        Enum(AccessStatus, name="access_status", create_constraint=True),
        default=AccessStatus.pending,
        nullable=False,
    )
    approved_by: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("profiles.id"), nullable=True
    )
    expires_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    temp_token: Mapped[str | None] = mapped_column(String(100), nullable=True, unique=True)
    acted_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )