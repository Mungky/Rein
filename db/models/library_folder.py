"""Library folder model — department/project/client folder hierarchy."""

import enum
import uuid

from sqlalchemy import Boolean, Enum, ForeignKey, Index, String
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base, TimestampMixin, UUIDMixin


class FolderType(str, enum.Enum):
    department = "department"
    project = "project"
    client = "client"
    custom = "custom"


# Maps department slug → which roles own that shelf (can upload)
DEPT_ROLE_MAP: dict[str, set[str]] = {
    "finance": {"finance", "accounting"},
    "engineering": {"engineer_mechanical", "engineer_process", "engineer_electrical"},
    "hr": {"human_resources"},
    "purchasing": {"purchasing"},
    "management": {"manager", "operational_manager"},
}

DEPT_LABELS: dict[str, str] = {
    "finance": "Keuangan",
    "engineering": "Teknik",
    "hr": "SDM",
    "purchasing": "Pengadaan",
    "management": "Manajemen",
}

# Roles that auto-serve as Pustakawan (can approve view requests)
LIBRARIAN_ROLES: set[str] = {"director", "manager", "operational_manager"}


class LibraryFolder(UUIDMixin, TimestampMixin, Base):
    __tablename__ = "library_folders"

    parent_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("library_folders.id", ondelete="CASCADE"), nullable=True
    )
    department: Mapped[str] = mapped_column(String(50), nullable=False)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    folder_type: Mapped[FolderType] = mapped_column(
        Enum(FolderType, name="folder_type", create_constraint=True),
        default=FolderType.custom,
        nullable=False,
    )
    # Logical path for display, e.g. "Teknik / Klien / MBP"
    path: Mapped[str] = mapped_column(String(1000), nullable=False)
    gdrive_folder_id: Mapped[str | None] = mapped_column(String(100), nullable=True)
    is_active: Mapped[bool] = mapped_column(
        Boolean, server_default="true", nullable=False
    )
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("profiles.id"), nullable=True
    )

    __table_args__ = (
        Index("idx_library_folders_department", "department"),
        Index("idx_library_folders_parent_id", "parent_id"),
    )
