"""FileType model — admin-editable list of document type codes.

Each row represents one "Jenis File" the system recognizes (DRW, INV, …).
The `code` is immutable after creation because existing documents reference it
in their `doc_number` (e.g., `DRW-125`). Admins can soft-deactivate via
`is_active` instead of hard-delete.
"""

from sqlalchemy import Boolean, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base, TimestampMixin


class FileType(TimestampMixin, Base):
    __tablename__ = "file_types"

    code: Mapped[str] = mapped_column(String(8), primary_key=True)
    label: Mapped[str] = mapped_column(String(64), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    is_active: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=True, server_default="true"
    )
    sort_order: Mapped[int] = mapped_column(
        Integer, nullable=False, default=0, server_default="0"
    )
