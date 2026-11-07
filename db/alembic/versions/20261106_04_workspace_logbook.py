"""Simple work orders with an immutable daily logbook.
Revision ID: ws_20261106_04
Revises: ws_20261106_03
"""
from alembic import op
revision = "ws_20261106_04"
down_revision = "ws_20261106_03"
branch_labels = None
depends_on = None

DDL = ["\nCREATE TABLE workspace_work_logs (\n\ttask_id UUID NOT NULL, \n\tauthor_id UUID NOT NULL, \n\twork_date DATE NOT NULL, \n\tbody TEXT NOT NULL, \n\tminutes INTEGER DEFAULT '0' NOT NULL, \n\trequest_hash VARCHAR(64) NOT NULL, \n\tcreated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, \n\tid UUID NOT NULL, \n\tPRIMARY KEY (id), \n\tCONSTRAINT ck_work_log_minutes CHECK (minutes BETWEEN 0 AND 1440), \n\tFOREIGN KEY(task_id) REFERENCES workspace_tasks (id) ON DELETE CASCADE, \n\tFOREIGN KEY(author_id) REFERENCES profiles (id)\n)\n\n", 'CREATE INDEX ix_workspace_work_logs_author_id ON workspace_work_logs (author_id)', 'CREATE INDEX ix_workspace_work_logs_task_id ON workspace_work_logs (task_id)', 'CREATE INDEX ix_workspace_work_logs_work_date ON workspace_work_logs (work_date)', 'ALTER TABLE workspace_work_logs ENABLE ROW LEVEL SECURITY', '\nCREATE TABLE workspace_work_log_attachments (\n\tlog_id UUID NOT NULL, \n\tattachment_id UUID NOT NULL, \n\tPRIMARY KEY (log_id, attachment_id), \n\tFOREIGN KEY(log_id) REFERENCES workspace_work_logs (id) ON DELETE CASCADE, \n\tUNIQUE (attachment_id), \n\tFOREIGN KEY(attachment_id) REFERENCES workspace_attachments (id) ON DELETE CASCADE\n)\n\n', 'ALTER TABLE workspace_work_log_attachments ENABLE ROW LEVEL SECURITY']

def upgrade():
    op.execute("ALTER TABLE workspace_work_controls ADD COLUMN creation_hash varchar(64)")
    for statement in DDL:
        op.execute(statement)

def downgrade():
    op.execute("DROP TABLE workspace_work_log_attachments")
    op.execute("DROP TABLE workspace_work_logs")
    op.execute("ALTER TABLE workspace_work_controls DROP COLUMN creation_hash")
