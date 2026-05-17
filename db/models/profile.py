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
    engineer_civil = "engineer_civil"
    purchasing = "purchasing"
    procurement = "procurement"
    safety_man = "safety_man"
    warehouse_manager = "warehouse_manager"
    operational_manager = "operational_manager"


ROLE_LABELS: dict[AppRole, str] = {
    AppRole.admin: "Administrator",
    AppRole.director: "Direktur",
    AppRole.manager: "General Manager",
    AppRole.finance: "Finance",
    AppRole.accounting: "Accounting",
    AppRole.human_resources: "Human Resources",
    AppRole.engineer_mechanical: "Mechanical Engineer",
    AppRole.engineer_process: "Process Engineer",
    AppRole.engineer_electrical: "Electrical Engineer",
    AppRole.engineer_civil: "Civil Engineer",
    AppRole.purchasing: "Purchasing",
    AppRole.procurement: "Procurement",
    AppRole.safety_man: "Safety Man",
    AppRole.warehouse_manager: "Warehouse Manager",
    AppRole.operational_manager: "Operational Manager",
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
