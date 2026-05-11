"""Chat router — NimBus AI streaming chat endpoint with tool use."""

from typing import Annotated

from fastapi import APIRouter, Depends, Request
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.dependencies import get_current_profile, require_permission
from app.services.nimbus import check_ollama_status, stream_chat_response
from db.models.profile import Profile
from db.session import get_db

router = APIRouter()


@router.post("/")
async def chat(
    request: Request,
    db: Annotated[AsyncSession, Depends(get_db)] = None,
    profile: Annotated[Profile, Depends(require_permission("dcc:chat"))] = None,
):
    """Stream NimBus AI responses using SSE with tool use support.

    Accepts: { "messages": [...], "conversation_id": "...", "model": "..." }
    Returns: Server-Sent Events stream with text, tool_call, search_results, confirmation events.
    """
    body = await request.json()
    messages = body.get("messages", [])
    conversation_id = body.get("conversation_id", "")
    model = body.get("model", None)

    return StreamingResponse(
        stream_chat_response(
            messages=messages,
            conversation_id=conversation_id,
            model=model,
            user_id=str(profile.id),
            db=db,
        ),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@router.get("/status")
async def chat_status(
    _profile: Annotated[Profile, Depends(require_permission("dcc:chat"))],
):
    """Check Ollama server status and available models."""
    return await check_ollama_status()