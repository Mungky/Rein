"""Auth router — Supabase JWT verification and user profile."""

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.dependencies import get_current_profile
from app.limiter import limiter
from app.routers.admin import _update_supabase_password
from db.models.profile import Profile
from db.session import get_db

router = APIRouter()


class SelfProfileUpdateRequest(BaseModel):
    """Self-service profile update. Username and role are strictly excluded."""

    model_config = ConfigDict(extra="forbid")

    full_name: str | None = Field(default=None, min_length=1, max_length=255)
    avatar_url: str | None = Field(default=None, max_length=600_000)


class SelfPasswordUpdateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    password: str = Field(min_length=6, max_length=128)


def _profile_payload(profile: Profile) -> dict:
    return {
        "id": str(profile.id),
        "username": profile.username,
        "full_name": profile.full_name,
        "initials": profile.initials,
        "avatar_url": profile.avatar_url,
        "role": profile.role.value,
        "is_active": profile.is_active,
    }


@router.get("/me")
async def get_me(profile: Annotated[Profile, Depends(get_current_profile)]):
    """Get current authenticated user's full profile."""
    return _profile_payload(profile)


@router.patch("/me")
@router.post("/me")
async def update_me(
    body: SelfProfileUpdateRequest,
    db: Annotated[AsyncSession, Depends(get_db)],
    current: Annotated[Profile, Depends(get_current_profile)],
):
    """Update own display name and/or profile photo (avatar_url).
    Username and Role cannot be changed by non-admin users."""
    profile = await db.get(Profile, current.id)
    if profile is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Profil tidak ditemukan")

    fields_set = body.model_fields_set
    if "full_name" in fields_set and body.full_name is not None:
        cleaned_name = body.full_name.strip()
        if not cleaned_name:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Display Name tidak boleh kosong.",
            )
        profile.full_name = cleaned_name
        profile.initials = profile.compute_initials()

    if "avatar_url" in fields_set:
        avatar = body.avatar_url.strip() if body.avatar_url else None
        if avatar and not (
            avatar.startswith("data:image/")
            or avatar.startswith("https://")
            or avatar.startswith("http://")
        ):
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Format foto profil tidak valid.",
            )
        profile.avatar_url = avatar

    await db.flush()
    await db.refresh(profile)
    return _profile_payload(profile)


@router.post("/me/password", status_code=status.HTTP_204_NO_CONTENT)
async def update_my_password(
    body: SelfPasswordUpdateRequest,
    current: Annotated[Profile, Depends(get_current_profile)],
):
    """Allow an authenticated user to change their own password."""
    await _update_supabase_password(current.id, body.password)
    return None


@router.post("/session")
@limiter.limit("20/minute")
async def verify_session(
    request: Request,
    profile: Annotated[Profile, Depends(get_current_profile)],
):
    """Verify the current session and return user profile + role."""
    return {
        "user": _profile_payload(profile),
        "authenticated": True,
    }
