"""REIN API — FastAPI backend for Remula Inti Rekayasa ERP/CRM."""

import asyncio
import logging
import os
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
from uvicorn.middleware.proxy_headers import ProxyHeadersMiddleware
from app.config import settings
from app.limiter import limiter
from app.routers import (
    admin,
    auth,
    clients,
    library,
    permissions,
    projects,
    workspace,
    workspace_board,
    workspace_project,
    workspace_project_factory,
    workspace_reports,
)
from app.services.task_queue import task_queue, TaskType
from app.services import health_monitor

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
    """Periodically clean up expired view requests and stuck uploads."""
    while True:
        await asyncio.sleep(CLEANUP_INTERVAL)
        try:
            task_queue.enqueue(TaskType.CLEANUP_EXPIRED_VIEW_REQUESTS)
            await _flip_stuck_uploads()
        except Exception as e:
            logger.error("Cleanup task enqueue failed: %s", e)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Start background workers on startup, stop on shutdown."""
    from app.services.workspace_project import enabled as project_suite_enabled
    from app.services.workspace_recurrence import recurrence_loop
    from db.session import async_session_factory
    recurrence_task = asyncio.create_task(recurrence_loop(async_session_factory)) if (
        project_suite_enabled() and os.getenv("WORKSPACE_RECURRENCE_WORKER_ENABLED") == "1"
    ) else None
    await task_queue.start()
    cleanup_task = asyncio.create_task(_periodic_cleanup())
    logger.info("REIN API started — task queue active, cleanup every %ds", CLEANUP_INTERVAL)
    yield
    if recurrence_task:
        recurrence_task.cancel()
        await asyncio.gather(recurrence_task, return_exceptions=True)
    cleanup_task.cancel()
    await task_queue.stop()
    logger.info("REIN API shutting down")


# API_SECRET_KEY dicadangkan untuk integrasi masa depan / webhook internal opsional.
# Autentikasi utama REIN menggunakan Supabase JWT (SUPABASE_JWT_SECRET / SUPABASE_ANON_KEY).
# Tidak diperlukan untuk operasional normal, didokumentasikan agar tidak membingungkan operator.
if settings.api_secret_key:
    logger.debug("API_SECRET_KEY terkonfigurasi")
app = FastAPI(
    title="REIN API",
    version="0.1.0",
    description="Backend API for REIN ERP/CRM — Remula Inti Rekayasa",
    lifespan=lifespan,
)
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

# Dukungan reverse proxy (Nginx / Cloudflare / Traefik / Docker):
# Ekstraksi client IP asli via header X-Forwarded-For & X-Forwarded-Proto
trusted_proxies = os.getenv("TRUSTED_PROXIES", "*")
app.add_middleware(ProxyHeadersMiddleware, trusted_hosts=trusted_proxies)

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
app.include_router(admin.router, prefix="/api/admin", tags=["admin"])
app.include_router(permissions.router, prefix="/api/permissions", tags=["permissions"])
app.include_router(clients.router, prefix="/api/clients", tags=["clients"])
app.include_router(projects.router, prefix="/api/projects", tags=["projects"])
app.include_router(workspace.router, prefix="/api/workspace", tags=["workspace"])
from app.routers import workspace_work_orders
app.include_router(workspace_work_orders.router, prefix="/api/workspace", tags=["workspace"])
from app.routers import workspace_coordination
app.include_router(workspace_coordination.router, prefix="/api/workspace", tags=["workspace"])
from app.routers import workspace_materials
app.include_router(workspace_materials.router, prefix="/api/workspace", tags=["workspace"])
app.include_router(workspace_board.router, prefix="/api/workspace", tags=["workspace"])
app.include_router(workspace_project.router, prefix="/api/workspace", tags=["workspace"])
app.include_router(workspace_reports.router, prefix="/api/workspace", tags=["workspace"])
app.include_router(workspace_project_factory.router, prefix="/api/workspace", tags=["workspace"])
app.include_router(workspace_project.public_router, prefix="/api/project-portal", tags=["project-portal"])
app.include_router(library.router, prefix="/api/library", tags=["library"])
