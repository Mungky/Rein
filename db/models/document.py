"""Document model — core document metadata for the DCC."""

import enum
import uuid

from sqlalchemy import BigInteger, Enum, ForeignKey, String, Text, func, Index
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base, TimestampMixin, UUIDMixin


class DocType(str, enum.Enum):
    DRW = "DRW"
    INV = "INV"
    PO = "PO"
    SPK = "SPK"
    RFP = "RFP"
    RPT = "RPT"
    SPEC = "SPEC"
    OTHER = "OTHER"


DOC_TYPE_LABELS: dict[DocType, str] = {
    DocType.DRW: "Gambar Teknik",
    DocType.INV: "Invoice",
    DocType.PO: "Purchase Order",
    DocType.SPK: "Surat Perintah Kerja",
    DocType.RFP: "Request for Proposal",
    DocType.RPT: "Report",
    DocType.SPEC: "Spesifikasi",
    DocType.OTHER: "Lainnya",
}


class DocStatus(str, enum.Enum):
    draft = "draft"
    pending_review = "pending_review"
    approved = "approved"
    rejected = "rejected"
    archived = "archived"


class Document(UUIDMixin, TimestampMixin, Base):
    __tablename__ = "documents"

    doc_number: Mapped[str] = mapped_column(String(50), unique=True, nullable=False)
    doc_type: Mapped[DocType] = mapped_column(
        Enum(DocType, name="doc_type", create_constraint=True),
        default=DocType.OTHER,
        nullable=False,
    )
    title: Mapped[str] = mapped_column(String(500), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Client & project metadata
    client_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    client_code: Mapped[str | None] = mapped_column(String(20), nullable=True)
    project_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    project_code: Mapped[str | None] = mapped_column(String(20), nullable=True)
    folder_path: Mapped[str | None] = mapped_column(String(500), nullable=True)

    # File info
    file_name: Mapped[str] = mapped_column(String(500), nullable=False)
    file_size: Mapped[int] = mapped_column(BigInteger, default=0, nullable=False)
    mime_type: Mapped[str | None] = mapped_column(String(100), nullable=True)

    # Google Drive integration
    gdrive_file_id: Mapped[str | None] = mapped_column(String(100), nullable=True)
    gdrive_folder_id: Mapped[str | None] = mapped_column(String(100), nullable=True)
    gdrive_web_link: Mapped[str | None] = mapped_column(Text, nullable=True)
    sheets_row_id: Mapped[int | None] = mapped_column(nullable=True)

    # Sequence number per doc type (e.g. 125 in DD-125-...)
    doc_sequence: Mapped[int | None] = mapped_column(nullable=True)
    # Short note / revision tag (e.g. rev3, draft, final)
    note: Mapped[str | None] = mapped_column(String(200), nullable=True)

    # Status & ownership
    status: Mapped[DocStatus] = mapped_column(
        Enum(DocStatus, name="doc_status", create_constraint=True),
        default=DocStatus.draft,
        nullable=False,
    )
    version: Mapped[int] = mapped_column(default=1, nullable=False)
    uploaded_by: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("profiles.id"), nullable=False
    )
    approved_by: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("profiles.id"), nullable=True
    )

    __table_args__ = (
        Index("idx_documents_doc_number", "doc_number"),
        Index("idx_documents_doc_type", "doc_type"),
        Index("idx_documents_status", "status"),
        Index("idx_documents_uploaded_by", "uploaded_by"),
    )