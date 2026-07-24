"""Catatan akses data R-Net berukuran besar (M12) — siapa mengambil apa.

Melengkapi scada_audit_log (yang mencatat PERUBAHAN konfigurasi): tabel ini
mencatat PEMBACAAN besar — request riwayat/ekspor yang mengembalikan banyak
baris. Satu baris per request yang melewati ambang DATA_ACCESS_LOG_MIN_ROWS;
scroll kecil sehari-hari tidak dicatat supaya tabel tidak banjir.

Dipakai monitor anomali (app/services/data_access_monitor.py): total baris
per akun per hari yang melewati ambang memicu alert Telegram + email.
Append-only; RLS deny-all (hanya backend lewat DATABASE_URL).
"""

import datetime
import uuid

from sqlalchemy import BigInteger, DateTime, ForeignKey, Index, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base, TimestampMixin

# Kind — endpoint mana yang diakses
ACCESS_RECENT = "recent"      # /tags/{id}/recent (drawer Riwayat)
ACCESS_SAMPLES = "samples"    # /tags/{id}/samples (scroll/ekspor Excel)
ACCESS_HISTORY = "history"    # /history (chart bucket multi-tag)


class ScadaDataAccessLog(TimestampMixin, Base):
    __tablename__ = "scada_data_access_log"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    profile_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("profiles.id"), nullable=True
    )
    # Snapshot nama akun — jejak tetap terbaca setelah profil dihapus (pola
    # actor_name di scada_audit_log).
    profile_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    kind: Mapped[str] = mapped_column(String(20), nullable=False)
    # Label tag yang diminta, dipisah koma — untuk dibaca manusia; id-nya tidak
    # disimpan terpisah karena log ini alat investigasi, bukan relasi.
    tag_labels: Mapped[str] = mapped_column(Text, nullable=False, server_default="")
    # Rentang waktu yang diminta (NULL bila endpoint tidak memakai rentang,
    # mis. /recent yang selalu "terbaru").
    range_start: Mapped[datetime.datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    range_end: Mapped[datetime.datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    row_count: Mapped[int] = mapped_column(Integer, nullable=False)

    __table_args__ = (
        # Query monitor anomali: SUM(row_count) per akun per hari berjalan
        Index("idx_scada_data_access_profile_created", "profile_id", "created_at"),
        Index("idx_scada_data_access_created_at", "created_at"),
    )
