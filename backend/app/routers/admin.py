"""Admin router — admin-only user & role management endpoints."""

import re
import uuid
from datetime import datetime
from typing import Annotated

import httpx
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.dependencies import require_role
from db.models.profile import AppRole, Profile
from db.models.role_permission import (
    ALL_PERMISSIONS,
    PERMISSION_LABELS,
    RolePermission,
)
from db.session import get_db

router = APIRouter()

AdminOnly = Annotated[Profile, Depends(require_role(AppRole.admin))]


# Internal synthetic-email domain. Users authenticate with `username` in the UI;
# the frontend sends `<username>@SYNTHETIC_EMAIL_DOMAIN` to Supabase Auth.
SYNTHETIC_EMAIL_DOMAIN = "rein.internal"

USERNAME_RE = re.compile(r"^[a-z0-9](?:[a-z0-9._-]{0,30}[a-z0-9])?$")


def _username_to_email(username: str) -> str:
    return f"{username.lower()}@{SYNTHETIC_EMAIL_DOMAIN}"


# ---------------------------------------------------------------------------
# Pydantic schemas
# ---------------------------------------------------------------------------


class UserCreateRequest(BaseModel):
    """Body for creating a new user via admin endpoint."""

    username: str = Field(min_length=3, max_length=32)
    password: str = Field(min_length=6, max_length=128)
    full_name: str = Field(min_length=1, max_length=255)
    role: AppRole = AppRole.engineer_mechanical

    @field_validator("username")
    @classmethod
    def _validate_username(cls, v: str) -> str:
        v = v.strip().lower()
        if not USERNAME_RE.match(v):
            raise ValueError(
                "Username hanya boleh huruf kecil, angka, titik, garis bawah, "
                "atau tanda hubung (3-32 karakter)."
            )
        return v


class RoleUpdateRequest(BaseModel):
    role: AppRole


class StatusUpdateRequest(BaseModel):
    is_active: bool


class NameUpdateRequest(BaseModel):
    full_name: str = Field(min_length=1, max_length=255)


class PasswordUpdateRequest(BaseModel):
    password: str = Field(min_length=6, max_length=128)


class PermissionMatrix(BaseModel):
    """Full permission matrix payload (role -> list of permissions)."""

    permissions: dict[AppRole, list[str]]


class ProfileResponse(BaseModel):
    id: uuid.UUID
    username: str
    full_name: str
    initials: str
    avatar_url: str | None
    role: AppRole
    is_active: bool
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


# ---------------------------------------------------------------------------
# Supabase Auth Admin helpers
# ---------------------------------------------------------------------------


async def _supabase_admin_request(
    method: str,
    path: str,
    *,
    json_body: dict | None = None,
) -> httpx.Response:
    if not settings.supabase_url or not settings.supabase_service_role_key:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Supabase service-role key tidak dikonfigurasi.",
        )
    url = f"{settings.supabase_url}{path}"
    headers = {
        "apikey": settings.supabase_anon_key,
        "Authorization": f"Bearer {settings.supabase_service_role_key}",
        "Content-Type": "application/json",
    }
    async with httpx.AsyncClient(timeout=15.0) as client:
        return await client.request(method, url, headers=headers, json=json_body)


async def _update_supabase_password(user_id: uuid.UUID, password: str) -> None:
    response = await _supabase_admin_request(
        "PUT",
        f"/auth/v1/admin/users/{user_id}",
        json_body={"password": password},
    )
    if response.status_code not in (200, 204):
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Gagal reset password: {response.text}",
        )


async def _delete_supabase_user(user_id: uuid.UUID) -> None:
    """Best-effort delete of a Supabase Auth user (cleanup on failure)."""
    try:
        await _supabase_admin_request(
            "DELETE",
            f"/auth/v1/admin/users/{user_id}",
        )
    except Exception:
        pass  # Best-effort — don't mask the original error


async def _create_supabase_user(email: str, password: str) -> dict:
    """Create a user in Supabase Auth, or return existing user if email taken."""
    response = await _supabase_admin_request(
        "POST",
        "/auth/v1/admin/users",
        json_body={"email": email, "password": password, "email_confirm": True},
    )
    if response.status_code in (200, 201):
        return response.json()

    # Email already exists — look up the existing user so we can adopt it.
    # Also update the password so the admin's chosen password is set.
    if response.status_code in (400, 409, 422):
        list_resp = await _supabase_admin_request(
            "GET",
            "/auth/v1/admin/users",
        )
        if list_resp.status_code == 200:
            for u in list_resp.json().get("users", []):
                if u.get("email") == email:
                    # Update password for the adopted user
                    await _update_supabase_password(uuid.UUID(u["id"]), password)
                    return u
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Email {email} sudah dipakai tapi gagal mengambil data user.",
        )

    raise HTTPException(
        status_code=status.HTTP_502_BAD_GATEWAY,
        detail=f"Gagal membuat user di Supabase: {response.text}",
    )


# ---------------------------------------------------------------------------
# User endpoints
# ---------------------------------------------------------------------------


@router.get("/users", response_model=list[ProfileResponse])
async def list_users(
    db: Annotated[AsyncSession, Depends(get_db)],
    _admin: AdminOnly,
):
    """List all profiles (admin only)."""
    result = await db.execute(select(Profile).order_by(Profile.created_at.desc()))
    return list(result.scalars().all())


@router.post("/users", response_model=ProfileResponse, status_code=status.HTTP_201_CREATED)
async def create_user(
    body: UserCreateRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
    _admin: AdminOnly,
):
    """Create a new user. Admin enters a username (no email).

    If a Supabase Auth user already exists for this email (e.g. from a previous
    failed attempt), we adopt it instead of creating a new one.
    If the Profile insert fails, we clean up the Supabase user so no orphans
    remain.
    """
    # Reject duplicate username in profiles table early.
    existing = await db.execute(
        select(Profile).where(Profile.username == body.username)
    )
    if existing.scalar_one_or_none() is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Username sudah dipakai. Pilih username lain.",
        )

    email = _username_to_email(body.username)
    supabase_user = await _create_supabase_user(email, body.password)
    user_id = uuid.UUID(supabase_user["id"])

    # If a profile row already exists for this auth user, the username check
    # above would have caught it — but guard anyway.
    if await db.get(Profile, user_id) is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Profile sudah ada untuk user ini.",
        )

    profile = Profile(
        id=user_id,
        username=body.username,
        full_name=body.full_name,
        role=body.role,
    )
    profile.initials = profile.compute_initials()
    db.add(profile)

    try:
        await db.flush()
    except Exception:
        # Profile insert failed — clean up the Supabase Auth user so it
        # doesn't become an orphan we can't recover from.
        await _delete_supabase_user(user_id)
        raise

    await db.refresh(profile)
    return profile


@router.patch("/users/{user_id}/role", response_model=ProfileResponse)
async def update_user_role(
    user_id: uuid.UUID,
    body: RoleUpdateRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
    admin: AdminOnly,
):
    profile = await db.get(Profile, user_id)
    if profile is None:
        raise HTTPException(status_code=404, detail="Profile tidak ditemukan")

    # Prevent the admin from demoting themselves and locking out the system.
    if user_id == admin.id and body.role != AppRole.admin:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Anda tidak dapat mengubah role akun admin Anda sendiri.",
        )

    profile.role = body.role
    await db.flush()
    await db.refresh(profile)
    return profile


@router.patch("/users/{user_id}/status", response_model=ProfileResponse)
async def update_user_status(
    user_id: uuid.UUID,
    body: StatusUpdateRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
    admin: AdminOnly,
):
    profile = await db.get(Profile, user_id)
    if profile is None:
        raise HTTPException(status_code=404, detail="Profile tidak ditemukan")

    if user_id == admin.id and not body.is_active:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Anda tidak dapat menonaktifkan akun Anda sendiri.",
        )

    profile.is_active = body.is_active
    await db.flush()
    await db.refresh(profile)
    return profile


@router.patch("/users/{user_id}/name", response_model=ProfileResponse)
async def update_user_name(
    user_id: uuid.UUID,
    body: NameUpdateRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
    _admin: AdminOnly,
):
    profile = await db.get(Profile, user_id)
    if profile is None:
        raise HTTPException(status_code=404, detail="Profile tidak ditemukan")

    profile.full_name = body.full_name.strip()
    profile.initials = profile.compute_initials()
    await db.flush()
    await db.refresh(profile)
    return profile


@router.post("/users/{user_id}/reset-password", status_code=status.HTTP_204_NO_CONTENT)
async def reset_user_password(
    user_id: uuid.UUID,
    body: PasswordUpdateRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
    _admin: AdminOnly,
):
    profile = await db.get(Profile, user_id)
    if profile is None:
        raise HTTPException(status_code=404, detail="Profile tidak ditemukan")

    await _update_supabase_password(user_id, body.password)
    return None


# ---------------------------------------------------------------------------
# Permission matrix endpoints
# ---------------------------------------------------------------------------


@router.get("/permissions")
async def get_permissions(
    db: Annotated[AsyncSession, Depends(get_db)],
    _admin: AdminOnly,
):
    """Return the full permission matrix (role -> [permission])."""
    result = await db.execute(select(RolePermission))
    rows = list(result.scalars().all())

    matrix: dict[str, list[str]] = {role.value: [] for role in AppRole}
    for row in rows:
        matrix.setdefault(row.role.value, []).append(row.permission)

    return {
        "permissions": matrix,
        "all_permissions": list(ALL_PERMISSIONS),
        "labels": PERMISSION_LABELS,
    }


@router.put("/permissions")
async def set_permissions(
    body: PermissionMatrix,
    db: Annotated[AsyncSession, Depends(get_db)],
    _admin: AdminOnly,
):
    """Replace the full permission matrix.

    Admin always retains every permission — we re-add the full set after wipe
    so the system cannot be locked out from the UI.
    """
    valid = set(ALL_PERMISSIONS)
    for role, perms in body.permissions.items():
        for perm in perms:
            if perm not in valid:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"Permission tidak dikenal: {perm}",
                )

    await db.execute(delete(RolePermission))

    rows: list[RolePermission] = []
    for role, perms in body.permissions.items():
        for perm in set(perms):
            rows.append(RolePermission(role=role, permission=perm))

    # Force-grant all permissions to admin to avoid lockout.
    admin_perms = {p for p in ALL_PERMISSIONS}
    existing_admin_perms = {
        r.permission for r in rows if r.role == AppRole.admin
    }
    for perm in admin_perms - existing_admin_perms:
        rows.append(RolePermission(role=AppRole.admin, permission=perm))

    db.add_all(rows)
    await db.flush()
    return {"updated": len(rows)}
