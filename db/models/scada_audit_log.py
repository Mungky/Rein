"""R-Net (SCADA) audit log — who changed calibration / broker / stream / alarm.

R-Net had no trail at all: nothing recorded who retuned a tag's scale/offset,
repointed a site's broker, deleted a stream, or flipped an alarm on/off. This
mirrors `library_audit_log` (append-only, admin-visible) but records
field-level before/after in `changes`.

SENSITIVE FIELDS ARE NEVER STORED. Broker passwords (`mqtt_password`) and
stream read credentials (`read_pass`/`secret`) record only `{"changed": true}`
— the audit proves THAT a secret was touched without leaking WHAT it became.
"""

import uuid

from sqlalchemy import BigInteger, ForeignKey, Index, String
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base, TimestampMixin

# Actions
LOG_CREATE = "create"
LOG_UPDATE = "update"
LOG_DELETE = "delete"

# Target types
TARGET_TAG = "tag"
TARGET_SITE = "site"
TARGET_STREAM = "stream"
TARGET_ALARM_SETTINGS = "alarm_settings"
TARGET_SETTINGS = "settings"


class ScadaAuditLog(TimestampMixin, Base):
    __tablename__ = "scada_audit_log"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    actor_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("profiles.id"), nullable=True
    )
    # Snapshot of the actor's display name — the trail stays readable after the
    # profile is deleted (same reason ScadaAlarmEvent snapshots ack_name).
    actor_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    action: Mapped[str] = mapped_column(String(20), nullable=False)
    target_type: Mapped[str] = mapped_column(String(30), nullable=False)
    target_id: Mapped[uuid.UUID | None] = mapped_column(nullable=True)
    # Human label of the target at change time (tag label, site/stream name) so
    # a deleted object is still identifiable in the log.
    target_label: Mapped[str | None] = mapped_column(String(255), nullable=True)
    # Field-level diff: {field: {"old": ..., "new": ...}}. Sensitive fields
    # record {"changed": true} instead. On create every field is a {"new": ...}
    # (old None); on delete every field is an {"old": ...} (new None).
    changes: Mapped[dict | None] = mapped_column(JSONB, nullable=True)

    __table_args__ = (
        Index("idx_scada_audit_log_actor_id", "actor_id"),
        Index("idx_scada_audit_log_target", "target_type", "target_id"),
        Index("idx_scada_audit_log_created_at", "created_at"),
    )
