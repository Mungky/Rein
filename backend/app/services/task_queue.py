"""Background task queue for REIN — processes Sheets indexing, email, and cleanup."""

import asyncio
import logging
from dataclasses import dataclass
from datetime import datetime, timezone
from enum import Enum
from typing import Any

from sqlalchemy import select, update

logger = logging.getLogger(__name__)


class TaskType(str, Enum):
    INDEX_TO_SHEETS = "index_to_sheets"
    SEND_EMAIL = "send_email"
    AUDIT_FILE = "audit_file"
    CLEANUP_EXPIRED_VIEW_REQUESTS = "cleanup_expired_view_requests"
    PURGE_TAG_HISTORY = "purge_tag_history"


@dataclass
class Task:
    task_type: TaskType
    payload: dict[str, Any]


class TaskQueue:
    """Simple asyncio.Queue-based task processor.

    Runs as a background coroutine alongside FastAPI.
    Tasks are processed sequentially — suitable for this scale.
    """

    def __init__(self) -> None:
        self._queue: asyncio.Queue[Task] = asyncio.Queue()
        self._running = False
        self._worker: asyncio.Task | None = None

    def enqueue(self, task_type: TaskType, payload: dict[str, Any] | None = None) -> None:
        """Add a task to the queue."""
        self._queue.put_nowait(Task(task_type=task_type, payload=payload or {}))

    async def start(self) -> None:
        """Start the background worker."""
        if self._running:
            return
        self._running = True
        self._worker = asyncio.create_task(self._process_loop())
        logger.info("TaskQueue worker started")

    async def stop(self) -> None:
        """Stop the background worker gracefully."""
        self._running = False
        if self._worker:
            self._worker.cancel()
            try:
                await self._worker
            except asyncio.CancelledError:
                pass
        logger.info("TaskQueue worker stopped")

    async def _process_loop(self) -> None:
        """Process tasks from the queue in order."""
        while self._running:
            try:
                task = await asyncio.wait_for(self._queue.get(), timeout=5.0)
            except asyncio.TimeoutError:
                continue
            except asyncio.CancelledError:
                break

            try:
                await self._execute(task)
            except Exception as e:
                logger.error("Task %s failed: %s", task.task_type.value, e, exc_info=True)

    async def _execute(self, task: Task) -> None:
        """Execute a single task."""
        if task.task_type == TaskType.INDEX_TO_SHEETS:
            await self._index_to_sheets(task.payload)
        elif task.task_type == TaskType.SEND_EMAIL:
            await self._send_email(task.payload)
        elif task.task_type == TaskType.AUDIT_FILE:
            await self._audit_file(task.payload)
        elif task.task_type == TaskType.CLEANUP_EXPIRED_VIEW_REQUESTS:
            await self._cleanup_expired_view_requests()
        elif task.task_type == TaskType.PURGE_TAG_HISTORY:
            await self._purge_tag_history(task.payload)
        else:
            logger.warning("Unknown task type: %s", task.task_type)

    async def _purge_tag_history(self, payload: dict[str, Any]) -> None:
        """Delete one tag's history after its source or store mode changed.

        Audit D-10 — this used to run INSIDE the PATCH request, so a click on
        "Simpan data" could sit there deleting millions of rows while the
        operator stared at a spinner, and time out. It is a clean break by
        design (the tag's old lane no longer describes it), but it is not
        something the user should have to wait for.

        Deleted in bounded batches so one purge cannot hold locks on the raw
        tables for minutes at a time; each batch commits on its own, so an
        interrupted purge simply resumes on the next enqueue.
        """
        import uuid as _uuid

        from sqlalchemy import text

        from db.session import async_session_factory

        raw_tag_id = payload.get("tag_id")
        label = payload.get("label", raw_tag_id)
        try:
            tag_id = _uuid.UUID(str(raw_tag_id))
        except (TypeError, ValueError):
            logger.error("Purge riwayat dilewati: tag_id tidak valid (%r)", raw_tag_id)
            return

        batch = 10_000
        totals: dict[str, int] = {}
        # scada_tag_latest holds one row per tag, so it needs no batching.
        for table in ("scada_raw", "scada_samples"):
            removed = 0
            while True:
                async with async_session_factory() as db:
                    res = await db.execute(
                        text(
                            f"DELETE FROM {table} WHERE ctid IN ("
                            f"  SELECT ctid FROM {table} WHERE tag_id = :tid LIMIT :n)"
                        ),
                        {"tid": str(tag_id), "n": batch},
                    )
                    await db.commit()
                n = res.rowcount or 0
                removed += n
                if n < batch:
                    break
                await asyncio.sleep(0)  # let other work through between batches
            totals[table] = removed

        async with async_session_factory() as db:
            res = await db.execute(
                text("DELETE FROM scada_tag_latest WHERE tag_id = :tid"),
                {"tid": str(tag_id)},
            )
            await db.commit()
            totals["scada_tag_latest"] = res.rowcount or 0

        logger.info("Purge riwayat %s: %s", label, totals)

    async def _index_to_sheets(self, payload: dict[str, Any]) -> None:
        """Index document metadata to Google Sheets."""
        from app.services import gsheets

        try:
            row = await gsheets.add_document_row(payload)
            logger.info("Indexed document to Sheets row %s", row)
        except Exception as e:
            logger.error("Sheets indexing failed: %s", e)

    async def _send_email(self, payload: dict[str, Any]) -> None:
        """Send an email notification."""
        from app.services.email import send_email

        try:
            await send_email(
                to=payload.get("to", ""),
                subject=payload.get("subject", ""),
                body=payload.get("body", ""),
            )
        except Exception as e:
            logger.error("Email sending failed: %s", e)


    async def _audit_file(self, payload: dict[str, Any]) -> None:
        """Run 4-layer audit pipeline for a library file."""
        from app.services.audit_pipeline import run_audit

        file_id = payload.get("file_id")
        if not file_id:
            logger.error("AUDIT_FILE task missing file_id")
            return
        try:
            await run_audit(file_id)
        except Exception as e:
            logger.error("Audit pipeline failed for file %s: %s", file_id, e, exc_info=True)

    async def _cleanup_expired_view_requests(self) -> None:
        """Mark pending view requests as expired after 5-minute window."""
        from db.session import async_session_factory
        from db.models.view_request import ViewRequest

        now = datetime.now(timezone.utc)
        async with async_session_factory() as db:
            result = await db.execute(
                select(ViewRequest).where(
                    ViewRequest.status == "pending",
                    ViewRequest.expires_at < now,
                )
            )
            expired = result.scalars().all()
            for req in expired:
                req.status = "expired"
                logger.info("View request %s expired", req.id)
            await db.commit()


# Global singleton
task_queue = TaskQueue()