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
from .library_folder import LibraryFolder, FolderType, DEPT_ROLE_MAP, DEPT_LABELS, LIBRARIAN_ROLES
from .library_file import LibraryFile, LibraryFileStatus
from .audit_job import AuditJob, AuditJobStatus, LAYER_NAMES, LAYER_LABELS
from .view_request import ViewRequest, ViewRequestStatus, VIEW_REQUEST_TTL_SECONDS
from .library_audit_log import LibraryAuditLog
from .scada_audit_log import (
    ScadaAuditLog,
    LOG_CREATE,
    LOG_UPDATE,
    LOG_DELETE,
    TARGET_TAG,
    TARGET_SITE,
    TARGET_STREAM,
    TARGET_ALARM_SETTINGS,
    TARGET_SETTINGS,
)
from .scada_data_access_log import (
    ScadaDataAccessLog,
    ACCESS_RECENT,
    ACCESS_SAMPLES,
    ACCESS_HISTORY,
)
from .document_sequence import DocumentSequence, KNOWN_DOC_TYPES, DOC_TYPE_LABELS
from .folder_permission import FolderPermission
from .scada import (
    ScadaStream,
    ScadaPerspective,
    ScadaSite,
    ScadaSheet,
    ScadaTag,
    ScadaRaw,
    ScadaRollup1m,
    ScadaSample,
    ScadaSampleAll,
    ScadaTagLatest,
    ScadaAlarmEvent,
    ScadaBridgeStatus,
    ScadaAlarmSettings,
    ScadaSettings,
    ScadaTagArchive,
    ScadaArchive,
    ScadaWorkbenchColumn,
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
    "LibraryFolder",
    "FolderType",
    "DEPT_ROLE_MAP",
    "DEPT_LABELS",
    "LIBRARIAN_ROLES",
    "LibraryFile",
    "LibraryFileStatus",
    "AuditJob",
    "AuditJobStatus",
    "LAYER_NAMES",
    "LAYER_LABELS",
    "ViewRequest",
    "ViewRequestStatus",
    "VIEW_REQUEST_TTL_SECONDS",
    "LibraryAuditLog",
    "ScadaAuditLog",
    "LOG_CREATE",
    "LOG_UPDATE",
    "LOG_DELETE",
    "TARGET_TAG",
    "TARGET_SITE",
    "TARGET_STREAM",
    "TARGET_ALARM_SETTINGS",
    "TARGET_SETTINGS",
    "ScadaDataAccessLog",
    "ACCESS_RECENT",
    "ACCESS_SAMPLES",
    "ACCESS_HISTORY",
    "DocumentSequence",
    "KNOWN_DOC_TYPES",
    "DOC_TYPE_LABELS",
    "FolderPermission",
    "ScadaStream",
    "ScadaPerspective",
    "ScadaSite",
    "ScadaSheet",
    "ScadaTag",
    "ScadaRaw",
    "ScadaRollup1m",
    "ScadaSample",
    "ScadaSampleAll",
    "ScadaTagLatest",
    "ScadaAlarmEvent",
    "ScadaBridgeStatus",
    "ScadaAlarmSettings",
    "ScadaSettings",
    "ScadaTagArchive",
    "ScadaArchive",
    "ScadaWorkbenchColumn",
]