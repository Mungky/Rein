from datetime import date
import pytest
from fastapi import HTTPException
from app.services.workspace_project import validate_graph, next_occurrence


def test_dependency_cycle_including_subtask_completion_is_rejected():
    with pytest.raises(HTTPException):
        validate_graph([("parent", "child"), ("child", "parent")])


def test_graph_accepts_shared_predecessors_and_long_chains():
    validate_graph([(i, i + 1) for i in range(3000)] + [(0, 3000)])


def test_monthly_recurrence_preserves_day_after_february():
    february = next_occurrence(date(2028, 1, 31), "monthly", 1, 31)
    assert february == date(2028, 2, 29)
    assert next_occurrence(february, "monthly", 1, 31) == date(2028, 3, 31)


def test_weekly_interval_uses_calendar_dates():
    assert next_occurrence(date(2026, 12, 28), "weekly", 2, 28) == date(2027, 1, 11)
