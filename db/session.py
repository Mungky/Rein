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

# Ensure the URL uses the asyncpg driver for SQLAlchemy async engine
if "+asyncpg" not in _database_url:
    _database_url = _database_url.replace("postgresql://", "postgresql+asyncpg://", 1)

# Supabase pooler requires SSL. Verify the server certificate against the
# Supabase CA (their pooler/db certs are signed by Supabase's own CA, not a
# public one — system CAs alone can't validate them). The CA file is public;
# download + placement instructions: db/certs/README.md. Path can be
# overridden with DB_SSL_ROOT_CERT (useful on servers that mount the cert
# elsewhere). If the file is missing we fall back to encrypt-only so a dev
# machine still boots, but log loudly — production must have the CA file.
_ca_file = os.getenv("DB_SSL_ROOT_CERT", "").strip() or os.path.join(
    _project_root, "db", "certs", "prod-ca-2021.crt"
)
if os.path.exists(_ca_file):
    _ssl_ctx = ssl.create_default_context(cafile=_ca_file)
else:
    logging.getLogger(__name__).warning(
        "CA Supabase tidak ditemukan di %s — koneksi DB terenkripsi TANPA "
        "verifikasi sertifikat. Unduh CA-nya (lihat db/certs/README.md) "
        "atau set DB_SSL_ROOT_CERT.",
        _ca_file,
    )
    _ssl_ctx = ssl.create_default_context()
    _ssl_ctx.check_hostname = False
    _ssl_ctx.verify_mode = ssl.CERT_NONE

# Connection budget. DATABASE_URL must point at Supabase's TRANSACTION pooler
# (port 6543): server slots are only held for the duration of a query, so many
# clients (local dev + deployed backend + MQTT bridge + Alembic) can share the
# small server pool without hitting "max clients reached". The session pooler
# (port 5432) pins one server slot per client connection and exhausts the cap.
_POOL_SIZE = int(os.getenv("DB_POOL_SIZE", "3"))
_MAX_OVERFLOW = int(os.getenv("DB_MAX_OVERFLOW", "2"))

async_engine = create_async_engine(
    _database_url,
    echo=False,
    pool_size=_POOL_SIZE,
    max_overflow=_MAX_OVERFLOW,
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
            await session.commit()
        except Exception:
            await session.rollback()
            raise