"""Project model — projects associated with clients and documents."""

import uuid

from sqlalchemy import String, Boolean, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base, TimestampMixin, UUIDMixin


class Project(UUIDMixin, TimestampMixin, Base):
    __tablename__ = "clients_projects"

    code: Mapped[str] = mapped_column(String(20), unique=True, nullable=False)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    client_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("clients.id"), nullable=False, index=True,
    )
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, server_default="true", nullable=False)