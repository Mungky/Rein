"""Add the cancelled WO state without rewriting existing work orders."""
from alembic import op

revision = "ws_20261106_05"
down_revision = "ws_20261106_04"
branch_labels = None
depends_on = None


def upgrade():
    with op.get_context().autocommit_block():
        op.execute("ALTER TYPE task_status ADD VALUE IF NOT EXISTS 'cancelled'")


def downgrade():
    # PostgreSQL cannot remove one enum value without replacing the enum and data.
    pass
