"""Library file model — full lifecycle from propose through audit to archive."""

import enum
import uuid

from sqlalchemy import BigInteger, Boolean, Enum, ForeignKey, Index, String, Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base, TimestampMixin, UUIDMixin


class LibraryFileStatus(str, enum.Enum):
    # User confirmed metadata — upload to Drive TEMP in progress
    uploading = "uploading"
    # File is in Drive TEMP, 4-layer audit running
    in_audit = "in_audit"
    # Audit passed — file moved to final folder, accessible
    passed = "passed"
    # Audit found issues — needs re-upload
    failed = "failed"
    # Admin soft-deleted
    archived = "archived"


class LibraryFile(UUIDMixin, TimestampMixin, Base):
    __tablename__ = "library_files"

    folder_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("library_folders.id"), nullable=True
    )

    # Filenames
    original_name: Mapped[str] = mapped_column(String(500), nullable=False)
    file_name: Mapped[str | None] = mapped_column(String(500), nullable=True)

    # Document metadata
    doc_type: Mapped[str | None] = mapped_column(String(10), nullable=True)
    doc_number: Mapped[str | None] = mapped_column(String(50), nullable=True, unique=True)
    title: Mapped[str | None] = mapped_column(String(500), nullable=True)
    client_code: Mapped[str | None] = mapped_column(String(20), nullable=True)
    client_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    project_code: Mapped[str | None] = mapped_column(String(20), nullable=True)
    project_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    note: Mapped[str | None] = mapped_column(String(200), nullable=True)

    # File info
    file_size: Mapped[int] = mapped_column(BigInteger, default=0, nullable=False)
    mime_type: Mapped[str | None] = mapped_column(String(100), nullable=True)
    content_hash: Mapped[str | None] = mapped_column(String(64), nullable=True)

    # Google Drive
    gdrive_file_id: Mapped[str | None] = mapped_column(String(100), nullable=True)
    gdrive_folder_id: Mapped[str | None] = mapped_column(String(100), nullable=True)
    gdrive_web_link: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Lifecycle
    upload_status: Mapped[LibraryFileStatus] = mapped_column(
        Enum(LibraryFileStatus, name="library_file_status", create_constraint=True),
        default=LibraryFileStatus.uploading,
        nullable=False,
    )
    # Stores the 4-layer audit summary after completion
    audit_results: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    # Snapshot of metadata the user confirmed before upload
    proposal_metadata: Mapped[dict | None] = mapped_column(JSONB, nullable=True)

    uploader_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("profiles.id"), nullable=False
    )
    is_deleted: Mapped[bool] = mapped_column(
        Boolean, server_default="false", nullable=False
    )

    __table_args__ = (
        Index("idx_library_files_folder_id", "folder_id"),
        Index("idx_library_files_uploader_id", "uploader_id"),
        Index("idx_library_files_upload_status", "upload_status"),
        Index("idx_library_files_content_hash", "content_hash"),
    )
