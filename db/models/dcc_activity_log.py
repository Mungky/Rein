"""DCC activity log — tracks file upload and access (download) events."""

import enum
import uuid
from datetime import datetime

from sqlalchemy import DateTime, Enum, ForeignKey, Index, String, func
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base, UUIDMixin


class DccAction(str, enum.Enum):
    upload = "upload"
    access_request = "access_request"


class DccActivityLog(UUIDMixin, Base):
    __tablename__ = "dcc_activity_log"

    profile_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("profiles.id", ondelete="CASCADE"), nullable=False
    )
    action: Mapped[DccAction] = mapped_column(
        Enum(DccAction, name="dcc_action", create_constraint=True),
        nullable=False,
    )
    detail: Mapped[str] = mapped_column(String(500), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )

    __table_args__ = (
        Index("ix_dcc_activity_log_profile_id", "profile_id"),
        Index("ix_dcc_activity_log_created_at", "created_at"),
    )
