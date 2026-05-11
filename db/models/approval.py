"""Approval model — document approval workflow."""

import enum
import uuid
from datetime import datetime

from sqlalchemy import Enum, ForeignKey, String, Text, DateTime
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base, TimestampMixin, UUIDMixin


class ApprovalAction(str, enum.Enum):
    approve = "approve"
    reject = "reject"
    request_changes = "request_changes"


class Approval(UUIDMixin, TimestampMixin, Base):
    __tablename__ = "approvals"

    document_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("documents.id", ondelete="CASCADE"), nullable=False
    )
    requested_by: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("profiles.id"), nullable=False
    )
    assigned_to: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("profiles.id"), nullable=False
    )
    action: Mapped[ApprovalAction | None] = mapped_column(
        Enum(ApprovalAction, name="approval_action", create_constraint=True),
        nullable=True,
    )
    comment: Mapped[str | None] = mapped_column(Text, nullable=True)
    acted_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )