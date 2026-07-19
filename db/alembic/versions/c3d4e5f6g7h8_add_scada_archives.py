"""archives: scada_archives ledger for the monthly Drive archive job

Revision ID: c3d4e5f6g7h8
Revises: b2c3d4e5f6g7
Create Date: 2026-07-19 16:00:00.000000

One row per archived month. The archiver (app/services/archiver.py) INSERTs
the month row FIRST as an atomic claim (PK conflict → another backend already
owns it), uploads the month's samples to Google Drive as .xlsx, then fills in
drive_file_id and deletes the archived rows. Rows older than the retention
window are NEVER deleted unless their month has a completed archive row —
"no data loss" is enforced by this ledger.

RLS: enabled with no policies (deny-all) — only the backend (table owner)
touches it; the frontend reads archives through the API.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "c3d4e5f6g7h8"
down_revision = "b2c3d4e5f6g7"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "scada_archives",
        # First day of the archived month (UTC), e.g. 2026-04-01
        sa.Column("month", sa.Date(), nullable=False),
        sa.Column("file_name", sa.String(length=200), nullable=False),
        # NULL while the upload is in flight; set = archive completed
        sa.Column("drive_file_id", sa.String(length=128), nullable=True),
        sa.Column("web_link", sa.Text(), nullable=True),
        sa.Column("row_count", sa.Integer(), server_default="0", nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("month"),
    )
    op.execute("ALTER TABLE public.scada_archives ENABLE ROW LEVEL SECURITY")


def downgrade() -> None:
    op.drop_table("scada_archives")
