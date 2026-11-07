"""Project planning, collaboration, recurrence, timesheets and portal.

Revision ID: ws_20261106_02
Revises: ws_20261106_01
Schema SQL is frozen here; future model changes do not change this migration.
"""
from alembic import op

revision = "ws_20261106_02"
down_revision = "ws_20261106_01"
branch_labels = None
depends_on = None

STATEMENTS = [
    'CREATE TABLE workspace_milestones (\n\tproject_id UUID NOT NULL, \n\tname VARCHAR(160) NOT NULL, \n\tdeadline DATE, \n\treached_at TIMESTAMP WITH TIME ZONE, \n\tid UUID NOT NULL, \n\tcreated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, \n\tupdated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, \n\tPRIMARY KEY (id), \n\tFOREIGN KEY(project_id) REFERENCES workspace_projects (id) ON DELETE CASCADE\n)',
    'CREATE INDEX ix_workspace_milestones_project_id ON workspace_milestones (project_id)',
    'ALTER TABLE workspace_milestones ENABLE ROW LEVEL SECURITY',
    'CREATE TABLE workspace_portal_shares (\n\tproject_id UUID NOT NULL, \n\ttoken_hash VARCHAR(64) NOT NULL, \n\tlabel VARCHAR(120) NOT NULL, \n\texpires_at TIMESTAMP WITH TIME ZONE NOT NULL, \n\trevoked_at TIMESTAMP WITH TIME ZONE, \n\tcreated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, \n\tid UUID NOT NULL, \n\tPRIMARY KEY (id), \n\tFOREIGN KEY(project_id) REFERENCES workspace_projects (id) ON DELETE CASCADE, \n\tUNIQUE (token_hash)\n)',
    'CREATE INDEX ix_workspace_portal_shares_project_id ON workspace_portal_shares (project_id)',
    'ALTER TABLE workspace_portal_shares ENABLE ROW LEVEL SECURITY',
    "CREATE TABLE workspace_project_updates (\n\tproject_id UUID NOT NULL, \n\tauthor_id UUID, \n\thealth VARCHAR(20) NOT NULL, \n\tsummary TEXT NOT NULL, \n\texternal BOOLEAN DEFAULT 'false' NOT NULL, \n\tcreated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, \n\tid UUID NOT NULL, \n\tPRIMARY KEY (id), \n\tFOREIGN KEY(project_id) REFERENCES workspace_projects (id) ON DELETE CASCADE, \n\tFOREIGN KEY(author_id) REFERENCES profiles (id) ON DELETE SET NULL\n)",
    'CREATE INDEX ix_workspace_project_updates_project_id ON workspace_project_updates (project_id)',
    'ALTER TABLE workspace_project_updates ENABLE ROW LEVEL SECURITY',
    'CREATE TABLE workspace_sales_orders (\n\treference VARCHAR(100) NOT NULL, \n\tcustomer VARCHAR(255) NOT NULL, \n\tclient_id UUID, \n\tproject_id UUID NOT NULL, \n\tid UUID NOT NULL, \n\tcreated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, \n\tupdated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, \n\tPRIMARY KEY (id), \n\tUNIQUE (reference), \n\tFOREIGN KEY(client_id) REFERENCES clients (id) ON DELETE SET NULL, \n\tUNIQUE (project_id), \n\tFOREIGN KEY(project_id) REFERENCES workspace_projects (id) ON DELETE CASCADE\n)',
    'ALTER TABLE workspace_sales_orders ENABLE ROW LEVEL SECURITY',
    'CREATE TABLE workspace_tags (\n\tproject_id UUID NOT NULL, \n\tname VARCHAR(60) NOT NULL, \n\tid UUID NOT NULL, \n\tPRIMARY KEY (id), \n\tCONSTRAINT uq_workspace_tag_name UNIQUE (project_id, name), \n\tFOREIGN KEY(project_id) REFERENCES workspace_projects (id) ON DELETE CASCADE\n)',
    'CREATE INDEX ix_workspace_tags_project_id ON workspace_tags (project_id)',
    'ALTER TABLE workspace_tags ENABLE ROW LEVEL SECURITY',
    "CREATE TABLE workspace_attachments (\n\ttask_id UUID NOT NULL, \n\tuploaded_by UUID, \n\tname VARCHAR(180) NOT NULL, \n\tcontent_type VARCHAR(80) NOT NULL, \n\tsha256 VARCHAR(64) NOT NULL, \n\tdata BYTEA NOT NULL, \n\texternal BOOLEAN DEFAULT 'false' NOT NULL, \n\tcreated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, \n\tid UUID NOT NULL, \n\tPRIMARY KEY (id), \n\tFOREIGN KEY(task_id) REFERENCES workspace_tasks (id) ON DELETE CASCADE, \n\tFOREIGN KEY(uploaded_by) REFERENCES profiles (id) ON DELETE SET NULL\n)",
    'CREATE INDEX ix_workspace_attachments_task_id ON workspace_attachments (task_id)',
    'ALTER TABLE workspace_attachments ENABLE ROW LEVEL SECURITY',
    "CREATE TABLE workspace_comments (\n\ttask_id UUID NOT NULL, \n\tauthor_id UUID, \n\tbody TEXT NOT NULL, \n\texternal BOOLEAN DEFAULT 'false' NOT NULL, \n\tcreated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, \n\tid UUID NOT NULL, \n\tPRIMARY KEY (id), \n\tFOREIGN KEY(task_id) REFERENCES workspace_tasks (id) ON DELETE CASCADE, \n\tFOREIGN KEY(author_id) REFERENCES profiles (id) ON DELETE SET NULL\n)",
    'CREATE INDEX ix_workspace_comments_task_id ON workspace_comments (task_id)',
    'ALTER TABLE workspace_comments ENABLE ROW LEVEL SECURITY',
    "CREATE TABLE workspace_events (\n\tproject_id UUID NOT NULL, \n\ttask_id UUID, \n\tactor_id UUID, \n\taction VARCHAR(60) NOT NULL, \n\tpayload JSONB DEFAULT '{}' NOT NULL, \n\tcreated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, \n\tid UUID NOT NULL, \n\tPRIMARY KEY (id), \n\tFOREIGN KEY(project_id) REFERENCES workspace_projects (id) ON DELETE CASCADE, \n\tFOREIGN KEY(task_id) REFERENCES workspace_tasks (id) ON DELETE SET NULL, \n\tFOREIGN KEY(actor_id) REFERENCES profiles (id) ON DELETE SET NULL\n)",
    'CREATE INDEX ix_workspace_events_created_at ON workspace_events (created_at)',
    'CREATE INDEX ix_workspace_events_project_id ON workspace_events (project_id)',
    'CREATE INDEX ix_workspace_events_task_id ON workspace_events (task_id)',
    'ALTER TABLE workspace_events ENABLE ROW LEVEL SECURITY',
    'CREATE TABLE workspace_notifications (\n\tproject_id UUID NOT NULL, \n\ttask_id UUID, \n\tprofile_id UUID NOT NULL, \n\tmessage VARCHAR(300) NOT NULL, \n\tread_at TIMESTAMP WITH TIME ZONE, \n\tcreated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, \n\tid UUID NOT NULL, \n\tPRIMARY KEY (id), \n\tFOREIGN KEY(project_id) REFERENCES workspace_projects (id) ON DELETE CASCADE, \n\tFOREIGN KEY(task_id) REFERENCES workspace_tasks (id) ON DELETE CASCADE, \n\tFOREIGN KEY(profile_id) REFERENCES profiles (id) ON DELETE CASCADE\n)',
    'CREATE INDEX ix_workspace_notifications_profile_id ON workspace_notifications (profile_id)',
    'CREATE INDEX ix_workspace_notifications_project_id ON workspace_notifications (project_id)',
    'ALTER TABLE workspace_notifications ENABLE ROW LEVEL SECURITY',
    "CREATE TABLE workspace_recurrences (\n\ttask_id UUID NOT NULL, \n\tunit VARCHAR(10) NOT NULL, \n\tinterval INTEGER NOT NULL, \n\tnext_date DATE NOT NULL, \n\tanchor_day INTEGER NOT NULL, \n\tend_date DATE, \n\tactive BOOLEAN DEFAULT 'true' NOT NULL, \n\tid UUID NOT NULL, \n\tPRIMARY KEY (id), \n\tCONSTRAINT ck_recurrence_interval CHECK (interval BETWEEN 1 AND 365), \n\tCONSTRAINT ck_recurrence_unit CHECK (unit IN ('daily', 'weekly', 'monthly')), \n\tUNIQUE (task_id), \n\tFOREIGN KEY(task_id) REFERENCES workspace_tasks (id) ON DELETE CASCADE\n)",
    'CREATE INDEX ix_workspace_recurrences_next_date ON workspace_recurrences (next_date)',
    'ALTER TABLE workspace_recurrences ENABLE ROW LEVEL SECURITY',
    'CREATE TABLE workspace_task_assignees (\n\ttask_id UUID NOT NULL, \n\tprofile_id UUID NOT NULL, \n\tPRIMARY KEY (task_id, profile_id), \n\tFOREIGN KEY(task_id) REFERENCES workspace_tasks (id) ON DELETE CASCADE, \n\tFOREIGN KEY(profile_id) REFERENCES profiles (id) ON DELETE CASCADE\n)',
    'CREATE INDEX ix_workspace_task_assignees_profile_id ON workspace_task_assignees (profile_id)',
    'ALTER TABLE workspace_task_assignees ENABLE ROW LEVEL SECURITY',
    'CREATE TABLE workspace_task_dependencies (\n\ttask_id UUID NOT NULL, \n\tpredecessor_id UUID NOT NULL, \n\tPRIMARY KEY (task_id, predecessor_id), \n\tCONSTRAINT ck_dependency_not_self CHECK (task_id <> predecessor_id), \n\tFOREIGN KEY(task_id) REFERENCES workspace_tasks (id) ON DELETE CASCADE, \n\tFOREIGN KEY(predecessor_id) REFERENCES workspace_tasks (id) ON DELETE CASCADE\n)',
    'ALTER TABLE workspace_task_dependencies ENABLE ROW LEVEL SECURITY',
    "CREATE TABLE workspace_task_plans (\n\ttask_id UUID NOT NULL, \n\tparent_id UUID, \n\tmilestone_id UUID, \n\tpriority INTEGER DEFAULT '0' NOT NULL, \n\testimated_minutes INTEGER DEFAULT '0' NOT NULL, \n\tportal_visible BOOLEAN DEFAULT 'false' NOT NULL, \n\tPRIMARY KEY (task_id), \n\tCONSTRAINT ck_task_priority CHECK (priority BETWEEN 0 AND 3), \n\tCONSTRAINT ck_task_estimate CHECK (estimated_minutes >= 0), \n\tCONSTRAINT ck_task_parent_not_self CHECK (parent_id IS NULL OR parent_id <> task_id), \n\tFOREIGN KEY(task_id) REFERENCES workspace_tasks (id) ON DELETE CASCADE, \n\tFOREIGN KEY(parent_id) REFERENCES workspace_tasks (id) ON DELETE SET NULL, \n\tFOREIGN KEY(milestone_id) REFERENCES workspace_milestones (id) ON DELETE SET NULL\n)",
    'CREATE INDEX ix_workspace_task_plans_milestone_id ON workspace_task_plans (milestone_id)',
    'CREATE INDEX ix_workspace_task_plans_parent_id ON workspace_task_plans (parent_id)',
    'ALTER TABLE workspace_task_plans ENABLE ROW LEVEL SECURITY',
    'CREATE TABLE workspace_task_tags (\n\ttask_id UUID NOT NULL, \n\ttag_id UUID NOT NULL, \n\tPRIMARY KEY (task_id, tag_id), \n\tFOREIGN KEY(task_id) REFERENCES workspace_tasks (id) ON DELETE CASCADE, \n\tFOREIGN KEY(tag_id) REFERENCES workspace_tags (id) ON DELETE CASCADE\n)',
    'ALTER TABLE workspace_task_tags ENABLE ROW LEVEL SECURITY',
    'CREATE TABLE workspace_time_entries (\n\ttask_id UUID NOT NULL, \n\tprofile_id UUID NOT NULL, \n\twork_date DATE NOT NULL, \n\tminutes INTEGER NOT NULL, \n\tdescription VARCHAR(1000) NOT NULL, \n\tid UUID NOT NULL, \n\tcreated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, \n\tupdated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, \n\tPRIMARY KEY (id), \n\tCONSTRAINT ck_time_minutes CHECK (minutes BETWEEN 1 AND 1440), \n\tFOREIGN KEY(task_id) REFERENCES workspace_tasks (id) ON DELETE CASCADE, \n\tFOREIGN KEY(profile_id) REFERENCES profiles (id) ON DELETE CASCADE\n)',
    'CREATE INDEX ix_workspace_time_entries_profile_id ON workspace_time_entries (profile_id)',
    'CREATE INDEX ix_workspace_time_entries_task_id ON workspace_time_entries (task_id)',
    'CREATE INDEX ix_workspace_time_entries_work_date ON workspace_time_entries (work_date)',
    'ALTER TABLE workspace_time_entries ENABLE ROW LEVEL SECURITY',
    'CREATE TABLE workspace_recurrence_runs (\n\trecurrence_id UUID NOT NULL, \n\tscheduled_for DATE NOT NULL, \n\tgenerated_task_id UUID NOT NULL, \n\tPRIMARY KEY (recurrence_id, scheduled_for), \n\tFOREIGN KEY(recurrence_id) REFERENCES workspace_recurrences (id) ON DELETE CASCADE, \n\tUNIQUE (generated_task_id), \n\tFOREIGN KEY(generated_task_id) REFERENCES workspace_tasks (id) ON DELETE CASCADE\n)',
    'ALTER TABLE workspace_recurrence_runs ENABLE ROW LEVEL SECURITY',
]


def upgrade():
    for statement in STATEMENTS:
        op.execute(statement)


def downgrade():
    op.drop_table('workspace_recurrence_runs')
    op.drop_table('workspace_time_entries')
    op.drop_table('workspace_task_tags')
    op.drop_table('workspace_task_plans')
    op.drop_table('workspace_task_dependencies')
    op.drop_table('workspace_task_assignees')
    op.drop_table('workspace_recurrences')
    op.drop_table('workspace_notifications')
    op.drop_table('workspace_events')
    op.drop_table('workspace_comments')
    op.drop_table('workspace_attachments')
    op.drop_table('workspace_tags')
    op.drop_table('workspace_sales_orders')
    op.drop_table('workspace_project_updates')
    op.drop_table('workspace_portal_shares')
    op.drop_table('workspace_milestones')
