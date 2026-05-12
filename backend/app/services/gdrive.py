"""Google Drive API service — file upload, folder management, sharing.

Uses OAuth 2.0 for authentication.
The user authenticates via browser once, then tokens are stored and refreshed automatically.
All Google API calls are synchronous — they are offloaded to a thread pool when called from async code.
"""

import asyncio
import io
import json
import os
import logging
from typing import Optional

from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import InstalledAppFlow
from google.auth.transport.requests import Request
from googleapiclient.discovery import Resource, build
from googleapiclient.http import MediaIoBaseUpload
from googleapiclient.errors import HttpError

from app.config import settings

logger = logging.getLogger(__name__)

SCOPES = [
    "https://www.googleapis.com/auth/drive",
    "https://www.googleapis.com/auth/spreadsheets",
]

_drive_service: Resource | None = None
_sheets_service: Resource | None = None


def _get_credentials() -> Credentials:
    """Get OAuth 2.0 credentials, refreshing or re-authenticating as needed.

    Cloud deployment: set GOOGLE_TOKEN_JSON env var to the contents of token.json.
    Local development: token.json file is used as before.
    """
    creds = None
    token_path = settings.google_token_path
    creds_path = settings.google_credentials_path

    # Cloud: read token from env var (no filesystem dependency)
    token_json_env = os.getenv("GOOGLE_TOKEN_JSON")
    if token_json_env:
        try:
            creds = Credentials.from_authorized_user_info(json.loads(token_json_env), SCOPES)
        except Exception as e:
            raise RuntimeError(
                f"GOOGLE_TOKEN_JSON is set but could not be parsed: {e}. "
                "Make sure it contains the full JSON content of token.json on a single line."
            )
    elif os.path.exists(token_path):
        creds = Credentials.from_authorized_user_file(token_path, SCOPES)
    else:
        raise RuntimeError(
            "No Google credentials available. Either set the GOOGLE_TOKEN_JSON env var "
            "(with the full content of token.json) for cloud deployment, or run the app "
            "locally with credentials/token.json present."
        )

    if not creds.valid:
        if creds.expired and creds.refresh_token:
            creds.refresh(Request())
            # Persist refreshed token locally (no-op in cloud — refresh_token never expires)
            if not token_json_env and os.path.exists(os.path.dirname(token_path) or "."):
                os.makedirs(os.path.dirname(token_path) or ".", exist_ok=True)
                with open(token_path, "w") as f:
                    f.write(creds.to_json())
        else:
            raise RuntimeError(
                "Google credentials are invalid and cannot be refreshed. "
                "Run the OAuth flow locally and update GOOGLE_TOKEN_JSON env var "
                "with the new token.json content."
            )

    return creds


def _get_drive_service() -> Resource:
    """Get or create a cached Drive service."""
    global _drive_service
    if _drive_service is None:
        _drive_service = build("drive", "v3", credentials=_get_credentials())
    return _drive_service


def _get_sheets_service() -> Resource:
    """Get or create a cached Sheets service."""
    global _sheets_service
    if _sheets_service is None:
        _sheets_service = build("sheets", "v4", credentials=_get_credentials())
    return _sheets_service


async def get_drive_service() -> Resource:
    """Async accessor — returns cached Drive service (creates on first call)."""
    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(None, _get_drive_service)


async def get_sheets_service() -> Resource:
    """Async accessor — returns cached Sheets service (creates on first call)."""
    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(None, _get_sheets_service)


# ---------------------------------------------------------------------------
# Upload — streaming via SpooledTemporaryFile
# ---------------------------------------------------------------------------

async def upload_file(
    file_stream: io.IOBase,
    file_name: str,
    mime_type: str,
    folder_id: str,
    file_size: int = 0,
) -> dict:
    """Upload a file to Google Drive using streaming.

    Args:
        file_stream: A readable file-like object (e.g. SpooledTemporaryFile).
        file_name: Name for the file in Drive.
        mime_type: MIME type of the file.
        folder_id: Drive folder ID to upload into.
        file_size: Size in bytes (used for resumable upload chunking).

    Returns:
        dict with id, name, webViewLink.
    """
    media = MediaIoBaseUpload(
        file_stream,
        mimetype=mime_type,
        resumable=True,
        chunksize=10 * 1024 * 1024,  # 10 MB chunks
    )

    file_metadata = {
        "name": file_name,
        "parents": [folder_id],
    }

    def _do_upload():
        service = _get_drive_service()
        request = service.files().create(
            body=file_metadata,
            media_body=media,
            fields="id,name,webViewLink",
            supportsAllDrives=True,
        )

        response = None
        while response is None:
            status, response = request.next_chunk()
            if status:
                logger.debug(
                    "Upload %s: %.1f%%", file_name, status.progress() * 100
                )

        return dict(response)

    try:
        loop = asyncio.get_running_loop()
        result = await loop.run_in_executor(None, _do_upload)
        return result
    except HttpError as e:
        logger.error("Drive upload failed for %s: %s", file_name, e)
        raise


async def upload_file_sync(
    file_content: bytes,
    file_name: str,
    mime_type: str,
    folder_id: str,
) -> dict:
    """Upload bytes to Google Drive (backward-compatible convenience).

    Prefer upload_file() with a stream for large files.
    """
    stream = io.BytesIO(file_content)
    return await upload_file(stream, file_name, mime_type, folder_id)


# ---------------------------------------------------------------------------
# Folder management
# ---------------------------------------------------------------------------

async def create_folder(name: str, parent_id: str) -> str:
    """Create a folder in Google Drive. Returns the folder ID."""
    def _do():
        service = _get_drive_service()
        file_metadata = {
            "name": name,
            "mimeType": "application/vnd.google-apps.folder",
            "parents": [parent_id],
        }
        result = service.files().create(body=file_metadata, fields="id").execute()
        return result["id"]

    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(None, _do)


async def find_or_create_folder(name: str, parent_id: str) -> str:
    """Find a folder by name under parent, or create it if it doesn't exist."""
    def _do():
        service = _get_drive_service()
        query = (
            f"name='{name}' and mimeType='application/vnd.google-apps.folder' "
            f"and '{parent_id}' in parents and trashed=false"
        )
        results = (
            service.files()
            .list(q=query, spaces="drive", fields="files(id, name)", supportsAllDrives=True)
            .execute()
        )
        if results.get("files"):
            return results["files"][0]["id"]

        # Create if not found
        file_metadata = {
            "name": name,
            "mimeType": "application/vnd.google-apps.folder",
            "parents": [parent_id],
        }
        result = service.files().create(body=file_metadata, fields="id").execute()
        return result["id"]

    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(None, _do)


async def rename_file(file_id: str, new_name: str) -> dict:
    """Rename a file in Google Drive. Returns updated file metadata."""
    def _do():
        service = _get_drive_service()
        result = (
            service.files()
            .update(
                fileId=file_id,
                body={"name": new_name},
                fields="id,name,webViewLink",
                supportsAllDrives=True,
            )
            .execute()
        )
        return dict(result)

    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(None, _do)


async def get_file(file_id: str) -> dict:
    """Get file metadata from Google Drive."""
    def _do():
        service = _get_drive_service()
        result = (
            service.files()
            .get(
                fileId=file_id,
                fields="id,name,mimeType,size,webViewLink,webContentLink,parents",
                supportsAllDrives=True,
            )
            .execute()
        )
        return dict(result)

    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(None, _do)


async def delete_file(file_id: str) -> None:
    """Delete a file from Google Drive."""
    def _do():
        service = _get_drive_service()
        service.files().delete(fileId=file_id, supportsAllDrives=True).execute()

    loop = asyncio.get_running_loop()
    await loop.run_in_executor(None, _do)


async def move_file(file_id: str, new_folder_id: str) -> dict:
    """Move a file to a different folder in Google Drive."""
    def _do():
        service = _get_drive_service()
        file = service.files().get(
            fileId=file_id, fields="parents", supportsAllDrives=True,
        ).execute()
        previous_parents = ",".join(file.get("parents", []))
        result = (
            service.files()
            .update(
                fileId=file_id,
                addParents=new_folder_id,
                removeParents=previous_parents,
                fields="id,parents",
                supportsAllDrives=True,
            )
            .execute()
        )
        return dict(result)

    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(None, _do)


async def build_folder_path(client_name: str, project_name: str) -> str:
    """Build the Google Drive folder path for a document.

    Creates the folder hierarchy: ROOT/{client_name}/{project_name}/
    Returns the folder ID where the file should be stored.
    """
    root_id = settings.google_drive_root_folder_id
    client_id = await find_or_create_folder(client_name, root_id)
    project_id = await find_or_create_folder(project_name, client_id)
    return project_id