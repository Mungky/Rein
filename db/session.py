"""Database session management — async SQLAlchemy session factory."""
import logging
import os
import ssl
from collections.abc import AsyncGenerator
from uuid import uuid4

from dotenv import load_dotenv
from sqlalchemy.ext.asyncio import (
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

# Load .env from project root when running from db/ subdirectory
_project_root = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
_env_path = os.path.join(_project_root, ".env")
if os.path.exists(_env_path):
    load_dotenv(_env_path, override=False)

_database_url = os.getenv(
    "DATABASE_URL",
    "postgresql+asyncpg://postgres:password@localhost:5432/rein",
)

logger = logging.getLogger(__name__)
# Ensure the URL uses the asyncpg driver for SQLAlchemy async engine
if "+asyncpg" not in _database_url:
    _database_url = _database_url.replace("postgresql://", "postgresql+asyncpg://", 1)

# Opsi verifikasi SSL jika sertifikat CA disediakan melalui env DB_SSL_CA atau SSL_CERT_FILE.
# Jika file CA valid ditemukan, gunakan ssl.CERT_REQUIRED untuk verifikasi sertifikat penuh.
# Jika tidak diset / tidak ditemukan, fallback ke mode encrypt-only (ssl.CERT_NONE)
# dengan peringatan keamanan yang jelas.
_ssl_ca_path = os.getenv("DB_SSL_CA") or os.getenv("SSL_CERT_FILE")

if _ssl_ca_path and os.path.isfile(_ssl_ca_path):
    _ssl_ctx = ssl.create_default_context(cafile=_ssl_ca_path)
    _ssl_ctx.verify_mode = ssl.CERT_REQUIRED
    _ssl_ctx.check_hostname = True
    logger.info("Database SSL verification enabled using CA file: %s", _ssl_ca_path)
else:
    # PERINGATAN KEAMANAN:
    # Verifikasi sertifikat CA dimatikan (CERT_NONE) sehingga koneksi berjalan dalam
    # mode encrypt-only tanpa validasi identitas host. Mode ini rentan terhadap
    # serangan Man-in-the-Middle (MitM) jika lalu lintas jaringan dialihkan atau disadap.
    #
    # Catatan historis: Pooler transaksi Supabase (Supavisor) lama menggunakan rantai
    # sertifikat yang ditolak OpenSSL 3 tanpa CA kustom. Untuk mengaktifkan verifikasi penuh
    # di lingkungan produksi terisolasi, sediakan sertifikat CA melalui DB_SSL_CA atau SSL_CERT_FILE.
    if _ssl_ca_path:
        logger.warning(
            "DB_SSL_CA / SSL_CERT_FILE diset (%s) tetapi file tidak ditemukan. "
            "Fallback ke mode encrypt-only tanpa verifikasi sertifikat.",
            _ssl_ca_path,
        )
    _ssl_ctx = ssl.create_default_context()
    _ssl_ctx.check_hostname = False
    _ssl_ctx.verify_mode = ssl.CERT_NONE
# Connection budget. DATABASE_URL must point at Supabase's TRANSACTION pooler
# (port 6543): server slots are only held for the duration of a query, so many
# clients (local dev + deployed backend + MQTT bridge + Alembic) can share the
# small server pool without hitting "max clients reached". The session pooler
# (port 5432) pins one server slot per client connection and exhausts the cap.
#
# These are per-process caps on how many concurrent queries THIS backend holds
# open to the pooler (pool_size steady + max_overflow burst). The old 3+2 (peak
# 5) throttled ~50 concurrent /summary readers into a queue. Because Supavisor
# multiplexes, a higher client-side cap is cheap. Defaults target Supabase Pro
# production (peak 20/process); set both LOWER on a dev laptop via .env so the
# shared pooler keeps headroom for the server + bridge + Alembic, e.g.
#   DB_POOL_SIZE=5  DB_MAX_OVERFLOW=5   (dev)
# Confirm your pooler's "Pool Size" / max client connections in the Supabase
# dashboard before raising these further.
_POOL_SIZE = int(os.getenv("DB_POOL_SIZE", "20"))
_MAX_OVERFLOW = int(os.getenv("DB_MAX_OVERFLOW", "20"))
_POOL_TIMEOUT = int(os.getenv("DB_POOL_TIMEOUT", "5"))

async_engine = create_async_engine(
    _database_url,
    echo=False,
    pool_size=_POOL_SIZE,
    max_overflow=_MAX_OVERFLOW,
    pool_timeout=_POOL_TIMEOUT,
    pool_pre_ping=True,
    pool_recycle=1800,  # drop connections Supabase may have idled out
    connect_args={
        "ssl": _ssl_ctx,
        # Required for the transaction pooler (PgBouncer/Supavisor): server-side
        # prepared statements outlive the transaction but the next query may run
        # on a different server connection, causing InvalidSQLStatementName /
        # DuplicatePreparedStatement errors. Disable both caches and give any
        # ad-hoc prepared statement a unique name. Harmless on session mode.
        "statement_cache_size": 0,
        "prepared_statement_cache_size": 0,
        "prepared_statement_name_func": lambda: f"__asyncpg_{uuid4()}__",
    },
)

async_session_factory = async_sessionmaker(
    bind=async_engine,
    class_=AsyncSession,
    expire_on_commit=False,
)


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    """FastAPI dependency that yields an async database session.

    Commit is automatic on success; rollback on exception.
    """
    async with async_session_factory() as session:
        try:
            yield session
            if session.dirty or session.new or session.deleted:
                await session.commit()
        except Exception:
            await session.rollback()
            raise