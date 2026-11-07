"""Independent, versioned task stages; preserve every legacy task and status.

Revision ID: ws_20261106_01
Revises: q7r8s9t0u1v2
"""
from alembic import op
import sqlalchemy as sa

revision = "ws_20261106_01"
down_revision = "q7r8s9t0u1v2"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table("workspace_boards",
        sa.Column("project_id", sa.Uuid(), sa.ForeignKey("workspace_projects.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("version", sa.Integer(), nullable=False, server_default="1"))
    op.create_table("workspace_task_stages",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("project_id", sa.Uuid(), sa.ForeignKey("workspace_projects.id", ondelete="CASCADE"), nullable=False),
        sa.Column("name", sa.String(80), nullable=False),
        sa.Column("sequence", sa.Integer(), nullable=False),
        sa.Column("folded", sa.Boolean(), nullable=False, server_default=sa.false()))
    op.create_index("ix_workspace_task_stages_project_id", "workspace_task_stages", ["project_id"])
    op.create_table("workspace_task_placements",
        sa.Column("task_id", sa.Uuid(), sa.ForeignKey("workspace_tasks.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("stage_id", sa.Uuid(), sa.ForeignKey("workspace_task_stages.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("sequence", sa.Integer(), nullable=False, server_default="0"))
    op.create_index("ix_workspace_task_placements_stage_id", "workspace_task_placements", ["stage_id"])
    for table in ("workspace_boards", "workspace_task_stages", "workspace_task_placements"):
        op.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY")
    op.execute("INSERT INTO workspace_boards (project_id) SELECT id FROM workspace_projects")
    # md5→UUID is deterministic and needs no PostgreSQL extension.
    op.execute("""
        INSERT INTO workspace_task_stages (id, project_id, name, sequence)
        SELECT md5(p.id::text || s.code)::uuid, p.id, s.name, s.sequence
        FROM workspace_projects p CROSS JOIN (VALUES
            ('todo', 'Persiapan', 0), ('in_progress', 'Pelaksanaan', 1),
            ('pending_review', 'Pemeriksaan', 2), ('done', 'Penyerahan', 3)
        ) AS s(code, name, sequence)
    """)
    op.execute("""
        INSERT INTO workspace_task_placements (task_id, stage_id, sequence)
        SELECT t.id, md5(p.project_id::text || CASE WHEN t.status::text = 'overdue'
            THEN 'in_progress' ELSE t.status::text END)::uuid,
            row_number() OVER (PARTITION BY p.project_id,
                CASE WHEN t.status::text = 'overdue' THEN 'in_progress' ELSE t.status::text END
                ORDER BY t."order", t.id) - 1
        FROM workspace_tasks t JOIN workspace_phases p ON p.id = t.phase_id
    """)


def downgrade():
    op.drop_table("workspace_task_placements")
    op.drop_table("workspace_task_stages")
    op.drop_table("workspace_boards")
