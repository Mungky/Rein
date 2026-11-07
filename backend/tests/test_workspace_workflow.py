import pytest
from fastapi import HTTPException

from app.services.workspace_workflow import transition, status_targets
from db.models.workspace import TaskStatus


@pytest.mark.parametrize("source", [TaskStatus.todo, TaskStatus.overdue, TaskStatus.in_progress])
def test_current_and_legacy_report_must_wait_for_review(source):
    assert transition(source, "submit") == TaskStatus.pending_review


def test_report_then_approval_is_required_for_done():
    status = transition(TaskStatus.todo, "start")
    status = transition(status, "submit")
    assert transition(status, "approve") == TaskStatus.done


@pytest.mark.parametrize("source", [TaskStatus.todo, TaskStatus.in_progress, TaskStatus.overdue, TaskStatus.done])
def test_cannot_approve_without_pending_report(source):
    with pytest.raises(HTTPException) as exc:
        transition(source, "approve")
    assert exc.value.status_code == 409


@pytest.mark.parametrize("action", ["start", "submit", "approve", "request_revision"])
def test_done_cannot_be_overwritten_by_stale_action(action):
    with pytest.raises(HTTPException):
        transition(TaskStatus.done, action)


def test_revision_returns_to_work_without_finishing():
    assert transition(TaskStatus.pending_review, "request_revision") == TaskStatus.in_progress


def test_executor_cannot_skip_review_or_cancel_and_manager_can_reopen():
    assert status_targets(TaskStatus.in_progress, execute=True) == [TaskStatus.pending_review]
    assert status_targets(TaskStatus.pending_review, execute=True) == []
    assert status_targets(TaskStatus.pending_review, review=True) == [TaskStatus.in_progress, TaskStatus.done]
    assert status_targets(TaskStatus.cancelled, manage=True, edit=True) == [TaskStatus.todo]
    assert status_targets(TaskStatus.done, execute=True) == []
