"""Application configuration — reads from environment variables.

Loads .env from project root (one level up from backend/) so that
the monorepo root .env is available when running from backend/.
"""

import os
from pathlib import Path
from dotenv import load_dotenv

# Load .env from project root (monorepo root is one level up from backend/)
_project_root = str(Path(__file__).resolve().parent.parent.parent)
_env_path = Path(_project_root) / ".env"
load_dotenv(_env_path, override=False)


class Settings:
    """Application settings loaded from environment variables."""

    # Supabase
    supabase_url: str = os.getenv("NEXT_PUBLIC_SUPABASE_URL", "")
    supabase_anon_key: str = os.getenv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "")
    supabase_service_role_key: str = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")
    supabase_jwt_secret: str = os.getenv("SUPABASE_JWT_SECRET", "")

    # Database (Supabase PostgreSQL pooled connection)
    database_url: str = os.getenv(
        "DATABASE_URL",
        "postgresql+asyncpg://postgres:password@localhost:5432/rein",
    )

    # FastAPI
    api_secret_key: str = os.getenv("API_SECRET_KEY", "")
    api_port: int = int(os.getenv("API_PORT", "8000"))

    # CORS — strip whitespace and drop empty entries to avoid silent wildcard bugs
    cors_origins: list[str] = [
        o.strip()
        for o in os.getenv(
            "CORS_ORIGINS",
            "http://localhost:3000,http://127.0.0.1:3000",
        ).split(",")
        if o.strip()
    ]

    # Google Drive & Sheets (OAuth 2.0)
    google_client_id: str = os.getenv("GOOGLE_CLIENT_ID", "")
    google_client_secret: str = os.getenv("GOOGLE_CLIENT_SECRET", "")
    google_token_path: str = os.getenv(
        "GOOGLE_TOKEN_PATH", "credentials/token.json"
    )
    google_credentials_path: str = os.getenv(
        "GOOGLE_CREDENTIALS_PATH", "credentials/credentials.json"
    )
    google_drive_root_folder_id: str = os.getenv(
        "GOOGLE_DRIVE_ROOT_FOLDER_ID", "1rsATPU5-JkOvNXqolzej0BgUFXAb4VHh"
    )
    google_sheets_spreadsheet_id: str = os.getenv(
        "GOOGLE_SHEETS_SPREADSHEET_ID", "1oZjkzGInjL6a5LxfmD8a8DydpHOb-yeXWom2TfGsBlk"
    )
    google_sheets_public_spreadsheet_id: str = os.getenv(
        "GOOGLE_SHEETS_PUBLIC_SPREADSHEET_ID", "1gBr1lbQNRo-HpFD7evJNL88nbvu8ecyhiFMTmCrMehc"
    )

    # AI (NimBus) — Ollama
    ollama_base_url: str = os.getenv("OLLAMA_BASE_URL", "http://localhost:11434")
    ollama_model: str = os.getenv("OLLAMA_MODEL", "glm-5.1:cloud")
    ollama_api_key: str = os.getenv("OLLAMA_API_KEY", "")

    # SMTP (Gmail)
    smtp_host: str = os.getenv("SMTP_HOST", "smtp.gmail.com")
    smtp_port: int = int(os.getenv("SMTP_PORT", "587"))
    smtp_user: str = os.getenv("SMTP_USER", "")
    smtp_password: str = os.getenv("SMTP_PASSWORD", "")
    smtp_from: str = os.getenv("SMTP_FROM", "")

    # Frontend
    frontend_url: str = os.getenv("NEXT_PUBLIC_API_URL", "http://localhost:3000")

    # Library — real email addresses for Pustakawan approval notifications
    # Comma-separated. Falls back to smtp_from if empty.
    librarian_emails: str = os.getenv("LIBRARIAN_EMAILS", "")


settings = Settings()