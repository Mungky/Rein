"""Upload queue model — tracks file upload progress in the DCC."""

import enum
import uuid
from datetime import datetime

from sqlalchemy import BigInteger, DateTime, Enum, ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base, TimestampMixin, UUIDMixin


class UploadStatus(str, enum.Enum):
    detecting = "detecting"
    awaiting_confirmation = "awaiting_confirmation"
    uploading = "uploading"
    indexing = "indexing"
    completed = "completed"
    failed = "failed"
    cancelled = "cancelled"


class UploadQueue(UUIDMixin, TimestampMixin, Base):
    __tablename__ = "upload_queue"

    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("profiles.id"), nullable=False
    )
    original_name: Mapped[str] = mapped_column(String(500), nullable=False)
    file_size: Mapped[int] = mapped_column(BigInteger, default=0, nullable=False)
    mime_type: Mapped[str | None] = mapped_column(String(100), nullable=True)

    # AI-detected metadata
    detected_type: Mapped[str | None] = mapped_column(String(10), nullable=True)
    detected_client: Mapped[str | None] = mapped_column(String(255), nullable=True)
    detected_project: Mapped[str | None] = mapped_column(String(255), nullable=True)
    detected_folder: Mapped[str | None] = mapped_column(String(500), nullable=True)
    confidence_type: Mapped[float | None] = mapped_column(nullable=True)
    confidence_client: Mapped[float | None] = mapped_column(nullable=True)
    confidence_project: Mapped[float | None] = mapped_column(nullable=True)
    confidence_folder: Mapped[float | None] = mapped_column(nullable=True)

    status: Mapped[UploadStatus] = mapped_column(
        Enum(UploadStatus, name="upload_status", create_constraint=True),
        default=UploadStatus.detecting,
        nullable=False,
    )

    # Google Drive info (filled after upload)
    gdrive_file_id: Mapped[str | None] = mapped_column(String(100), nullable=True)
    gdrive_folder_id: Mapped[str | None] = mapped_column(String(100), nullable=True)

    # Link to chat message that triggered this upload
    chat_message_id: Mapped[uuid.UUID | None] = mapped_column(nullable=True)

    # Proposal expiry — set when status becomes awaiting_confirmation
    proposal_expires_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True,
    )