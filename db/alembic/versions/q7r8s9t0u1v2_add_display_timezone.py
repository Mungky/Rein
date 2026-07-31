"""Zona waktu tampilan — satu setelan untuk semua berkas yang dibaca manusia.

WHY

    R-Net was UTC end to end on the server and browser-local everywhere on the
    screen, and nothing said so. For an operator in WIB (UTC+7) that meant:
    pick "30 Jul 00:00" in the export calendar, open the file, and the first row
    reads `2026-07-29 17:00:00`. The data was correct and the range was correct;
    only the labels disagreed with the person reading them. Same for the monthly
    Drive archive and the alarm emails.

    So the display zone becomes one setting instead of an accident of where the
    code happens to run. Server processes have no meaningful "local" time —
    Railway is UTC — which is exactly why it has to be configured rather than
    inferred.

WHAT USES IT
    Anything that renders a timestamp as TEXT for a human:
      - the on-demand CSV export        (app/services/data_export.py)
      - the monthly per-plant .zip      (app/services/rollup_archiver.py)
      - the export filename's date stamp (app/routers/scada.py)
      - alarm notification bodies       (app/services/notifier.py)

WHAT DOES NOT
    Storage stays UTC — every `ts` column is `timestamptz`, every partition
    boundary is a UTC instant, and every query bound is UTC. Nothing about the
    data moves; only its presentation.

    In particular the monthly archive's MONTH BOUNDARIES stay UTC. A "July"
    archive still covers [1 Jul 00:00 UTC, 1 Aug 00:00 UTC) — which, labelled in
    WIB, begins at `2026-07-01 07:00`. Shifting those boundaries would mean
    shifting the partition boundaries they are derived from, which is a far
    bigger change for a cosmetic gain.

VALIDATION LIVES AT THE WRITE SIDE
    The API rejects an unknown zone name with 422 when it is saved. The readers
    fall back to UTC and log loudly instead of raising, because one typo in the
    admin panel must not be able to break every export and every archive at once.

Revision ID: q7r8s9t0u1v2
Revises: p6q7r8s9t0u1
Create Date: 2026-07-30
"""

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision = "q7r8s9t0u1v2"
down_revision = "p6q7r8s9t0u1"
branch_labels = None
depends_on = None

# IANA name, not an offset: an offset cannot express DST, and storing "+07:00"
# would quietly become wrong for any deployment outside Indonesia.
DEFAULT_TZ = "Asia/Jakarta"


def upgrade() -> None:
    op.add_column(
        "scada_settings",
        sa.Column(
            "display_timezone",
            sa.String(length=64),
            nullable=False,
            server_default=DEFAULT_TZ,
        ),
    )


def downgrade() -> None:
    op.drop_column("scada_settings", "display_timezone")
