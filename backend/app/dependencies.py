"""Authentication and authorization dependencies for FastAPI."""

import time
import uuid
from typing import Annotated

import httpx
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError, ExpiredSignatureError, jwk, jwt
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from db.models.profile import AppRole, Profile
from db.models.role_permission import RolePermission
from db.session import get_db

security = HTTPBearer(auto_error=False)

# Cache the JWKS keys from Supabase to avoid re-fetching on every request.
# TTL-bounded so a key rotation propagates without a backend restart; an
# unknown kid additionally forces one refresh (see verify_supabase_token).
_JWKS_TTL_S = 3600
_jwks_cache: dict | None = None
_jwks_fetched_at: float = 0.0


async def _get_jwks(force_refresh: bool = False) -> dict:
    """Fetch JWKS from Supabase, cached for _JWKS_TTL_S seconds.

    On a failed refresh the stale cache (if any) is served rather than
    erroring — better to keep verifying with slightly old keys than to
    reject every request while Supabase hiccups.
    """
    global _jwks_cache, _jwks_fetched_at
    now = time.monotonic()
    if (
        not force_refresh
        and _jwks_cache is not None
        and now - _jwks_fetched_at < _JWKS_TTL_S
    ):
        return _jwks_cache

    jwks_url = f"{settings.supabase_url}/auth/v1/.well-known/jwks.json"
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.get(jwks_url)
            response.raise_for_status()
            _jwks_cache = response.json()
            _jwks_fetched_at = now
    except Exception:
        if _jwks_cache is None:
            raise
    return _jwks_cache


def _find_signing_key(jwks: dict, kid: str | None):
    """Return the constructed JWK matching kid, or None."""
    for key_data in jwks.get("keys", []):
        if key_data.get("kid") == kid:
            return jwk.construct(key_data)
    return None


async def verify_supabase_token(
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(security)],
) -> dict:
    """Verify a Supabase JWT token locally.

    Uses the JWT secret for HS256 tokens (older Supabase projects)
    or JWKS public keys for ES256 tokens (newer projects).
    No per-request HTTP call to Supabase Auth — only a one-time JWKS fetch.
    """
    if credentials is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing authentication token",
        )

    token = credentials.credentials

    # Extract the key ID from the JWT header to pick the right verification key
    try:
        header = jwt.get_unverified_header(token)
    except JWTError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid token",
        )

    kid = header.get("kid")
    alg = header.get("alg", "HS256")

    # Determine the signing key
    if alg in ("ES256", "ES384", "ES512") and settings.supabase_url:
        # ECDSA — fetch JWKS and find the matching key
        jwks = await _get_jwks()
        signing_key = _find_signing_key(jwks, kid)
        if signing_key is None:
            # kid not in cache — Supabase may have rotated its keys since the
            # last fetch. Refresh once before rejecting the token.
            jwks = await _get_jwks(force_refresh=True)
            signing_key = _find_signing_key(jwks, kid)
        if signing_key is None:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Token signing key not found",
            )
    elif settings.supabase_jwt_secret:
        # HS256 — use the JWT secret directly
        signing_key = settings.supabase_jwt_secret
    else:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Supabase JWT secret is not configured",
        )

    try:
        payload = jwt.decode(
            token,
            signing_key,
            algorithms=["HS256", "ES256"],
            audience="authenticated",
        )
    except ExpiredSignatureError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token has expired",
        )
    except JWTError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid token",
        )

    return {
        "id": payload.get("sub"),
        "email": payload.get("email"),
        "role": payload.get("role", "authenticated"),
    }


async def get_current_user(
    payload: Annotated[dict, Depends(verify_supabase_token)],
) -> dict:
    """Extract user info from the verified Supabase token payload."""
    return {
        "id": payload.get("id"),
        "email": payload.get("email"),
        "role": payload.get("role", "authenticated"),
    }


async def get_current_profile(
    current_user: Annotated[dict, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> Profile:
    """Get the user's Profile from the database."""
    user_id = uuid.UUID(current_user["id"])
    result = await db.execute(select(Profile).where(Profile.id == user_id))
    profile = result.scalar_one_or_none()

    if profile is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Profile not found",
        )

    if not profile.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Akun ini sudah dinonaktifkan oleh administrator",
        )

    return profile


def require_role(*allowed_roles: AppRole):
    """Dependency that checks if the current user has one of the allowed roles."""

    async def role_checker(
        profile: Annotated[Profile, Depends(get_current_profile)],
    ) -> Profile:
        if profile.role not in allowed_roles:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Role '{profile.role.value}' not authorized for this action",
            )
        return profile

    return role_checker


async def _load_permissions(
    db: AsyncSession, role: AppRole
) -> set[str]:
    """Load permission keys for a role from the database.

    Admins always get every permission (prevents lockout).
    """
    if role == AppRole.admin:
        from db.models.role_permission import ALL_PERMISSIONS

        return set(ALL_PERMISSIONS)

    result = await db.execute(
        select(RolePermission.permission).where(RolePermission.role == role)
    )
    return {row[0] for row in result.all()}


def require_permission(*permissions: str):
    """Dependency that checks if the current user's role has ALL the given permissions.

    The permission matrix is read from role_permissions table. Admins always pass.
    """

    async def perm_checker(
        profile: Annotated[Profile, Depends(get_current_profile)],
        db: Annotated[AsyncSession, Depends(get_db)],
    ) -> Profile:
        granted = await _load_permissions(db, profile.role)
        missing = set(permissions) - granted
        if missing:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Permission denied: {', '.join(sorted(missing))}",
            )
        return profile

    return perm_checker