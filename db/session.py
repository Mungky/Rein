"""Database session management — async SQLAlchemy session factory."""

import os
import ssl
from collections.abc import AsyncGenerator

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
_ssl_ctx = ssl.create_default_context()
_ssl_ctx.check_hostname = False
_ssl_ctx.verify_mode = ssl.CERT_NONE

async_engine = create_async_engine(
    _database_url,
    echo=False,
    pool_size=5,
    max_overflow=10,
    pool_pre_ping=True,
    connect_args={"ssl": _ssl_ctx},
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