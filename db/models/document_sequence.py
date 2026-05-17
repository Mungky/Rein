"""Global document sequence counters — one row per doc_type."""

from sqlalchemy import Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base, TimestampMixin

# All known doc_type codes — seeded into document_sequences on first migration
KNOWN_DOC_TYPES: list[str] = ["Q", "DRW", "INV", "PO", "SPK", "RFP", "RPT", "SPEC", "OTHER"]

DOC_TYPE_LABELS: dict[str, str] = {
    "Q": "Q — Quotation",
    "DRW": "DRW — Gambar Teknik",
    "INV": "INV — Invoice",
    "PO": "PO — Purchase Order",
    "SPK": "SPK — Surat Perintah Kerja",
    "RFP": "RFP — Request for Proposal",
    "RPT": "RPT — Report",
    "SPEC": "SPEC — Spesifikasi",
    "OTHER": "OTHER — Lainnya",
}


class DocumentSequence(TimestampMixin, Base):
    __tablename__ = "document_sequences"

    doc_type: Mapped[str] = mapped_column(String(20), primary_key=True)
    current_number: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
