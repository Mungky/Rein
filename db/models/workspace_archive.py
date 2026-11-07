"""One Project document references one file in Document Manager / Google Drive."""
import uuid
from datetime import datetime
from sqlalchemy import DateTime, ForeignKey, String, func
from sqlalchemy.orm import Mapped, mapped_column
from .base import Base


class WorkspaceArchiveFile(Base):
    __tablename__ = "workspace_archive_files"
    document_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("workspace_documents.id", ondelete="CASCADE"), primary_key=True)
    library_file_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("library_files.id", ondelete="RESTRICT"), unique=True)
    department: Mapped[str] = mapped_column(String(50))
    folder_path: Mapped[str] = mapped_column(String(1000))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
