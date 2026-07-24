"""Database session management — async SQLAlchemy session factory."""

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

# Supabase pooler requires SSL. Create an SSL context that does not
# verify the certificate (required for Supabase pooled connections)
# while still encrypting the connection.
#
# NB: verifikasi CA SENGAJA tidak dipakai. Pooler Supabase (Supavisor,
# aws-*.pooler.supabase.com:6543) memakai rantai self-signed yang butuh
# CA `prod-ca-2021.crt`, tapi CA itu ditolak OpenSSL 3 ("CA cert does not
# include key usage extension") — jadi verify+CA maupun verify+system-CA
# sama-sama gagal dan mematikan SELURUH koneksi database. Sampai Supabase
# menerbitkan CA yang sesuai OpenSSL 3, encrypt-only adalah satu-satunya
# mode yang berfungsi untuk pooler ini.
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
_POOL_SIZE = int(os.getenv("DB_POOL_SIZE", "10"))
_MAX_OVERFLOW = int(os.getenv("DB_MAX_OVERFLOW", "10"))

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