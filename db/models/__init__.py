"""Database models package — re-exports all models for Alembic auto-detection."""

from .base import Base, TimestampMixin, UUIDMixin
from .profile import Profile, AppRole, ROLE_LABELS
from .role_permission import (
    RolePermission,
    ALL_PERMISSIONS,
    PERMISSION_LABELS,
    DEFAULT_ROLE_PERMISSIONS,
)
from .client import Client
from .project import Project
from .document import Document, DocType, DocStatus, DOC_TYPE_LABELS
from .upload_queue import UploadQueue, UploadStatus
from .approval import Approval, ApprovalAction
from .access_request import AccessRequest, AccessStatus
from .chat_message import ChatMessage, ChatRole, MessageType
from .dcc_activity_log import DccActivityLog, DccAction
from .workspace import (
    ProjectTemplate, PhaseTemplate, TaskTemplate,
    WorkspaceProject, WorkspacePhase, WorkspaceTask, TaskCompletion,
    ProjectStatus, PhaseStatus, TaskStatus,
)

__all__ = [
    "Base",
    "TimestampMixin",
    "UUIDMixin",
    "Profile",
    "AppRole",
    "ROLE_LABELS",
    "RolePermission",
    "ALL_PERMISSIONS",
    "PERMISSION_LABELS",
    "DEFAULT_ROLE_PERMISSIONS",
    "Client",
    "Project",
    "Document",
    "DocType",
    "DocStatus",
    "DOC_TYPE_LABELS",
    "UploadQueue",
    "UploadStatus",
    "Approval",
    "ApprovalAction",
    "AccessRequest",
    "AccessStatus",
    "ChatMessage",
    "ChatRole",
    "MessageType",
    "DccActivityLog",
    "DccAction",
    "ProjectTemplate",
    "PhaseTemplate",
    "TaskTemplate",
    "WorkspaceProject",
    "WorkspacePhase",
    "WorkspaceTask",
    "TaskCompletion",
    "ProjectStatus",
    "PhaseStatus",
    "TaskStatus",
]