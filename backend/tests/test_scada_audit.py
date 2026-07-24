"""R-Net audit log (W8) — the pure logging logic.

Everything that can be verified without a database: the field-level diff, the
per-entity snapshots, and — most importantly — that SENSITIVE values (broker
password, stream read credentials) are recorded as "changed only", never with
their actual value. The DB-bound part (rows land on commit, RLS deny-all) is
the same owner-connection pattern already covered for the other tables.
"""

import uuid
from types import SimpleNamespace

from app.services import scada_audit
from db.models.scada_audit_log import (
    LOG_CREATE,
    LOG_DELETE,
    LOG_UPDATE,
    TARGET_TAG,
)


class _FakeSession:
    """Records what the router would db.add() — no real database."""

    def __init__(self):
        self.added = []

    def add(self, obj):
        self.added.append(obj)


def _actor(name="Budi", username="budi"):
    return SimpleNamespace(id=uuid.uuid4(), full_name=name, username=username)


# --------------------------------------------------------------------------- #
# diff_fields
# --------------------------------------------------------------------------- #


def test_diff_reports_only_changed_keys():
    changes = scada_audit.diff_fields(
        {"a": 1, "b": 2, "c": 3}, {"a": 1, "b": 20, "c": 3}
    )
    assert changes == {"b": {"old": 2, "new": 20}}


def test_diff_create_uses_empty_before():
    changes = scada_audit.diff_fields({}, {"enabled": True, "label": "Suhu"})
    assert changes == {
        "enabled": {"old": None, "new": True},
        "label": {"old": None, "new": "Suhu"},
    }


def test_diff_delete_uses_empty_after():
    changes = scada_audit.diff_fields({"label": "Suhu"}, {})
    assert changes == {"label": {"old": "Suhu", "new": None}}


def test_diff_drops_none_to_absent_noise():
    # A field that was None and is simply absent afterwards is not a change.
    changes = scada_audit.diff_fields({"mqtt_username": None}, {})
    assert changes == {}


def test_sensitive_value_never_recorded():
    changes = scada_audit.diff_fields(
        {"read_pass": "old-secret"}, {"read_pass": "new-secret"}
    )
    assert changes == {"read_pass": {"changed": True}}
    # The literal secret must appear nowhere in the serialized diff.
    assert "old-secret" not in str(changes)
    assert "new-secret" not in str(changes)


def test_all_sensitive_fields_redacted():
    for field in ("mqtt_password", "read_pass", "secret"):
        changes = scada_audit.diff_fields({field: "x"}, {field: "y"})
        assert changes == {field: {"changed": True}}


# --------------------------------------------------------------------------- #
# Snapshots
# --------------------------------------------------------------------------- #


_FIXED_SITE = uuid.uuid4()


def _tag(**cfg):
    return SimpleNamespace(
        enabled=True,
        label="Boiler 1 Suhu",
        unit="°C",
        source="mqtt",
        site_id=_FIXED_SITE,
        config=cfg,
    )


def test_tag_snapshot_flattens_calibration_and_thresholds():
    tag = _tag(scale=0.1, offset=-5, sampling_level="fast", alarm_max=90)
    snap = scada_audit.tag_snapshot(tag)
    assert snap["config.scale"] == 0.1
    assert snap["config.offset"] == -5
    assert snap["config.sampling_level"] == "fast"
    assert snap["config.alarm_max"] == 90
    assert snap["enabled"] is True
    # Absent config keys are not invented.
    assert "config.alarm_min" not in snap


def test_tag_calibration_change_records_old_and_new():
    before = scada_audit.tag_snapshot(_tag(scale=1.0, offset=0))
    after = scada_audit.tag_snapshot(_tag(scale=0.1, offset=0))
    changes = scada_audit.diff_fields(before, after)
    assert changes == {"config.scale": {"old": 1.0, "new": 0.1}}


def test_site_snapshot_broker_change_and_password_redacted():
    def _site(host, pw):
        return SimpleNamespace(
            name="Tanobel",
            enabled=True,
            mqtt_host=host,
            mqtt_port=1883,
            mqtt_username="rnet",
            base_topic="rnet/tanobel",
            mqtt_password=pw,
        )

    before = scada_audit.site_snapshot(_site("10.0.0.1", "hunter2"))
    after = scada_audit.site_snapshot(_site("10.0.0.9", "hunter3"))
    changes = scada_audit.diff_fields(before, after)
    assert changes["mqtt_host"] == {"old": "10.0.0.1", "new": "10.0.0.9"}
    assert changes["mqtt_password"] == {"changed": True}
    assert "hunter2" not in str(changes) and "hunter3" not in str(changes)


def test_stream_snapshot_redacts_read_pass_and_secret():
    def _stream(rp, sec):
        return SimpleNamespace(
            name="CCTV Pompa",
            source_type="stream",
            hls_url="https://x/index.m3u8",
            webrtc_url=None,
            read_user="viewer",
            read_pass=rp,
            url=None,
            secret=sec,
            enabled=True,
        )

    before = scada_audit.stream_snapshot(_stream("a", "b"))
    after = scada_audit.stream_snapshot(_stream("c", "d"))
    changes = scada_audit.diff_fields(before, after)
    assert changes == {
        "read_pass": {"changed": True},
        "secret": {"changed": True},
    }


# --------------------------------------------------------------------------- #
# log_scada_change wiring
# --------------------------------------------------------------------------- #


def test_log_scada_change_builds_entry():
    db = _FakeSession()
    actor = _actor()
    tid = uuid.uuid4()
    scada_audit.log_scada_change(
        db, actor, LOG_UPDATE, TARGET_TAG,
        target_id=tid, target_label="Boiler 1",
        changes={"config.scale": {"old": 1, "new": 2}},
    )
    assert len(db.added) == 1
    entry = db.added[0]
    assert entry.actor_id == actor.id
    assert entry.actor_name == "Budi"  # full_name snapshot
    assert entry.action == LOG_UPDATE
    assert entry.target_type == TARGET_TAG
    assert entry.target_id == tid
    assert entry.target_label == "Boiler 1"
    assert entry.changes == {"config.scale": {"old": 1, "new": 2}}


def test_log_actor_name_falls_back_to_username():
    db = _FakeSession()
    actor = SimpleNamespace(id=uuid.uuid4(), full_name=None, username="operator1")
    scada_audit.log_scada_change(db, actor, LOG_CREATE, TARGET_TAG)
    assert db.added[0].actor_name == "operator1"


def test_log_empty_changes_stored_as_null():
    db = _FakeSession()
    scada_audit.log_scada_change(db, _actor(), LOG_DELETE, TARGET_TAG, changes={})
    # {} → None so the column reads NULL rather than an empty object.
    assert db.added[0].changes is None
