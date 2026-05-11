"""add_username_and_role_permissions

Revision ID: d8f4a1b2c905
Revises: c7d3f8e2a1b9
Create Date: 2026-05-09

Adds:
  * profiles.username (TEXT UNIQUE NOT NULL) — back-fills from email local-part
    or full_name slug for any pre-existing rows so the NOT NULL constraint
    can be applied safely.
  * role_permissions(role, permission) — admin-editable permission matrix.
    Seeded with the previous hardcoded matrix so behaviour is preserved.
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "d8f4a1b2c905"
down_revision = "c7d3f8e2a1b9"
branch_labels = None
depends_on = None


# Mirror of DEFAULT_ROLE_PERMISSIONS — duplicated here so the migration is
# self-contained and does not depend on importing application code.
_DEFAULT_PERMS = {
    "admin": [
        "dashboard:view", "dcc:view", "dcc:upload", "dcc:search",
        "dcc:approve", "dcc:manage_access", "dcc:delete", "dcc:chat",
        "sidebar:crm", "sidebar:projects", "sidebar:finance", "sidebar:hr",
        "admin:manage_users",
    ],
    "director": [
        "dashboard:view", "dcc:view", "dcc:upload", "dcc:search",
        "dcc:approve", "dcc:manage_access", "dcc:chat",
        "sidebar:crm", "sidebar:projects", "sidebar:finance", "sidebar:hr",
    ],
    "manager": [
        "dashboard:view", "dcc:view", "dcc:upload", "dcc:search",
        "dcc:approve", "dcc:chat",
        "sidebar:crm", "sidebar:projects",
    ],
    "finance": [
        "dashboard:view", "dcc:view", "dcc:upload", "dcc:search",
        "dcc:approve", "dcc:chat",
        "sidebar:finance",
    ],
    "accounting": [
        "dashboard:view", "dcc:view", "dcc:upload", "dcc:search", "dcc:chat",
        "sidebar:finance",
    ],
    "human_resources": [
        "dashboard:view", "dcc:view", "dcc:search", "dcc:chat",
        "sidebar:hr",
    ],
    "engineer_mechanical": [
        "dashboard:view", "dcc:view", "dcc:upload", "dcc:search", "dcc:chat",
    ],
    "engineer_process": [
        "dashboard:view", "dcc:view", "dcc:upload", "dcc:search", "dcc:chat",
    ],
    "engineer_electrical": [
        "dashboard:view", "dcc:view", "dcc:upload", "dcc:search", "dcc:chat",
    ],
    "purchasing": [
        "dashboard:view", "dcc:view", "dcc:upload", "dcc:search", "dcc:chat",
        "sidebar:crm",
    ],
    "operational_manager": [
        "dashboard:view", "dcc:view", "dcc:upload", "dcc:search",
        "dcc:approve", "dcc:chat",
        "sidebar:projects",
    ],
}


def upgrade() -> None:
    # ------------------------------------------------------------------
    # profiles.username
    # ------------------------------------------------------------------
    # Add as nullable first so existing rows are not rejected.
    op.add_column(
        "profiles",
        sa.Column("username", sa.String(length=64), nullable=True),
    )

    # Back-fill: for pre-existing rows, derive a username from auth.users.email
    # local-part if available, otherwise from the profile id.
    op.execute(
        """
        UPDATE profiles p
        SET username = COALESCE(
            NULLIF(split_part(au.email, '@', 1), ''),
            'user_' || substr(p.id::text, 1, 8)
        )
        FROM auth.users au
        WHERE au.id = p.id AND p.username IS NULL;
        """
    )
    # Catch any leftovers (profile without an auth.users row).
    op.execute(
        """
        UPDATE profiles
        SET username = 'user_' || substr(id::text, 1, 8)
        WHERE username IS NULL;
        """
    )

    op.alter_column("profiles", "username", nullable=False)
    op.create_unique_constraint("uq_profiles_username", "profiles", ["username"])
    op.create_index("ix_profiles_username", "profiles", ["username"])

    # ------------------------------------------------------------------
    # role_permissions
    # ------------------------------------------------------------------
    # Reuse the existing `app_role` enum created by the profiles migration
    # rather than re-creating it (CREATE TYPE would fail with DuplicateObject).
    app_role_enum = postgresql.ENUM(
        "admin", "director", "manager", "finance", "accounting",
        "human_resources", "engineer_mechanical", "engineer_process",
        "engineer_electrical", "purchasing", "operational_manager",
        name="app_role",
        create_type=False,
    )

    op.create_table(
        "role_permissions",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("role", app_role_enum, nullable=False),
        sa.Column("permission", sa.String(length=64), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.UniqueConstraint("role", "permission", name="uq_role_permission"),
    )
    op.create_index("ix_role_permissions_role", "role_permissions", ["role"])
    op.create_index("ix_role_permissions_permission", "role_permissions", ["permission"])

    # Seed the default permission matrix so existing roles keep working.
    bind = op.get_bind()
    rows: list[dict] = []
    for role, perms in _DEFAULT_PERMS.items():
        for perm in perms:
            rows.append({"role": role, "permission": perm})
    if rows:
        bind.execute(
            sa.text(
                "INSERT INTO role_permissions (role, permission) "
                "VALUES (:role, :permission) "
                "ON CONFLICT ON CONSTRAINT uq_role_permission DO NOTHING"
            ),
            rows,
        )


def downgrade() -> None:
    op.drop_index("ix_role_permissions_permission", table_name="role_permissions")
    op.drop_index("ix_role_permissions_role", table_name="role_permissions")
    op.drop_table("role_permissions")

    op.drop_index("ix_profiles_username", table_name="profiles")
    op.drop_constraint("uq_profiles_username", "profiles", type_="unique")
    op.drop_column("profiles", "username")
