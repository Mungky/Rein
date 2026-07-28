"""Add scada_topic_probe — what each MQTT topic is actually sending, right now.

THE PROBLEM IT SOLVES
    Configuring a bundled sensor means typing a field name that must match the
    gateway's own variable name EXACTLY. Until now the only way to learn that
    name was to open Node-RED, enable a debug node, and read it off the sidebar
    — on the field PC, over remote desktop. Get it wrong and the sensor is
    simply empty; the bridge logs the available names, but only into a log file
    nobody in the office can reach.

    This table is the bridge answering the question in the UI instead: for every
    topic it is subscribed to, the LAST payload it saw, already parsed into
    field → value.

ONE ROW PER (site, topic, gateway), UPSERTED — NOT A LOG
    Deliberately not history. A scrolling log of every message would be
    gigabytes a day at 300 sensors and answer the question no better: "what is
    this topic sending" is a question about the present. Bounded by the number
    of topics, so it cannot grow with time.

    `gateway` is part of the key because ONE topic can carry several gateways,
    and that is exactly the case where the operator needs help — every line has
    a `waterlevel1` and the row has to show which is which. Empty string for
    plain single-value topics (a NULL here would make the primary key useless,
    since NULLs never compare equal).

WHAT IS STORED IS THE PARSED VALUES, NOT THE RAW BYTES
    The UI needs {field: number}; the raw frame adds envelope noise, unbounded
    size, and whatever else a device chose to put on the wire. Parsing first
    keeps the row small and predictable.

scada:manage, NOT scada:view
    This is a setup tool and it exposes device-internal variable names. Same
    bar as Kelola Site.

Revision ID: o5p6q7r8s9t0
Revises: n4o5p6q7r8s9
Create Date: 2026-07-28
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = "o5p6q7r8s9t0"
down_revision = "n4o5p6q7r8s9"
branch_labels = None
depends_on = None


RLS_SQL = """
DO $$
BEGIN
    ALTER TABLE public.scada_topic_probe ENABLE ROW LEVEL SECURITY;

    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'scada_topic_probe'
          AND policyname = 'scada_topic_probe_select_scada_manage'
    ) THEN
        CREATE POLICY "scada_topic_probe_select_scada_manage"
            ON public.scada_topic_probe FOR SELECT
            TO authenticated
            USING (
                EXISTS (
                    SELECT 1 FROM public.profiles p
                    WHERE p.id = auth.uid()
                      AND (
                        p.role = 'admin'
                        OR EXISTS (
                            SELECT 1 FROM public.role_permissions rp
                            WHERE rp.role = p.role
                              AND rp.permission = 'scada:manage'
                        )
                      )
                )
            );
    END IF;
END $$;
"""


def upgrade() -> None:
    op.create_table(
        "scada_topic_probe",
        sa.Column("site_id", sa.Uuid(), nullable=False),
        sa.Column("topic", sa.String(length=300), nullable=False),
        # "" for a plain topic; the gateway name for a bundled one.
        sa.Column("gateway", sa.String(length=120), server_default="", nullable=False),
        # {field: number} as parsed by the bridge. For a plain topic: {"": value}.
        sa.Column(
            "values",
            postgresql.JSONB(),
            server_default=sa.text("'{}'::jsonb"),
            nullable=False,
        ),
        sa.Column("n_values", sa.Integer(), server_default="0", nullable=False),
        sa.Column("seen_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["site_id"], ["scada_sites.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("site_id", "topic", "gateway"),
    )
    op.execute(RLS_SQL)
    op.execute("GRANT SELECT ON public.scada_topic_probe TO authenticated")


def downgrade() -> None:
    op.drop_table("scada_topic_probe")
