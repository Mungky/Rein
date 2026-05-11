"""Chat message model — NimBus conversation persistence."""

import enum
import uuid

from sqlalchemy import Enum, ForeignKey, String, Text, Index
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base, TimestampMixin


class ChatRole(str, enum.Enum):
    user = "user"
    assistant = "assistant"
    system = "system"


class MessageType(str, enum.Enum):
    text = "text"
    tool_call = "tool_call"
    search_results = "search_results"
    proposal = "proposal"
    confirmation = "confirmation"


class ChatMessage(TimestampMixin, Base):
    __tablename__ = "chat_messages"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    conversation_id: Mapped[str] = mapped_column(String(100), nullable=False, index=True)
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("profiles.id"), nullable=False
    )
    role: Mapped[ChatRole] = mapped_column(
        Enum(ChatRole, name="chat_role", create_constraint=True),
        nullable=False,
    )
    message_type: Mapped[MessageType] = mapped_column(
        Enum(MessageType, name="message_type", create_constraint=True),
        default=MessageType.text,
        nullable=False,
    )
    content: Mapped[dict] = mapped_column(JSONB, default=dict, nullable=False)

    __table_args__ = (
        Index("idx_chat_messages_conv", "conversation_id", "created_at"),
    )