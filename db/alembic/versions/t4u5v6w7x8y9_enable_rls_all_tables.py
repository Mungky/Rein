"""Enable Row Level Security on every application table (security K-1)

Revision ID: t4u5v6w7x8y9
Revises: s3t4u5v6w7x8
Create Date: 2026-07-08 09:20:00.000000

WHY
    Supabase exposes a PostgREST API for every table using the public `anon`
    key (which is embedded in the frontend bundle — that is normal). Without
    Row Level Security, anyone on the internet can read/insert/update/delete
    every row through that API, completely bypassing the FastAPI backend and
    its RBAC. Tables created via Alembic have RLS OFF by default, so this had
    to be enabled explicitly.

WHAT THIS DOES
    Enables RLS in "deny all" mode on every application table: no policy is
    created, so PostgREST (anon/authenticated roles) is denied. The backend is
    unaffected — it connects as the table owner over DATABASE_URL, and owners
    bypass RLS. `scada_samples` keeps its own realtime policy from an earlier
    migration; enabling RLS again is a no-op there.

    ENABLE ROW LEVEL SECURITY is idempotent, so running this against a database
    where RLS was already turned on by hand simply confirms the state.

    `alembic_version` is intentionally excluded (Alembic's own bookkeeping).
"""
from alembic import op


# revision identifiers, used by Alembic.
revision = "t4u5v6w7x8y9"
down_revision = "s3t4u5v6w7x8"
branch_labels = None
depends_on = None


# Every application table. Keep this list in sync with new migrations that
# CREATE TABLE — a new table without RLS is an open door.
TABLES = [
    "access_requests",
    "approvals",
    "audit_jobs",
    "chat_messages",
    "clients",
    "clients_projects",
    "dcc_activity_log",
    "document_sequences",
    "documents",
    "file_types",
    "folder_permissions",
    "library_audit_log",
    "library_files",
    "library_folders",
    "phase_templates",
    "profiles",
    "project_templates",
    "role_permissions",
    "scada_perspectives",
    "scada_samples",
    "scada_sheets",
    "scada_sites",
    "scada_streams",
    "scada_tags",
    "scada_workbench_columns",
    "task_completions",
    "task_templates",
    "upload_queue",
    "view_requests",
    "workspace_phases",
    "workspace_projects",
    "workspace_tasks",
]


def upgrade() -> None:
    for table in TABLES:
        op.execute(f"ALTER TABLE public.{table} ENABLE ROW LEVEL SECURITY;")


def downgrade() -> None:
    # Do NOT disable RLS on scada_samples: it relies on RLS + a policy for its
    # realtime feature and predates this migration.
    for table in TABLES:
        if table == "scada_samples":
            continue
        op.execute(f"ALTER TABLE public.{table} DISABLE ROW LEVEL SECURITY;")
