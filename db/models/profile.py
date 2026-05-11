"""Profile model — 1:1 with Supabase auth.users."""

import enum
import uuid

from sqlalchemy import Enum, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base, TimestampMixin


class AppRole(str, enum.Enum):
    admin = "admin"
    director = "director"
    manager = "manager"
    finance = "finance"
    accounting = "accounting"
    human_resources = "human_resources"
    engineer_mechanical = "engineer_mechanical"
    engineer_process = "engineer_process"
    engineer_electrical = "engineer_electrical"
    purchasing = "purchasing"
    operational_manager = "operational_manager"


ROLE_LABELS: dict[AppRole, str] = {
    AppRole.admin: "Administrator",
    AppRole.director: "Direktur",
    AppRole.manager: "Manajer",
    AppRole.finance: "Keuangan",
    AppRole.accounting: "Akuntansi",
    AppRole.human_resources: "SDM",
    AppRole.engineer_mechanical: "Insinyur Mekanikal",
    AppRole.engineer_process: "Insinyur Proses",
    AppRole.engineer_electrical: "Insinyur Elektrikal",
    AppRole.purchasing: "Pengadaan",
    AppRole.operational_manager: "Manajer Operasional",
}


class Profile(TimestampMixin, Base):
    __tablename__ = "profiles"

    id: Mapped[uuid.UUID] = mapped_column(
        primary_key=True,
    )
    username: Mapped[str] = mapped_column(
        String(64),
        nullable=False,
        unique=True,
        index=True,
    )
    full_name: Mapped[str] = mapped_column(String(255), nullable=False)
    initials: Mapped[str] = mapped_column(String(10), nullable=False, default="")
    avatar_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    role: Mapped[AppRole] = mapped_column(
        Enum(AppRole, name="app_role", create_constraint=True),
        default=AppRole.engineer_mechanical,
        nullable=False,
    )
    is_active: Mapped[bool] = mapped_column(default=True, server_default="true")

    def compute_initials(self) -> str:
        """Generate initials from full_name (e.g. 'Ahmad Fauzi' -> 'AF')."""
        parts = self.full_name.strip().split()
        if len(parts) >= 2:
            return (parts[0][0] + parts[-1][0]).upper()
        return self.full_name[:2].upper() if self.full_name else "??"
