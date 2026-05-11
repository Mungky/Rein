"""Auth router — Supabase JWT verification and user profile."""

from typing import Annotated

from fastapi import APIRouter, Depends

from app.dependencies import get_current_profile
from db.models.profile import Profile

router = APIRouter()


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


@router.post("/session")
async def verify_session(profile: Annotated[Profile, Depends(get_current_profile)]):
    """Verify the current session and return user profile + role."""
    return {
        "user": _profile_payload(profile),
        "authenticated": True,
    }
