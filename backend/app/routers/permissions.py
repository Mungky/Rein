"""Public permissions endpoint — returns the active permission matrix.

Read-only and available to any authenticated user. The frontend uses this to
gate sidebar items and route access. Admin-only mutations live in
`app.routers.admin`.
"""

from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.dependencies import get_current_profile
from db.models.profile import AppRole, Profile
from db.models.role_permission import (
    ALL_PERMISSIONS,
    PERMISSION_LABELS,
    RolePermission,
)
from db.session import get_db

router = APIRouter()


@router.get("/")
async def list_permissions(
    db: Annotated[AsyncSession, Depends(get_db)],
    _profile: Annotated[Profile, Depends(get_current_profile)],
):
    """Return the active permission matrix for any authenticated user."""
    result = await db.execute(select(RolePermission))
    matrix: dict[str, list[str]] = {role.value: [] for role in AppRole}
    for row in result.scalars().all():
        matrix.setdefault(row.role.value, []).append(row.permission)

    # Admin always has every permission (mirrors _load_permissions and the
    # force-grant in PUT /api/admin/permissions). Without this, permissions
    # added after the initial seed never reach the admin's sidebar/guards.
    matrix[AppRole.admin.value] = list(ALL_PERMISSIONS)

    return {
        "permissions": matrix,
        "all_permissions": list(ALL_PERMISSIONS),
        "labels": PERMISSION_LABELS,
    }
