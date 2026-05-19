"""add_file_types_table

Revision ID: l6m7n8o9p0q1
Revises: k5l6m7n8o9p0
Create Date: 2026-05-19 00:00:00.000000

Adds the `file_types` table so admins can manage document types from the UI
instead of editing source code. Seeds the 9 existing hardcoded types so
already-uploaded documents keep working. Also registers the new
`admin:manage_file_types` permission and grants it to the admin role.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision = "l6m7n8o9p0q1"
down_revision = "k5l6m7n8o9p0"
branch_labels = None
depends_on = None


_SEED_ROWS = [
    ("Q",     "Quotation",            "Surat penawaran harga",              10),
    ("DRW",   "Gambar Teknik",        "Drawing, blueprint, CAD",            20),
    ("INV",   "Invoice",              "Tagihan / faktur",                   30),
    ("PO",    "Purchase Order",       "Surat pesanan pembelian",            40),
    ("SPK",   "Surat Perintah Kerja", "Work order",                         50),
    ("RFP",   "Request for Proposal", "Permintaan proposal",                60),
    ("RPT",   "Report",               "Laporan kegiatan / proyek",          70),
    ("SPEC",  "Spesifikasi",          "Technical specification",            80),
    ("OTHER", "Lainnya",              "Dokumen umum / tidak terklasifikasi", 90),
]


def upgrade() -> None:
    op.create_table(
        "file_types",
        sa.Column("code", sa.String(length=8), primary_key=True),
        sa.Column("label", sa.String(length=64), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column(
            "is_active",
            sa.Boolean(),
            nullable=False,
            server_default="true",
        ),
        sa.Column(
            "sort_order",
            sa.Integer(),
            nullable=False,
            server_default="0",
        ),
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
    )

    file_types = sa.table(
        "file_types",
        sa.column("code", sa.String),
        sa.column("label", sa.String),
        sa.column("description", sa.Text),
        sa.column("sort_order", sa.Integer),
    )
    op.bulk_insert(
        file_types,
        [
            {"code": c, "label": l, "description": d, "sort_order": s}
            for (c, l, d, s) in _SEED_ROWS
        ],
    )

    # Grant the new permission to the admin role only.
    op.execute(
        "INSERT INTO role_permissions (role, permission, created_at, updated_at) "
        "VALUES ('admin', 'admin:manage_file_types', NOW(), NOW()) "
        "ON CONFLICT (role, permission) DO NOTHING"
    )


def downgrade() -> None:
    op.execute(
        "DELETE FROM role_permissions WHERE permission = 'admin:manage_file_types'"
    )
    op.drop_table("file_types")
