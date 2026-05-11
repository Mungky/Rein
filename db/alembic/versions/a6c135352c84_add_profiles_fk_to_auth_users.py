"""add_profiles_fk_to_auth_users

Revision ID: a6c135352c84
Revises: 2dd21eb2162c
Create Date: 2026-05-09 13:41:27.771279

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'a6c135352c84'
down_revision = '2dd21eb2162c'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Add foreign key from profiles.id to auth.users.id
    # This requires the auth schema to exist (managed by Supabase)
    op.execute(
        "ALTER TABLE profiles "
        "ADD CONSTRAINT fk_profiles_auth_user "
        "FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE"
    )


def downgrade() -> None:
    op.execute(
        "ALTER TABLE profiles DROP CONSTRAINT IF EXISTS fk_profiles_auth_user"
    )