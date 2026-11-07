"""Link project uploads to division archives in Document Manager."""
from alembic import op

revision = "ws_20261106_07"
down_revision = "ws_20261106_06"
branch_labels = None
depends_on = None


def upgrade():
    op.execute("""CREATE TABLE IF NOT EXISTS workspace_archive_files (
      document_id uuid PRIMARY KEY REFERENCES workspace_documents(id) ON DELETE CASCADE,
      library_file_id uuid NOT NULL UNIQUE REFERENCES library_files(id) ON DELETE RESTRICT,
      department varchar(50) NOT NULL,
      folder_path varchar(1000) NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    )""")
    op.execute("ALTER TABLE workspace_archive_files ENABLE ROW LEVEL SECURITY")


def downgrade():
    # Keep references to issued documents addressable on application rollback.
    pass
