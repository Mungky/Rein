"""add workspace tables

Revision ID: g9h1i2j3k4l5
Revises: 178dedd5c04f
Create Date: 2026-05-13 16:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'g9h1i2j3k4l5'
down_revision = '178dedd5c04f'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # -- Enums --
    project_status = sa.Enum(
        'planning', 'active', 'on_hold', 'completed',
        name='project_status',
    )
    phase_status = sa.Enum(
        'pending', 'active', 'completed',
        name='phase_status',
    )
    task_status = sa.Enum(
        'todo', 'in_progress', 'done', 'overdue',
        name='task_status',
    )
    project_status.create(op.get_bind(), checkfirst=True)
    phase_status.create(op.get_bind(), checkfirst=True)
    task_status.create(op.get_bind(), checkfirst=True)

    # -- project_templates --
    op.create_table(
        'project_templates',
        sa.Column('name', sa.String(255), nullable=False),
        sa.Column('description', sa.Text(), nullable=True),
        sa.Column('id', sa.Uuid(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('name'),
    )

    # -- phase_templates --
    op.create_table(
        'phase_templates',
        sa.Column('template_id', sa.Uuid(), nullable=False),
        sa.Column('name', sa.String(255), nullable=False),
        sa.Column('order', sa.Integer(), nullable=False, server_default='1'),
        sa.Column('estimated_days', sa.Integer(), nullable=True),
        sa.Column('id', sa.Uuid(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['template_id'], ['project_templates.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_phase_templates_template_id', 'phase_templates', ['template_id'])

    # -- task_templates --
    op.create_table(
        'task_templates',
        sa.Column('phase_template_id', sa.Uuid(), nullable=False),
        sa.Column('name', sa.String(255), nullable=False),
        sa.Column('estimated_days', sa.Integer(), nullable=True),
        sa.Column('default_role', sa.String(64), nullable=True),
        sa.Column('order', sa.Integer(), nullable=False, server_default='1'),
        sa.Column('id', sa.Uuid(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['phase_template_id'], ['phase_templates.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_task_templates_phase_template_id', 'task_templates', ['phase_template_id'])

    # -- workspace_projects --
    op.create_table(
        'workspace_projects',
        sa.Column('name', sa.String(255), nullable=False),
        sa.Column('client_name', sa.String(255), nullable=True),
        sa.Column('template_id', sa.Uuid(), nullable=True),
        sa.Column('start_date', sa.Date(), nullable=True),
        sa.Column('deadline', sa.Date(), nullable=True),
        sa.Column('status', project_status, nullable=False, server_default='planning'),
        sa.Column('manager_id', sa.Uuid(), nullable=True),
        sa.Column('description', sa.Text(), nullable=True),
        sa.Column('id', sa.Uuid(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['template_id'], ['project_templates.id'], ondelete='SET NULL'),
        sa.ForeignKeyConstraint(['manager_id'], ['profiles.id'], ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_workspace_projects_template_id', 'workspace_projects', ['template_id'])
    op.create_index('ix_workspace_projects_manager_id', 'workspace_projects', ['manager_id'])

    # -- workspace_phases --
    op.create_table(
        'workspace_phases',
        sa.Column('project_id', sa.Uuid(), nullable=False),
        sa.Column('name', sa.String(255), nullable=False),
        sa.Column('order', sa.Integer(), nullable=False, server_default='1'),
        sa.Column('start_date', sa.Date(), nullable=True),
        sa.Column('deadline', sa.Date(), nullable=True),
        sa.Column('status', phase_status, nullable=False, server_default='pending'),
        sa.Column('id', sa.Uuid(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['project_id'], ['workspace_projects.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_workspace_phases_project_id', 'workspace_phases', ['project_id'])

    # -- workspace_tasks --
    op.create_table(
        'workspace_tasks',
        sa.Column('phase_id', sa.Uuid(), nullable=False),
        sa.Column('name', sa.String(255), nullable=False),
        sa.Column('assigned_to', sa.Uuid(), nullable=True),
        sa.Column('deadline', sa.Date(), nullable=True),
        sa.Column('status', task_status, nullable=False, server_default='todo'),
        sa.Column('notes', sa.Text(), nullable=True),
        sa.Column('order', sa.Integer(), nullable=False, server_default='1'),
        sa.Column('id', sa.Uuid(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['phase_id'], ['workspace_phases.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['assigned_to'], ['profiles.id'], ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_workspace_tasks_phase_id', 'workspace_tasks', ['phase_id'])
    op.create_index('ix_workspace_tasks_assigned_to', 'workspace_tasks', ['assigned_to'])

    # -- task_completions --
    op.create_table(
        'task_completions',
        sa.Column('task_id', sa.Uuid(), nullable=False),
        sa.Column('submitted_by', sa.Uuid(), nullable=False),
        sa.Column('photo_url', sa.Text(), nullable=True),
        sa.Column('notes', sa.Text(), nullable=True),
        sa.Column('completed_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('id', sa.Uuid(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['task_id'], ['workspace_tasks.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['submitted_by'], ['profiles.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_task_completions_task_id', 'task_completions', ['task_id'])
    op.create_index('ix_task_completions_submitted_by', 'task_completions', ['submitted_by'])

    # -- new permissions rows (insert into role_permissions) --
    op.execute("""
        INSERT INTO role_permissions (role, permission, created_at, updated_at)
        VALUES
          ('admin',                 'workspace:view',          now(), now()),
          ('admin',                 'workspace:manage',        now(), now()),
          ('admin',                 'workspace:complete_task', now(), now()),
          ('director',              'workspace:view',          now(), now()),
          ('director',              'workspace:manage',        now(), now()),
          ('manager',               'workspace:view',          now(), now()),
          ('manager',               'workspace:manage',        now(), now()),
          ('operational_manager',   'workspace:view',          now(), now()),
          ('operational_manager',   'workspace:manage',        now(), now()),
          ('engineer_mechanical',   'workspace:view',          now(), now()),
          ('engineer_mechanical',   'workspace:complete_task', now(), now()),
          ('engineer_process',      'workspace:view',          now(), now()),
          ('engineer_process',      'workspace:complete_task', now(), now()),
          ('engineer_electrical',   'workspace:view',          now(), now()),
          ('engineer_electrical',   'workspace:complete_task', now(), now()),
          ('finance',               'workspace:view',          now(), now()),
          ('accounting',            'workspace:view',          now(), now()),
          ('human_resources',       'workspace:view',          now(), now()),
          ('purchasing',            'workspace:view',          now(), now())
        ON CONFLICT DO NOTHING;
    """)


def downgrade() -> None:
    op.drop_table('task_completions')
    op.drop_index('ix_workspace_tasks_assigned_to', table_name='workspace_tasks')
    op.drop_index('ix_workspace_tasks_phase_id', table_name='workspace_tasks')
    op.drop_table('workspace_tasks')
    op.drop_index('ix_workspace_phases_project_id', table_name='workspace_phases')
    op.drop_table('workspace_phases')
    op.drop_index('ix_workspace_projects_manager_id', table_name='workspace_projects')
    op.drop_index('ix_workspace_projects_template_id', table_name='workspace_projects')
    op.drop_table('workspace_projects')
    op.drop_index('ix_task_templates_phase_template_id', table_name='task_templates')
    op.drop_table('task_templates')
    op.drop_index('ix_phase_templates_template_id', table_name='phase_templates')
    op.drop_table('phase_templates')
    op.drop_table('project_templates')

    op.execute("DROP TYPE IF EXISTS task_status")
    op.execute("DROP TYPE IF EXISTS phase_status")
    op.execute("DROP TYPE IF EXISTS project_status")
