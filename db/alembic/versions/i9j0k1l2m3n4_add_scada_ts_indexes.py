"""Add time indexes on scada_ring / scada_samples (audit data D-2).

Both data tables carried exactly ONE index: the composite primary key
(tag_id, ts). That serves "give me tag X between A and B" perfectly, but every
retention sweep filters on TIME ALONE:

    DELETE FROM scada_ring    WHERE ts < now() - interval '24 hours'   (per minute)
    DELETE FROM scada_samples WHERE tag_id = X AND ts < ...            (archiver)

A leading-column mismatch means Postgres cannot use the PK for the first form,
so it sequentially scans the whole table — measured on the live DB before this
migration: Seq Scan over 31 153 rows, 1 233 buffers, every 60 seconds. At the
50-plant volumes projected in docs/AUDIT-DATA.md (17 M ring rows) that same
sweep reads ~1,5 GB per pass.

A plain btree on (ts) turns those sweeps into index scans that touch only the
rows actually being deleted.

Cheap now, expensive later: the tables hold ~31 k rows at the time of writing,
so CREATE INDEX finishes in milliseconds and the brief write lock is invisible.
Should this ever need re-running against a large table, switch to
CREATE INDEX CONCURRENTLY outside a transaction.

This is a pure ADD — no column, constraint, view, or row is touched.

Revision ID: i9j0k1l2m3n4
Revises: h8i9j0k1l2m3
Create Date: 2026-07-26
"""

from alembic import op

# revision identifiers, used by Alembic.
revision = "i9j0k1l2m3n4"
down_revision = "h8i9j0k1l2m3"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # IF NOT EXISTS: this index may already have been created by hand on a
    # given environment; the migration must stay replayable either way.
    op.execute("CREATE INDEX IF NOT EXISTS ix_scada_ring_ts ON scada_ring (ts)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_scada_samples_ts ON scada_samples (ts)")


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_scada_samples_ts")
    op.execute("DROP INDEX IF EXISTS ix_scada_ring_ts")
