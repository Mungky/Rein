"""DCC activity log router — file upload and access event tracking."""

import logging
from typing import Annotated

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.dependencies import get_current_profile, require_permission
from db.models.dcc_activity_log import DccActivityLog, DccAction
from db.models.profile import Profile
from db.session import get_db

logger = logging.getLogger(__name__)

router = APIRouter()


class ActivityLogCreate(BaseModel):
    action: DccAction
    detail: str


class ActivityLogResponse(BaseModel):
    id: str
    user_name: str
    user_initials: str
    user_role: str
    action: str
    detail: str
    created_at: str

    model_config = {"from_attributes": True}


@router.post("", status_code=201)
async def log_activity(
    body: ActivityLogCreate,
    db: Annotated[AsyncSession, Depends(get_db)],
    profile: Annotated[Profile, Depends(require_permission("dcc:view"))],
) -> dict:
    """Record a file upload or access-request event for the current user."""
    entry = DccActivityLog(
        profile_id=profile.id,
        action=body.action,
        detail=body.detail[:500],
    )
    db.add(entry)
    await db.flush()
    return {"id": str(entry.id)}


@router.get("", response_model=list[ActivityLogResponse])
async def list_activities(
    db: Annotated[AsyncSession, Depends(get_db)],
    _profile: Annotated[Profile, Depends(require_permission("dcc:view"))],
    limit: int = Query(default=50, le=200),
) -> list[ActivityLogResponse]:
    """Return the most recent file activity entries, newest first."""
    result = await db.execute(
        select(DccActivityLog)
        .order_by(DccActivityLog.created_at.desc())
        .limit(limit)
    )
    entries = list(result.scalars().all())

    response: list[ActivityLogResponse] = []
    for entry in entries:
        p = await db.get(Profile, entry.profile_id)
        if p is None:
            continue
        initials = p.initials or (p.full_name[:2].upper() if p.full_name else "?")
        response.append(ActivityLogResponse(
            id=str(entry.id),
            user_name=p.full_name,
            user_initials=initials,
            user_role=p.role.value,
            action=entry.action.value,
            detail=entry.detail,
            created_at=entry.created_at.isoformat(),
        ))
    return response
