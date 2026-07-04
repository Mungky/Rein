"""SCADA Monitor models — video streams and per-user layout perspectives.

`scada_streams` holds HLS stream sources (MediaMTX behind Cloudflare Tunnel).
`scada_perspectives` holds each user's saved panel layouts; the JSONB `layout`
follows the contract {"version": 1, "panels": [...]} and is validated by
Pydantic schemas in `backend/app/schemas/scada.py` before every save.
"""

import uuid

from sqlalchemy import Boolean, ForeignKey, Index, String, Text, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base, TimestampMixin, UUIDMixin


class ScadaStream(UUIDMixin, TimestampMixin, Base):
    __tablename__ = "scada_streams"

    name: Mapped[str] = mapped_column(String(120), nullable=False)
    # Full HLS playlist URL, e.g. https://scada-stream.example.com/scada/index.m3u8
    hls_url: Mapped[str] = mapped_column(Text, nullable=False)
    # MediaMTX read-only credentials; the browser player appends them as
    # ?user=...&pass=... query params (MediaMTX supports query-param auth).
    read_user: Mapped[str | None] = mapped_column(String(64), nullable=True)
    read_pass: Mapped[str | None] = mapped_column(String(128), nullable=True)
    enabled: Mapped[bool] = mapped_column(
        Boolean, server_default="true", nullable=False
    )


class ScadaPerspective(UUIDMixin, TimestampMixin, Base):
    __tablename__ = "scada_perspectives"

    owner_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("profiles.id", ondelete="CASCADE"), nullable=False
    )
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    layout: Mapped[dict] = mapped_column(
        JSONB,
        nullable=False,
        server_default=text("'{\"version\": 1, \"panels\": []}'::jsonb"),
    )
    is_default: Mapped[bool] = mapped_column(
        Boolean, server_default="false", nullable=False
    )

    __table_args__ = (
        Index("idx_scada_perspectives_owner_id", "owner_id"),
        # At most one default perspective per user
        Index(
            "uq_scada_perspectives_owner_default",
            "owner_id",
            unique=True,
            postgresql_where=text("is_default"),
        ),
    )
