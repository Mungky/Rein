"""Folder-level permissions — per (folder_id, role) access control."""

import uuid

from sqlalchemy import Boolean, Enum, ForeignKey, Index, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base, TimestampMixin, UUIDMixin
from .profile import AppRole


class FolderPermission(UUIDMixin, TimestampMixin, Base):
    __tablename__ = "folder_permissions"

    folder_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("library_folders.id", ondelete="CASCADE"), nullable=False
    )
    role: Mapped[AppRole] = mapped_column(
        Enum(AppRole, name="app_role", create_constraint=False), nullable=False
    )
    can_view: Mapped[bool] = mapped_column(Boolean, server_default="true", nullable=False)
    can_upload: Mapped[bool] = mapped_column(Boolean, server_default="false", nullable=False)
    can_download: Mapped[bool] = mapped_column(Boolean, server_default="true", nullable=False)
    can_rename: Mapped[bool] = mapped_column(Boolean, server_default="false", nullable=False)
    can_delete: Mapped[bool] = mapped_column(Boolean, server_default="false", nullable=False)
    can_move: Mapped[bool] = mapped_column(Boolean, server_default="false", nullable=False)
    can_create_folder: Mapped[bool] = mapped_column(Boolean, server_default="false", nullable=False)
    can_rename_folder: Mapped[bool] = mapped_column(Boolean, server_default="false", nullable=False)
    can_delete_folder: Mapped[bool] = mapped_column(Boolean, server_default="false", nullable=False)

    __table_args__ = (
        UniqueConstraint("folder_id", "role", name="uq_folder_permissions_folder_role"),
        Index("idx_folder_permissions_folder_id", "folder_id"),
        Index("idx_folder_permissions_role", "role"),
    )
