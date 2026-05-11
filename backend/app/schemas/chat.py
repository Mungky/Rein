"""Pydantic schemas for chat endpoints."""

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel

from db.models.chat_message import ChatRole, MessageType


class ChatMessageCreate(BaseModel):
    content: str
    conversation_id: str | None = None


class ChatMessageResponse(BaseModel):
    id: UUID
    conversation_id: str
    role: ChatRole
    message_type: MessageType
    content: dict
    created_at: datetime

    model_config = {"from_attributes": True}


class ChatRequest(BaseModel):
    messages: list[dict]
    conversation_id: str | None = None


class ChatStreamEvent(BaseModel):
    type: str  # "text", "tool_call", "search_results", "proposal", "done"
    content: str | dict | None = None