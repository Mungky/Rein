"""REIN API — FastAPI backend for Remula Inti Rekayasa ERP/CRM."""

import asyncio
import logging
import sys
from contextlib import asynccontextmanager
from pathlib import Path

# Add project root to Python path so `db` package is importable
# Backend runs from backend/, project root is one level up
_project_root = str(Path(__file__).resolve().parent.parent.parent)
if _project_root not in sys.path:
    sys.path.insert(0, _project_root)

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.routers import (
    auth,
    documents,
    upload,
    approvals,
    access,
    chat,
    queue,
    dashboard,
    admin,
    permissions,
    clients,
    projects,
    dcc_activity,
    workspace,
    library,
)
from app.services.task_queue import task_queue, TaskType

logger = logging.getLogger(__name__)

# Periodic cleanup interval (seconds)
CLEANUP_INTERVAL = 300  # 5 minutes


async def _periodic_cleanup() -> None:
    """Periodically clean up expired proposals and access requests."""
    while True:
        await asyncio.sleep(CLEANUP_INTERVAL)
        try:
            task_queue.enqueue(TaskType.CLEANUP_EXPIRED_PROPOSALS)
            task_queue.enqueue(TaskType.REVOKE_EXPIRED_ACCESS)
            task_queue.enqueue(TaskType.CLEANUP_EXPIRED_VIEW_REQUESTS)
        except Exception as e:
            logger.error("Cleanup task enqueue failed: %s", e)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Start background workers on startup, stop on shutdown."""
    await task_queue.start()
    cleanup_task = asyncio.create_task(_periodic_cleanup())
    logger.info("REIN API started — task queue active, cleanup every %ds", CLEANUP_INTERVAL)
    yield
    cleanup_task.cancel()
    await task_queue.stop()
    logger.info("REIN API shutting down")


app = FastAPI(
    title="REIN API",
    version="0.1.0",
    description="Backend API for REIN ERP/CRM — Remula Inti Rekayasa",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/health")
async def health_check():
    return {"status": "ok", "version": "0.1.0"}


app.include_router(auth.router, prefix="/api/auth", tags=["auth"])
app.include_router(documents.router, prefix="/api/documents", tags=["documents"])
app.include_router(upload.router, prefix="/api/upload", tags=["upload"])
app.include_router(approvals.router, prefix="/api/approvals", tags=["approvals"])
app.include_router(access.router, prefix="/api/access", tags=["access"])
app.include_router(chat.router, prefix="/api/chat", tags=["chat"])
app.include_router(queue.router, prefix="/api/queue", tags=["queue"])
app.include_router(dashboard.router, prefix="/api/dashboard", tags=["dashboard"])
app.include_router(admin.router, prefix="/api/admin", tags=["admin"])
app.include_router(permissions.router, prefix="/api/permissions", tags=["permissions"])
app.include_router(clients.router, prefix="/api/clients", tags=["clients"])
app.include_router(projects.router, prefix="/api/projects", tags=["projects"])
app.include_router(dcc_activity.router, prefix="/api/dcc/activity", tags=["dcc"])
app.include_router(workspace.router, prefix="/api/workspace", tags=["workspace"])
app.include_router(library.router, prefix="/api/library", tags=["library"])