"""Alembic environment configuration for REIN database migrations."""

import os
from logging.config import fileConfig

from dotenv import load_dotenv
from sqlalchemy import pool
from sqlalchemy.engine import Connection
from sqlalchemy import create_engine, make_url

from alembic import context

# Load .env from project root (one directory up from db/)
# Alembic runs from db/ but the .env file is at the project root.
_project_root = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
_env_path = os.path.join(_project_root, ".env")
if os.path.exists(_env_path):
    load_dotenv(_env_path, override=False)

# Import all models so Alembic can detect them
from models import Base

config = context.config

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

# Resolve the database URL from the environment.
# We store it in a module-level variable instead of using
# config.set_main_option() because the URL contains percent-encoded
# characters (%26, %2B, etc.) which Python's ConfigParser treats as
# interpolation markers, causing ValueError.
_db_url = os.getenv("DATABASE_URL", "")
if _db_url:
    # Convert asyncpg URL to standard psycopg2 URL for Alembic migrations
    _db_url = _db_url.replace("+asyncpg", "")
    # Supabase pooler requires SSL — inject sslmode into the URL if not present
    if "?" in _db_url:
        if "sslmode" not in _db_url:
            _db_url += "&sslmode=require"
    else:
        _db_url += "?sslmode=require"

target_metadata = Base.metadata


def _get_url() -> str:
    """Return the resolved database URL for migrations."""
    return _db_url or config.get_main_option("sqlalchemy.url")


def run_migrations_offline() -> None:
    """Run migrations in 'offline' mode."""
    context.configure(
        url=_get_url(),
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )
    with context.begin_transaction():
        context.run_migrations()


def do_run_migrations(connection: Connection) -> None:
    context.configure(connection=connection, target_metadata=target_metadata)
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    """Run migrations in 'online' mode using a synchronous engine.

    Alembic migrations use synchronous connections (psycopg2).
    The +asyncpg driver is stripped above so the URL is a standard
    postgresql:// URL suitable for a sync engine.
    """
    connectable = create_engine(
        _get_url(),
        poolclass=pool.NullPool,
    )

    with connectable.connect() as connection:
        do_run_migrations(connection)

    connectable.dispose()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()