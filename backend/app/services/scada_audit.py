"""Audit logging for R-Net config changes (W8).

One append-only `scada_audit_log` row per create/update/delete of a tag, site,
stream, alarm setting, or global R-Net setting. Mirrors the Digital Library's
`_write_log`, but records a FIELD-LEVEL diff (old → new).

SECRETS NEVER LEAVE: broker passwords and stream read credentials are listed in
`SENSITIVE` and recorded only as `{"changed": true}`.

Usage in a router (the entry commits atomically with the change via get_db):

    before = tag_snapshot(tag)
    ...apply patch...
    changes = diff_fields(before, tag_snapshot(tag), sensitive=SENSITIVE)
    if changes:
        log_scada_change(db, profile, LOG_UPDATE, TARGET_TAG,
                         target_id=tag.id, target_label=tag.label, changes=changes)
"""

from __future__ import annotations

import uuid
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from db.models.profile import Profile
from db.models.scada_audit_log import ScadaAuditLog

# Fields whose VALUES must never be written to the audit log — only the fact
# that they changed. Names match the snapshot keys below.
SENSITIVE: set[str] = {"mqtt_password", "read_pass", "secret"}


def _actor_name(actor: Profile | None) -> str | None:
    if actor is None:
        return None
    return actor.full_name or actor.username


def diff_fields(
    before: dict[str, Any],
    after: dict[str, Any],
    *,
    sensitive: set[str] | None = None,
) -> dict[str, Any]:
    """Field-level diff. Only keys that actually changed are returned. Keys in
    `sensitive` record `{"changed": True}` instead of their old/new values.

    Works for create (before={}) and delete (after={}) too — unchanged keys
    (e.g. a field that was None and stays absent) are dropped as noise."""
    sensitive = sensitive or SENSITIVE
    changes: dict[str, Any] = {}
    for key in before.keys() | after.keys():
        old = before.get(key)
        new = after.get(key)
        if old == new:
            continue
        if key in sensitive:
            changes[key] = {"changed": True}
        else:
            changes[key] = {"old": old, "new": new}
    return changes


def log_scada_change(
    db: AsyncSession,
    actor: Profile | None,
    action: str,
    target_type: str,
    *,
    target_id: uuid.UUID | None = None,
    target_label: str | None = None,
    changes: dict | None = None,
) -> None:
    """Queue one audit entry on the session (no flush/commit here — it lands
    with the request's own commit, so a rolled-back change leaves no log)."""
    db.add(
        ScadaAuditLog(
            actor_id=actor.id if actor else None,
            actor_name=_actor_name(actor),
            action=action,
            target_type=target_type,
            target_id=target_id,
            target_label=target_label,
            changes=changes or None,
        )
    )


# --------------------------------------------------------------------------- #
# Snapshots — flat {field: value} views of each auditable object. Config keys
# are flattened as "config.<key>" so a diff pinpoints the exact knob.
# --------------------------------------------------------------------------- #

# Per-tag config knobs worth auditing: calibration, sampling, storage, and the
# alarm thresholds (which live in config, not a dedicated table).
_TAG_CONFIG_KEYS = (
    "scale",
    "offset",
    "decimals",
    "sampling_level",
    "store_enabled",
    "storage_interval_s",
    "alarm_min",
    "alarm_max",
    "mqtt_topic",
)


def tag_snapshot(tag) -> dict[str, Any]:
    cfg = tag.config or {}
    snap: dict[str, Any] = {
        "enabled": tag.enabled,
        "label": tag.label,
        "unit": tag.unit,
        "source": tag.source,
        "site_id": str(tag.site_id) if tag.site_id else None,
    }
    for key in _TAG_CONFIG_KEYS:
        if key in cfg:
            snap[f"config.{key}"] = cfg[key]
    return snap


def site_snapshot(site) -> dict[str, Any]:
    return {
        "name": site.name,
        "enabled": site.enabled,
        "mqtt_host": site.mqtt_host,
        "mqtt_port": site.mqtt_port,
        "mqtt_username": site.mqtt_username,
        "base_topic": site.base_topic,
        "mqtt_password": site.mqtt_password,  # SENSITIVE → redacted by diff
    }


def stream_snapshot(stream) -> dict[str, Any]:
    return {
        "name": stream.name,
        "source_type": stream.source_type,
        "hls_url": stream.hls_url,
        "webrtc_url": stream.webrtc_url,
        "read_user": stream.read_user,
        "read_pass": stream.read_pass,  # SENSITIVE → redacted by diff
        "url": stream.url,
        "secret": stream.secret,  # SENSITIVE → redacted by diff
        "enabled": stream.enabled,
    }


_ALARM_SETTINGS_FIELDS = (
    "email_enabled",
    "email_recipients",
    "telegram_enabled",
    "telegram_chat_id",
    "cooldown_min",
    "sound_enabled",
)


def alarm_settings_snapshot(row) -> dict[str, Any]:
    return {f: getattr(row, f) for f in _ALARM_SETTINGS_FIELDS}


_RNET_SETTINGS_FIELDS = (
    "level_fastest_s",
    "level_fast_s",
    "level_slow_s",
    "level_slowest_s",
    "ring_window_h",
    "store_months",
    "reset_warn_days",
)


def rnet_settings_snapshot(row) -> dict[str, Any]:
    return {f: getattr(row, f) for f in _RNET_SETTINGS_FIELDS}
