"""Work Order lifecycle shared by current and legacy API paths."""

from fastapi import HTTPException

from db.models.workspace import TaskStatus

TERMINAL = {TaskStatus.done, TaskStatus.cancelled}


def status_targets(status, *, execute=False, review=False, manage=False, edit=False):
    """Expose the same permitted actions to the UI and the write endpoint."""
    targets = []
    if execute and status in {TaskStatus.todo, TaskStatus.overdue}:
        targets.append(TaskStatus.in_progress)
    if execute and status == TaskStatus.in_progress:
        targets.append(TaskStatus.pending_review)
    if review and status == TaskStatus.pending_review:
        targets.extend([TaskStatus.in_progress, TaskStatus.done])
    if edit and status not in TERMINAL:
        targets.append(TaskStatus.cancelled)
    if manage and status in TERMINAL:
        targets.append(TaskStatus.todo)
    return targets


def transition(status: TaskStatus, action: str) -> TaskStatus:
    allowed = {
        "start": ({TaskStatus.todo, TaskStatus.overdue, TaskStatus.in_progress}, TaskStatus.in_progress),
        "submit": ({TaskStatus.todo, TaskStatus.overdue, TaskStatus.in_progress}, TaskStatus.pending_review),
        "approve": ({TaskStatus.pending_review}, TaskStatus.done),
        "request_revision": ({TaskStatus.pending_review}, TaskStatus.in_progress),
    }
    sources, target = allowed[action]
    if status not in sources:
        raise HTTPException(409, "Status WO sudah berubah. Muat ulang sebelum melanjutkan.")
    return target
