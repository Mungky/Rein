"""RolePermission model — admin-editable permission matrix per role.

Each row is one (role, permission) pair. The set of rows for a given role
defines which permissions that role has. Admins manage these rows via the
admin dashboard; the frontend reads them through `GET /api/admin/permissions`.
"""

from sqlalchemy import Enum, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base, TimestampMixin
from .profile import AppRole


# The `app_role` enum is owned by the `profiles` table — share it here so
# metadata-level DDL (e.g. tests using `create_all`) doesn't try to recreate it.
_role_enum = Enum(
    AppRole,
    name="app_role",
    create_constraint=False,
    native_enum=True,
    create_type=False,
)


class RolePermission(TimestampMixin, Base):
    __tablename__ = "role_permissions"
    __table_args__ = (
        UniqueConstraint("role", "permission", name="uq_role_permission"),
    )

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    role: Mapped[AppRole] = mapped_column(
        _role_enum,
        nullable=False,
        index=True,
    )
    permission: Mapped[str] = mapped_column(String(64), nullable=False, index=True)


# All permission keys recognized by the application. Keep in sync with the
# frontend `Permission` union in `frontend/src/lib/utils/roles.ts`.
ALL_PERMISSIONS: tuple[str, ...] = (
    "dashboard:view",
    "dcc:view",
    "dcc:upload",
    "dcc:search",
    "dcc:approve",
    "dcc:manage_access",
    "dcc:manage_clients",
    "dcc:delete",
    "dcc:chat",
    "sidebar:crm",
    "sidebar:projects",
    "sidebar:finance",
    "sidebar:hr",
    "admin:manage_users",
)


PERMISSION_LABELS: dict[str, str] = {
    "dashboard:view": "Lihat Dashboard",
    "dcc:view": "Lihat Dokumen",
    "dcc:upload": "Unggah Dokumen",
    "dcc:search": "Cari Dokumen",
    "dcc:approve": "Setujui Dokumen",
    "dcc:manage_access": "Kelola Akses",
    "dcc:manage_clients": "Kelola Klien & Proyek",
    "dcc:delete": "Hapus Dokumen",
    "dcc:chat": "Gunakan AI Chat",
    "sidebar:crm": "Akses Modul CRM",
    "sidebar:projects": "Akses Modul Proyek",
    "sidebar:finance": "Akses Modul Keuangan",
    "sidebar:hr": "Akses Modul HR",
    "admin:manage_users": "Kelola Pengguna (Admin)",
}


# Default seed: matches the previous hardcoded matrix in `roles.ts`.
DEFAULT_ROLE_PERMISSIONS: dict[AppRole, tuple[str, ...]] = {
    AppRole.admin: ALL_PERMISSIONS,
    AppRole.director: (
        "dashboard:view", "dcc:view", "dcc:upload", "dcc:search",
        "dcc:approve", "dcc:manage_access", "dcc:manage_clients", "dcc:chat",
        "sidebar:crm", "sidebar:projects", "sidebar:finance", "sidebar:hr",
    ),
    AppRole.manager: (
        "dashboard:view", "dcc:view", "dcc:upload", "dcc:search",
        "dcc:approve", "dcc:manage_clients", "dcc:chat",
        "sidebar:crm", "sidebar:projects",
    ),
    AppRole.finance: (
        "dashboard:view", "dcc:view", "dcc:upload", "dcc:search",
        "dcc:approve", "dcc:chat",
        "sidebar:finance",
    ),
    AppRole.accounting: (
        "dashboard:view", "dcc:view", "dcc:upload", "dcc:search", "dcc:chat",
        "sidebar:finance",
    ),
    AppRole.human_resources: (
        "dashboard:view", "dcc:view", "dcc:search", "dcc:chat",
        "sidebar:hr",
    ),
    AppRole.engineer_mechanical: (
        "dashboard:view", "dcc:view", "dcc:upload", "dcc:search", "dcc:chat",
    ),
    AppRole.engineer_process: (
        "dashboard:view", "dcc:view", "dcc:upload", "dcc:search", "dcc:chat",
    ),
    AppRole.engineer_electrical: (
        "dashboard:view", "dcc:view", "dcc:upload", "dcc:search", "dcc:chat",
    ),
    AppRole.purchasing: (
        "dashboard:view", "dcc:view", "dcc:upload", "dcc:search", "dcc:chat",
        "sidebar:crm",
    ),
    AppRole.operational_manager: (
        "dashboard:view", "dcc:view", "dcc:upload", "dcc:search",
        "dcc:approve", "dcc:chat",
        "sidebar:projects",
    ),
}
