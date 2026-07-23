"""Heartbeat bridge MQTT per site — bahan alarm kesehatan sistem (W4)

Revision ID: f6g7h8i9j0k1
Revises: e5f6g7h8i9j0
Create Date: 2026-07-23 21:00:00.000000

WHY
    Backend tidak bisa melihat langsung koneksi bridge→broker (bridge jalan
    di PC site). Bridge meng-UPSERT satu baris per site setiap ~15 s:
    `updated_at` = detak jantung (basi > 2 menit ⇒ bridge mati/PC padam),
    `connected` + `changed_at` = status koneksi broker site itu (false lama
    ⇒ broker tak terjangkau). Health monitor backend membacanya lalu kirim
    alarm Telegram lewat jalur notifier yang sudah ada.

    RLS langsung aktif (deny-all, pola K-1) — tabel ini hanya disentuh
    bridge/backend lewat DATABASE_URL (owner, lolos RLS), bukan PostgREST.
"""
from alembic import op


# revision identifiers, used by Alembic.
revision = "f6g7h8i9j0k1"
down_revision = "e5f6g7h8i9j0"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS public.scada_bridge_status (
            site_id uuid PRIMARY KEY
                REFERENCES public.scada_sites(id) ON DELETE CASCADE,
            connected boolean NOT NULL,
            changed_at timestamptz NOT NULL DEFAULT now(),
            updated_at timestamptz NOT NULL DEFAULT now()
        );
        ALTER TABLE public.scada_bridge_status ENABLE ROW LEVEL SECURITY;
        """
    )


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS public.scada_bridge_status;")
