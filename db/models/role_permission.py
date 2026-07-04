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
    # Document Control
    "dcc:view",
    "dcc:upload",
    "dcc:search",
    "dcc:approve",
    "dcc:manage_access",
    "dcc:manage_clients",
    "dcc:delete",
    "dcc:chat",
    # Administrasi
    "admin:manage_users",
    "admin:manage_file_types",
    # Workspace — base
    "workspace:view",            # see projects & tasks
    "workspace:manage",          # create/edit projects, phases (manager+)
    "workspace:complete_task",   # legacy single-photo completion (engineer)
    # Workspace — Work Order lifecycle (added 2026-05-26)
    "workspace:create_wo",       # engineer: breakdown phase into WOs
    "workspace:execute_wo",      # field worker: start + submit-report
    "workspace:review_wo",       # engineer/manager: approve / request revision
    "workspace:close_project",   # close completed project
    # SCADA Monitor (added 2026-07-04)
    "scada:view",                # open /scada, watch streams
    "scada:edit_layout",         # arrange & save own perspectives
    "scada:manage",              # manage stream sources (URL, credentials)
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
    "admin:manage_users": "Kelola Pengguna (Admin)",
    "admin:manage_file_types": "Kelola Jenis File (Admin)",
    "workspace:view": "Lihat Workspace",
    "workspace:manage": "Kelola Proyek & Phase",
    "workspace:complete_task": "Submit Penyelesaian Task (legacy)",
    "workspace:create_wo": "Buat Work Order",
    "workspace:execute_wo": "Eksekusi WO (mulai & submit laporan)",
    "workspace:review_wo": "Review WO (approve / minta revisi)",
    "workspace:close_project": "Tutup Proyek",
    "scada:view": "Lihat SCADA Monitor",
    "scada:edit_layout": "Atur Layout SCADA",
    "scada:manage": "Kelola Stream SCADA",
}


# Default seed: matches the previous hardcoded matrix in `roles.ts`.
DEFAULT_ROLE_PERMISSIONS: dict[AppRole, tuple[str, ...]] = {
    AppRole.admin: ALL_PERMISSIONS,
    AppRole.director: (
        "dashboard:view", "dcc:view", "dcc:upload", "dcc:search",
        "dcc:approve", "dcc:manage_access", "dcc:manage_clients", "dcc:chat",
        "workspace:view", "workspace:manage", "scada:view",
    ),
    AppRole.manager: (
        "dashboard:view", "dcc:view", "dcc:upload", "dcc:search",
        "dcc:approve", "dcc:manage_clients", "dcc:chat",
        "workspace:view", "workspace:manage",
        "scada:view", "scada:edit_layout",
    ),
    AppRole.finance: (
        "dashboard:view", "dcc:view", "dcc:upload", "dcc:search",
        "dcc:approve", "dcc:chat", "workspace:view",
    ),
    AppRole.accounting: (
        "dashboard:view", "dcc:view", "dcc:upload", "dcc:search", "dcc:chat",
        "workspace:view",
    ),
    AppRole.human_resources: (
        "dashboard:view", "dcc:view", "dcc:search", "dcc:chat", "workspace:view",
    ),
    AppRole.engineer_mechanical: (
        "dashboard:view", "dcc:view", "dcc:upload", "dcc:search", "dcc:chat",
        "workspace:view", "workspace:complete_task", "scada:view",
    ),
    AppRole.engineer_process: (
        "dashboard:view", "dcc:view", "dcc:upload", "dcc:search", "dcc:chat",
        "workspace:view", "workspace:complete_task", "scada:view",
    ),
    AppRole.engineer_electrical: (
        "dashboard:view", "dcc:view", "dcc:upload", "dcc:search", "dcc:chat",
        "workspace:view", "workspace:complete_task", "scada:view",
    ),
    AppRole.purchasing: (
        "dashboard:view", "dcc:view", "dcc:upload", "dcc:search", "dcc:chat",
        "workspace:view",
    ),
    AppRole.operational_manager: (
        "dashboard:view", "dcc:view", "dcc:upload", "dcc:search",
        "dcc:approve", "dcc:chat", "workspace:view", "workspace:manage",
        "scada:view", "scada:edit_layout",
    ),
}
