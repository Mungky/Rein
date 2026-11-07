"""One document record points at the original attachment bytes."""
from sqlalchemy import select
from app.services import workspace_archive as archive
from db.models.workspace_coordination import WorkspaceDocument, WorkspaceDocumentReceipt
from app.services import workspace_project as planning


async def register_attachment(db, task, profile, attachment, size, *, kind="Lampiran WO", department=None):
    existing = await db.scalar(select(WorkspaceDocument).where(WorkspaceDocument.attachment_id == attachment.id))
    if existing:
        return existing
    doc = WorkspaceDocument(id=attachment.id, project_id=await planning.task_project_id(db, task), task_id=task.id,
        attachment_id=attachment.id, code=f"WO-{task.wo_number}-DOC-{attachment.id.hex}", title=attachment.name,
        kind=kind, revision=1, status="review", filename=attachment.name, mime=attachment.content_type,
        size=size, content=None, sha256=attachment.sha256, author_id=profile.id)
    db.add(doc)
    await db.flush()
    await archive.archive_document(db, doc, profile, attachment.data, department)
    db.add_all([WorkspaceDocumentReceipt(document_id=doc.id, profile_id=key) for key in await planning.task_assignees(db, task)])
    return doc
