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

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded

from app.config import settings
from app.limiter import limiter
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
    scada,
    scada_alarms,
)
from app.services.task_queue import task_queue, TaskType
from app.services import (
    alarm_engine,
    archiver,
    health_monitor,
    historian,
    partitions,
    ring_pruner,
    rollup,
)

logger = logging.getLogger(__name__)

# --- Sentry (M4) — pelacak error menggantikan "log 5xx cuma ke stdout" ------ #
# Aktif hanya bila SENTRY_DSN diisi (.env). Integrasi FastAPI/Starlette otomatis
# menangkap unhandled exception per-request; logging ERROR ke atas ikut jadi
# event. traces_sample_rate 0 = tanpa performance tracing (hemat kuota free
# tier 5rb event/bulan). Import dibungkus supaya deployment lama yang belum
# `pip install sentry-sdk` tetap hidup.
_sentry_on = False
if settings.sentry_dsn:
    try:
        import sentry_sdk

        sentry_sdk.init(
            dsn=settings.sentry_dsn,
            environment=settings.sentry_environment,
            traces_sample_rate=0.0,
            send_default_pii=False,
        )
        _sentry_on = True
        logger.info("Sentry aktif (environment=%s)", settings.sentry_environment)
    except ImportError:
        logger.warning(
            "SENTRY_DSN diset tapi sentry-sdk belum terpasang — "
            "jalankan: pip install -r requirements.txt"
        )

# Periodic cleanup interval (seconds)
CLEANUP_INTERVAL = 300  # 5 minutes


STUCK_UPLOAD_TIMEOUT_MIN = 10  # files in 'uploading'/'in_audit' > this many minutes → 'failed'


async def _flip_stuck_uploads() -> None:
    """Auto-flip Library files stuck in upload/in_audit to 'failed' state.

    Runs every CLEANUP_INTERVAL. The Drive upload itself has a 600s hard timeout
    but if the request handler dies before flipping status (e.g. worker
    restart), the file would otherwise stay 'uploading' forever. This catches
    that case.
    """
    from datetime import datetime, timedelta, timezone

    from sqlalchemy import select

    from db.session import async_session_factory
    from db.models.library_file import LibraryFile, LibraryFileStatus

    cutoff = datetime.now(timezone.utc) - timedelta(minutes=STUCK_UPLOAD_TIMEOUT_MIN)
    try:
        async with async_session_factory() as db:
            result = await db.execute(
                select(LibraryFile).where(
                    LibraryFile.upload_status.in_([
                        LibraryFileStatus.uploading,
                        LibraryFileStatus.in_audit,
                    ]),
                    LibraryFile.is_deleted.is_(False),
                    LibraryFile.created_at < cutoff,
                )
            )
            stuck = result.scalars().all()
            for f in stuck:
                f.upload_status = LibraryFileStatus.failed
            if stuck:
                logger.info("Auto-flipped %d stuck library uploads to 'failed'", len(stuck))
                await db.commit()
    except Exception as e:
        logger.error("Stuck-upload flip failed: %s", e)


async def _periodic_cleanup() -> None:
    """Periodically clean up expired proposals, access requests, and stuck uploads."""
    while True:
        await asyncio.sleep(CLEANUP_INTERVAL)
        try:
            task_queue.enqueue(TaskType.CLEANUP_EXPIRED_PROPOSALS)
            task_queue.enqueue(TaskType.REVOKE_EXPIRED_ACCESS)
            task_queue.enqueue(TaskType.CLEANUP_EXPIRED_VIEW_REQUESTS)
            await _flip_stuck_uploads()
        except Exception as e:
            logger.error("Cleanup task enqueue failed: %s", e)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Start background workers on startup, stop on shutdown."""
    await task_queue.start()
    cleanup_task = asyncio.create_task(_periodic_cleanup())
    historian_task = (
        asyncio.create_task(historian.historian_loop()) if historian.ENABLED else None
    )
    # The historian live lane only serves simulator tags — skip it entirely
    # when the simulator is off (mqtt tags get live values from the bridge).
    latest_task = (
        asyncio.create_task(historian.latest_loop())
        if historian.ENABLED and historian.SIM_ENABLED
        else None
    )
    alarm_task = (
        asyncio.create_task(alarm_engine.alarm_loop()) if alarm_engine.ENABLED else None
    )
    archiver_task = (
        asyncio.create_task(archiver.archiver_loop()) if archiver.ENABLED else None
    )
    health_task = (
        asyncio.create_task(health_monitor.health_loop())
        if health_monitor.ENABLED
        else None
    )
    # Partition housekeeping (phase 5): creates day/month drawers ahead of time
    # and drops expired ones. Creating ahead is the critical half — a day with
    # no partition means REJECTED inserts. Single owner, same rule as the alarm
    # engine: laptops set PARTITION_MANAGER_ENABLED=0.
    partition_task = (
        asyncio.create_task(partitions.maintain_loop()) if partitions.ENABLED else None
    )
    # Ring retention (audit D-3). SUPERSEDED by the partition manager above and
    # off by default now — scada_raw drops whole drawers instead of deleting
    # rows. Kept switchable (RING_PRUNER_ENABLED=1) only while scada_ring still
    # exists, i.e. until the field PCs run the bridge that writes scada_raw.
    ring_prune_task = (
        asyncio.create_task(ring_pruner.prune_loop()) if ring_pruner.ENABLED else None
    )
    # Per-minute summary (ARSITEKTUR-DATA §2.5): pre-computes what the charts
    # otherwise re-aggregate on every request. Nothing READS it until phase 4,
    # so running it now only fills the table.
    rollup_task = (
        asyncio.create_task(rollup.rollup_loop()) if rollup.ENABLED else None
    )
    logger.info("REIN API started — task queue active, cleanup every %ds", CLEANUP_INTERVAL)
    if historian_task is None:
        logger.warning("Historian sampler DISABLED via HISTORIAN_ENABLED")
    if alarm_task is None:
        logger.warning("Alarm engine DISABLED via ALARM_ENGINE_ENABLED")
    if health_task is None:
        logger.warning("Health monitor DISABLED via HEALTH_MONITOR_ENABLED")
    if partition_task is None:
        logger.warning("Partition manager DISABLED via PARTITION_MANAGER_ENABLED")
    if ring_prune_task is not None:
        logger.warning(
            "Ring pruner ENABLED — superseded by the partition manager; "
            "only needed while scada_ring still receives writes"
        )
    if rollup_task is None:
        logger.warning("Rollup per-menit DISABLED via ROLLUP_ENABLED")
    yield
    cleanup_task.cancel()
    if historian_task:
        historian_task.cancel()
    if latest_task:
        latest_task.cancel()
    if alarm_task:
        alarm_task.cancel()
    if archiver_task:
        archiver_task.cancel()
    if health_task:
        health_task.cancel()
    if partition_task:
        partition_task.cancel()
    if ring_prune_task:
        ring_prune_task.cancel()
    if rollup_task:
        rollup_task.cancel()
    await task_queue.stop()
    logger.info("REIN API shutting down")


if not settings.api_secret_key:
    logger.warning("API_SECRET_KEY is empty — set it in .env for production deployments")

app = FastAPI(
    title="REIN API",
    version="0.1.0",
    description="Backend API for REIN ERP/CRM — Remula Inti Rekayasa",
    lifespan=lifespan,
)
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "X-Requested-With"],
)


@app.middleware("http")
async def security_headers(request: Request, call_next):
    """Baseline hardening (audit Fase 2): an API has no business being framed,
    MIME-sniffed, or leaking referrers."""
    response = await call_next(request)
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("X-Frame-Options", "DENY")
    response.headers.setdefault("Referrer-Policy", "no-referrer")
    return response


@app.middleware("http")
async def log_server_errors(request: Request, call_next):
    """Server errors must never be silent — log path + traceback for every 5xx,
    plus a throttled Telegram alert via the health monitor (fire-and-forget so
    the response path is never blocked by the Telegram API).

    Sentry (bila aktif) menangkap unhandled exception lewat integrasinya
    sendiri; blok `capture_message` di bawah menambal satu celah yang tersisa —
    respons 5xx yang DIKEMBALIKAN handler tanpa exception.
    """
    try:
        response = await call_next(request)
    except Exception:
        logger.exception(
            "Unhandled exception on %s %s", request.method, request.url.path
        )
        asyncio.create_task(
            health_monitor.report_server_error(request.method, request.url.path, 500)
        )
        raise
    if response.status_code >= 500:
        logger.error(
            "HTTP %d on %s %s", response.status_code, request.method, request.url.path
        )
        if _sentry_on:
            import sentry_sdk

            sentry_sdk.capture_message(
                f"HTTP {response.status_code} on {request.method} {request.url.path}",
                level="error",
            )
        asyncio.create_task(
            health_monitor.report_server_error(
                request.method, request.url.path, response.status_code
            )
        )
    return response


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
app.include_router(scada.router, prefix="/api/scada", tags=["scada"])
app.include_router(scada_alarms.router, prefix="/api/scada", tags=["scada"])