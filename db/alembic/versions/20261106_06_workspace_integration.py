"""Connect WO numbering, shared documents, logbook issues and material rows."""
from alembic import op

revision = "ws_20261106_06"
down_revision = "ws_20261106_05"
branch_labels = None
depends_on = None


def upgrade():
    for statement in [
        "CREATE SEQUENCE IF NOT EXISTS workspace_wo_number_seq",
        "ALTER TABLE workspace_tasks ADD COLUMN IF NOT EXISTS wo_number integer",
        "WITH numbered AS (SELECT id, row_number() OVER (ORDER BY created_at,id) n FROM workspace_tasks) UPDATE workspace_tasks t SET wo_number=n.n FROM numbered n WHERE t.id=n.id AND t.wo_number IS NULL",
        "SELECT setval('workspace_wo_number_seq', GREATEST(COALESCE((SELECT max(wo_number) FROM workspace_tasks),0)+1, (SELECT last_value + CASE WHEN is_called THEN 1 ELSE 0 END FROM workspace_wo_number_seq)), false)",
        "ALTER TABLE workspace_tasks ALTER COLUMN wo_number SET DEFAULT nextval('workspace_wo_number_seq')",
        "ALTER TABLE workspace_tasks ALTER COLUMN wo_number SET NOT NULL",
        "CREATE UNIQUE INDEX IF NOT EXISTS uq_workspace_wo_number ON workspace_tasks(wo_number)",
        "ALTER TABLE workspace_documents ADD COLUMN IF NOT EXISTS attachment_id uuid REFERENCES workspace_attachments(id) ON DELETE RESTRICT",
        "CREATE UNIQUE INDEX IF NOT EXISTS uq_document_attachment ON workspace_documents(attachment_id)",
        "ALTER TABLE workspace_documents ALTER COLUMN content DROP NOT NULL",
        "ALTER TABLE workspace_issues ADD COLUMN IF NOT EXISTS source_log_id uuid REFERENCES workspace_work_logs(id) ON DELETE SET NULL",
        "CREATE UNIQUE INDEX IF NOT EXISTS uq_issue_source_log ON workspace_issues(source_log_id)",
        "ALTER TABLE material_requests ADD COLUMN IF NOT EXISTS line_number integer",
        "ALTER TABLE material_requests ADD COLUMN IF NOT EXISTS description varchar(255)",
        "ALTER TABLE material_requests ADD COLUMN IF NOT EXISTS specification varchar(500) NOT NULL DEFAULT ''",
        "ALTER TABLE material_requests ADD COLUMN IF NOT EXISTS creation_hash varchar(64)",
        "WITH numbered AS (SELECT id, row_number() OVER (PARTITION BY project_id ORDER BY created_at,id) n FROM material_requests) UPDATE material_requests r SET line_number=n.n FROM numbered n WHERE r.id=n.id AND r.line_number IS NULL",
        "CREATE UNIQUE INDEX IF NOT EXISTS uq_material_project_line ON material_requests(project_id,line_number)",
        "ALTER TABLE material_requests DROP CONSTRAINT IF EXISTS ck_material_status",
        "ALTER TABLE material_requests ADD CONSTRAINT ck_material_status CHECK(status IN ('requested','stock','purchased','in_transit','received'))",
        """INSERT INTO workspace_documents(id,project_id,task_id,attachment_id,code,title,kind,revision,status,filename,mime,size,content,sha256,author_id,created_at,updated_at)
        SELECT a.id,p.project_id,t.id,a.id,'WO-'||t.wo_number||'-DOC-'||replace(a.id::text,'-',''),a.name,
          CASE WHEN l.log_id IS NULL THEN 'Lampiran WO' ELSE 'Dokumentasi Proses' END,1,'review',a.name,a.content_type,octet_length(a.data),NULL,a.sha256,a.uploaded_by,a.created_at,a.created_at
        FROM workspace_attachments a JOIN workspace_tasks t ON t.id=a.task_id JOIN workspace_phases p ON p.id=t.phase_id
        LEFT JOIN workspace_work_log_attachments l ON l.attachment_id=a.id
        WHERE NOT EXISTS(SELECT 1 FROM workspace_documents d WHERE d.attachment_id=a.id)
        ON CONFLICT(id) DO NOTHING""",
    ]:
        op.execute(statement)


def downgrade():
    # Shared records and issued WO numbers must remain addressable after rollback.
    pass
