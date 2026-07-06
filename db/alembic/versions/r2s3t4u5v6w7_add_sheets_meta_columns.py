"""workbench v2: scada_sheets + tag meta + column kind (Table Editor model)

Revision ID: r2s3t4u5v6w7
Revises: q1r2s3t4u5v6
Create Date: 2026-07-05 20:00:00.000000

Analisis v2 ala Supabase Table Editor / TDengine:
  - scada_sheets — named "Tabel" grouping tags (TDengine supertable analogue)
  - scada_tags.sheet_id (NOT NULL after backfill) + meta JSONB (values of
    manual metadata columns — TDengine TAGS analogue)
  - scada_workbench_columns.sheet_id (CASCADE with its sheet) + kind
    ("formula" | "text" | "number"); formula becomes nullable

Backfill: if any tags/columns exist, a default sheet "Utama" is created and
everything is attached to it, so the migration is safe on a live DB.
"""
import uuid
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision = "r2s3t4u5v6w7"
down_revision = "q1r2s3t4u5v6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "scada_sheets",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("name", sa.String(length=80), nullable=False),
        sa.Column("position", sa.Integer(), server_default="0", nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id"),
    )

    # Add as nullable first, backfill, then tighten to NOT NULL
    op.add_column("scada_tags", sa.Column("sheet_id", sa.Uuid(), nullable=True))
    op.add_column(
        "scada_tags",
        sa.Column(
            "meta",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default=sa.text("'{}'::jsonb"),
            nullable=False,
        ),
    )
    op.add_column(
        "scada_workbench_columns", sa.Column("sheet_id", sa.Uuid(), nullable=True)
    )
    op.add_column(
        "scada_workbench_columns",
        sa.Column("kind", sa.String(length=10), server_default="formula", nullable=False),
    )
    op.alter_column("scada_workbench_columns", "formula", nullable=True)

    # Backfill: attach any existing rows to a default sheet "Utama"
    default_id = str(uuid.uuid4())
    op.execute(
        f"""
        DO $$
        BEGIN
            IF EXISTS (SELECT 1 FROM scada_tags)
               OR EXISTS (SELECT 1 FROM scada_workbench_columns) THEN
                INSERT INTO scada_sheets (id, name, position)
                VALUES ('{default_id}', 'Utama', 0);
                UPDATE scada_tags SET sheet_id = '{default_id}' WHERE sheet_id IS NULL;
                UPDATE scada_workbench_columns SET sheet_id = '{default_id}' WHERE sheet_id IS NULL;
            END IF;
        END $$;
        """
    )

    op.alter_column("scada_tags", "sheet_id", nullable=False)
    op.alter_column("scada_workbench_columns", "sheet_id", nullable=False)
    op.create_foreign_key(
        "fk_scada_tags_sheet_id", "scada_tags", "scada_sheets", ["sheet_id"], ["id"]
    )
    op.create_foreign_key(
        "fk_scada_workbench_columns_sheet_id",
        "scada_workbench_columns",
        "scada_sheets",
        ["sheet_id"],
        ["id"],
        ondelete="CASCADE",
    )


def downgrade() -> None:
    op.drop_constraint(
        "fk_scada_workbench_columns_sheet_id",
        "scada_workbench_columns",
        type_="foreignkey",
    )
    op.drop_constraint("fk_scada_tags_sheet_id", "scada_tags", type_="foreignkey")
    op.execute("UPDATE scada_workbench_columns SET formula = '' WHERE formula IS NULL")
    op.alter_column("scada_workbench_columns", "formula", nullable=False)
    op.drop_column("scada_workbench_columns", "kind")
    op.drop_column("scada_workbench_columns", "sheet_id")
    op.drop_column("scada_tags", "meta")
    op.drop_column("scada_tags", "sheet_id")
    op.drop_table("scada_sheets")
