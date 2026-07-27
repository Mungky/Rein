#!/usr/bin/env python3
"""R-Net MQTT bridge — field sensor data → Supabase historian.

WHAT IT DOES
    V-Boxes (or any device) publish sensor values to an MQTT broker. This
    bridge subscribes to the topics configured in the R-Net UI, keeps the
    latest value per tag, and writes rows into the two historian lanes the
    R-Net dashboards read through the `scada_samples_all` view:
      - ring tags ("Simpan data" OFF) → `scada_raw` (24h buffer, partitioned
        by day; retention is the BACKEND's job — it drops whole day partitions,
        this script never deletes anything)
      - store tags ("Simpan data" ON)  → `scada_samples` (monthly archive+reset)
    Both sample at the tag's chosen sampling level (fastest/fast/slow/slowest,
    seconds set by admin in scada_settings). No second database — the
    charts/gauges/Analisis light up with real data automatically.

CONFIG LIVES IN THE DATABASE, NOT HERE
    Sites (brokers) and tags (topics) are managed entirely from the R-Net
    frontend ("Kelola Site" + the Sumber cell in Analisis). This script needs
    DATABASE_URL, plus SITE_ID once there is more than one plant. It re-reads
    the config every CONFIG_REFRESH_S, so adding a topic in the UI makes the
    bridge subscribe within ~30s — no restart.

WHICH PLANT AM I? (SITE_ID)
    SITE_ID is a comma-separated list of scada_sites UUIDs this PC owns. Leave
    it empty and the bridge handles EVERY enabled site — fine for one plant,
    actively harmful for a fleet: each PC would open every plant's broker
    connection, write every plant's rows, and hold every plant's broker
    credentials. Set it per field PC (audit D-4).

RESOLUTION — TWO LANES
    Live lane: every LATEST_FLUSH_S (~1 s) the newest value per tag is UPSERTed
    into `scada_tag_latest` (one row per tag). That row feeds the browsers'
    live numbers (Supabase Realtime) and the backend alarm engine — no history
    rows are created by this lane, however fast a device publishes.

    History lane: each tag samples at its `sampling_level` interval (seconds
    from scada_settings). MQTT is push (messages arrive any time), but we store
    one row per tag per interval bucket: the latest value received in a bucket
    is written when the bucket boundary passes, stamped at that boundary (PK
    tag_id+ts, ON CONFLICT DO NOTHING), into scada_ring or scada_samples per the
    tag's store flag. A tag that sends nothing in a bucket produces a gap —
    exactly what a real sampled historian should show (the UI flags stale data).

RESILIENCE (never crash the box)
    - Broker down / drops     → paho auto-reconnects; on reconnect we
                                re-subscribe.
    - Database down           → the flush is retried next minute; buffered
                                values are kept (in memory AND on disk).
    - Process killed / PC     → each received value is written to a local SQLite
      restart                   buffer (bridge_buffer.db) before it hits memory,
                                and replayed to Supabase on the next start, so a
                                crash mid-bucket no longer punches a hole in the
                                history (W3 store-and-forward).
    - Malformed payload       → logged and skipped.
    - Any unexpected error    → logged; the loop keeps running.

PAYLOAD FORMAT (from the device)
    Topic:   whatever you set in the tag's "topic" field, e.g.
             rnet/tanobel/boiler1/temperature
    Payload: {"value": 72.5, "ts": "2026-07-07T10:00:00Z"}   (ts optional)
             A bare number ("72.5") is also accepted.

RUN
    Local test (Windows):  start-bridge.bat
    Server (Linux):        systemd unit rnet-mqtt-bridge.service
    Manual:                DATABASE_URL=... python bridge.py
"""

from __future__ import annotations

import json
import logging
import os
import signal
import sqlite3
import threading
import time
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone

try:
    import psycopg
except ImportError:  # pragma: no cover - guidance only
    raise SystemExit(
        "Modul 'psycopg' belum terpasang. Jalankan: pip install -r requirements.txt"
    )

try:
    import paho.mqtt.client as mqtt
except ImportError:  # pragma: no cover - guidance only
    raise SystemExit(
        "Modul 'paho-mqtt' belum terpasang. Jalankan: pip install -r requirements.txt"
    )


# --------------------------------------------------------------------------- #
# Settings (only DATABASE_URL is required; the rest have sane defaults)
# --------------------------------------------------------------------------- #

DATABASE_URL = os.getenv("DATABASE_URL", "").strip()
FLUSH_INTERVAL_S = int(os.getenv("FLUSH_INTERVAL_S", "60"))
CONFIG_REFRESH_S = int(os.getenv("CONFIG_REFRESH_S", "30"))
MQTT_KEEPALIVE_S = int(os.getenv("MQTT_KEEPALIVE_S", "60"))
# Live lane: how often the newest value per tag is UPSERTed into
# scada_tag_latest. LATEST_ENABLED=0 is the rollback switch (e.g. running this
# bridge against a DB that predates the scada_tag_latest migration).
LATEST_FLUSH_S = float(os.getenv("LATEST_FLUSH_S", "1.0"))
LATEST_ENABLED = os.getenv("LATEST_ENABLED", "1") not in ("0", "false", "False")
LOG_LEVEL = os.getenv("LOG_LEVEL", "INFO").upper()

# Fastest storage interval a tag may configure (seconds) — floor for the
# "Fastest" sampling level.
MIN_INTERVAL_S = 2

# Sampling-level → seconds defaults, used until the scada_settings row is read
# (admin can retune them). A tag stores config.sampling_level ∈ these keys.
DEFAULT_LEVELS = {"fastest": 2, "fast": 5, "slow": 30, "slowest": 60}
DEFAULT_LEVEL = "fast"

# Ring mode ("simpan data" NOT ticked): like a CCTV SD card kept by TIME — ring
# rows go to scada_ring and are pruned to the last `ring_window_h` hours (24h
# default). Store tags go to scada_samples and are archived+reset monthly.
DEFAULT_RING_WINDOW_H = 24
PRUNE_EVERY_S = int(os.getenv("PRUNE_EVERY_S", "60"))
# Ring retention moved to the backend (audit D-3) — see Bridge.prune_ring.
# Default OFF here; set PRUNE_ENABLED=1 only to break the glass against a
# backend that predates backend/app/services/ring_pruner.py.
PRUNE_ENABLED = os.getenv("PRUNE_ENABLED", "0") not in ("0", "false", "False")

# Which sites (brokers) THIS PC is responsible for — comma-separated site UUIDs
# (audit D-4). Empty = every enabled site, the old behaviour, which is correct
# for a single-plant install and wrong for a fleet: without it each field PC
# connects to EVERY plant's broker and writes EVERY plant's rows, so both broker
# connections and DB writes multiply by the number of plants — and each plant's
# PC holds every other plant's broker credentials. Set SITE_ID in config.env on
# every multi-plant install.
SITE_IDS = tuple(
    s.strip() for s in os.getenv("SITE_ID", "").split(",") if s.strip()
)

# Health lane: seberapa sering status koneksi tiap site di-UPSERT ke
# scada_bridge_status (detak jantung). Health monitor backend menganggap
# bridge mati bila baris ini basi > 2 menit — jadi jangan set di atas itu.
HEARTBEAT_S = int(os.getenv("HEARTBEAT_S", "15"))

# Store-and-forward berbasis disk (W3). Nilai history yang diterima tapi belum
# sempat di-flush ke Supabase (menunggu batas bucket, atau Supabase sedang down)
# hanya ada di memori — hilang kalau proses mati / PC restart, bikin lubang di
# riwayat. Buffer SQLite lokal ini menyimpannya ke disk: ditulis saat pesan
# masuk, dihapus setelah baris-nya benar-benar tersimpan di Supabase, dan
# diputar ulang saat start (recovery). Murni lapisan persistensi — tidak
# mengubah cara/skema penyimpanan ke Supabase.
BUFFER_ENABLED = os.getenv("BRIDGE_BUFFER_ENABLED", "1") not in ("0", "false", "False")
BUFFER_DB_PATH = os.getenv(
    "BRIDGE_BUFFER_DB",
    os.path.join(os.path.dirname(os.path.abspath(__file__)), "bridge_buffer.db"),
)

logging.basicConfig(
    level=getattr(logging, LOG_LEVEL, logging.INFO),
    format="%(asctime)s %(levelname)s %(message)s",
)
log = logging.getLogger("rnet-bridge")

# Sentry (M4) — OPSIONAL: aktif hanya bila SENTRY_DSN diisi di config.env DAN
# sentry-sdk terpasang. Bridge didesain "never crash" (semua error ditangkap
# dan dicatat log), jadi integrasi logging Sentry-lah yang bekerja: setiap
# log.error/exception otomatis jadi event. Tanpa DSN/paket, bridge jalan
# persis seperti sebelumnya.
SENTRY_DSN = os.getenv("SENTRY_DSN", "").strip()
if SENTRY_DSN:
    try:
        import sentry_sdk

        sentry_sdk.init(
            dsn=SENTRY_DSN,
            environment=os.getenv("SENTRY_ENVIRONMENT", "bridge"),
            traces_sample_rate=0.0,
            send_default_pii=False,
        )
        log.info("Sentry aktif untuk bridge")
    except ImportError:
        log.warning(
            "SENTRY_DSN diset tapi sentry-sdk belum terpasang — "
            "jalankan: pip install sentry-sdk"
        )


# --------------------------------------------------------------------------- #
# Config snapshots read from the DB
# --------------------------------------------------------------------------- #


@dataclass
class SiteCfg:
    site_id: str
    host: str
    port: int
    username: str | None
    password: str | None
    # topic -> tag_id for every enabled MQTT tag on this site
    topics: dict[str, str] = field(default_factory=dict)


def _parse_interval(config: dict | None, levels: dict[str, int]) -> tuple[int, bool]:
    """Per-tag storage plan from config: returns (interval_s, is_ring).

    Both lanes sample at the tag's chosen `sampling_level` (fastest/fast/slow/
    slowest → seconds from the admin-tunable scada_settings). `store_enabled`
    only decides WHICH table + retention: off → ring (scada_ring, 24h window),
    on → historian (scada_samples, monthly archive+reset)."""
    cfg = config or {}
    level = cfg.get("sampling_level") or DEFAULT_LEVEL
    seconds = levels.get(level, levels.get(DEFAULT_LEVEL, DEFAULT_LEVELS[DEFAULT_LEVEL]))
    try:
        seconds = max(MIN_INTERVAL_S, int(seconds))
    except (TypeError, ValueError):
        seconds = DEFAULT_LEVELS[DEFAULT_LEVEL]
    return seconds, not cfg.get("store_enabled")


def _coerce_value(payload: bytes) -> float | None:
    """Accept {"value": <num>} JSON or a bare number; return None if unusable."""
    text = payload.decode("utf-8", errors="replace").strip()
    if not text:
        return None
    try:
        data = json.loads(text)
    except json.JSONDecodeError:
        data = text
    if isinstance(data, dict):
        data = data.get("value")
    try:
        return float(data)
    except (TypeError, ValueError):
        return None


# tag_id -> (scale, offset, decimals|None). Applied to the RAW sensor value
# before it is stored: stored = round(raw * scale + offset, decimals). This is
# the per-tag scaling/tuning set in R-Net (Analisis → Sumber). Defaults are a
# no-op (scale 1, offset 0), so tags without scaling store the raw value.
Transform = tuple[float, float, "int | None"]


def _parse_transform(config: dict | None) -> Transform:
    cfg = config or {}

    def _num(v, default: float) -> float:
        try:
            return float(v)
        except (TypeError, ValueError):
            return default

    scale = _num(cfg.get("scale"), 1.0)
    offset = _num(cfg.get("offset"), 0.0)
    dec_raw = cfg.get("decimals")
    try:
        decimals = (
            int(dec_raw) if dec_raw is not None and str(dec_raw).strip() != "" else None
        )
    except (TypeError, ValueError):
        decimals = None
    return scale, offset, decimals


def _apply_transform(raw: float, xform: Transform) -> float:
    scale, offset, decimals = xform
    value = raw * scale + offset
    return round(value, decimals) if decimals is not None else value


# --------------------------------------------------------------------------- #
# Bridge
# --------------------------------------------------------------------------- #


class Bridge:
    def __init__(self, dsn: str, buffer_path: str | None = None) -> None:
        self.dsn = dsn
        # Random per-process suffix for MQTT client ids (see _make_client)
        self._instance_id = uuid.uuid4().hex[:6]
        self._lock = threading.Lock()
        # History lane: latest value received in the current bucket per tag.
        # Cleared on every successful store so dead sensors produce gaps, not
        # fake data.
        self._pending: dict[str, float] = {}
        # Live lane: newest (ts, value) per tag since the last latest-flush.
        self._latest_pending: dict[str, tuple[datetime, float]] = {}
        # tag_id -> storage interval in seconds (resolved from sampling_level)
        self._interval: dict[str, int] = {}
        # tag_ids in ring mode (store_enabled off) — written to scada_ring
        self._ring: set[str] = set()
        # tag_id -> site_id, so every raw row can carry its plant (audit D-1).
        self._site_of: dict[str, str] = {}
        # sampling-level durations + ring window, read from scada_settings
        self._levels: dict[str, int] = dict(DEFAULT_LEVELS)
        self._ring_window_h: int = DEFAULT_RING_WINDOW_H
        # tag_id -> last bucket index a sample was stored for (or the bucket a
        # first pending value was "armed" in) — see flush()
        self._bucket: dict[str, int] = {}
        # site_id -> live paho client
        self._clients: dict[str, mqtt.Client] = {}
        # site_id -> topic -> tag_id (the desired subscription set)
        self._routes: dict[str, dict[str, str]] = {}
        # tag_id -> (scale, offset, decimals) applied to the raw value on ingest
        self._xform: dict[str, Transform] = {}
        self._conn: psycopg.Connection | None = None
        self._stop = threading.Event()
        # Heartbeat pernah gagal? (tabel belum ada di DB pra-migrasi) —
        # supaya log tidak banjir warning tiap HEARTBEAT_S.
        self._hb_warned = False
        # Disk store-and-forward buffer (W3). Separate lock: the SQLite write in
        # _on_message must not block flush()/flush_latest() waiting on self._lock.
        self._buf_path = buffer_path or BUFFER_DB_PATH
        self._buf_lock = threading.Lock()
        self._buf: sqlite3.Connection | None = None
        # tag_id -> ts (datetime) of the value currently persisted in the buffer,
        # so flush() can delete exactly the row it just stored (and never a newer
        # one an incoming message replaced meanwhile).
        self._buf_ts: dict[str, datetime] = {}

    # -- database ---------------------------------------------------------- #

    def _db(self) -> psycopg.Connection:
        if self._conn is None or self._conn.closed:
            # prepare_threshold=None: no server-side prepared statements — required
            # when DATABASE_URL points at Supabase's transaction pooler (port 6543).
            self._conn = psycopg.connect(
                self.dsn, autocommit=True, connect_timeout=10, prepare_threshold=None
            )
        return self._conn

    # -- disk store-and-forward buffer (W3) -------------------------------- #

    def _buffer_db(self) -> sqlite3.Connection:
        """Lazily open the local SQLite buffer. WAL + synchronous=NORMAL: cheap
        writes that survive a process kill (the crash the buffer defends against);
        the one row per tag holds that tag's newest not-yet-persisted value."""
        if self._buf is None:
            conn = sqlite3.connect(self._buf_path, check_same_thread=False, timeout=5)
            conn.execute("PRAGMA journal_mode=WAL")
            conn.execute("PRAGMA synchronous=NORMAL")
            conn.execute(
                "CREATE TABLE IF NOT EXISTS pending_samples ("
                "tag_id TEXT PRIMARY KEY, ts TEXT NOT NULL, value REAL NOT NULL)"
            )
            conn.commit()
            self._buf = conn
        return self._buf

    def _buffer_put(self, tag_id: str, ts: datetime, value: float) -> None:
        """Persist a tag's newest history value to disk BEFORE it lands in
        memory. Never raises — a buffer hiccup must not stop ingest."""
        if not BUFFER_ENABLED:
            return
        try:
            with self._buf_lock:
                db = self._buffer_db()
                db.execute(
                    "INSERT OR REPLACE INTO pending_samples (tag_id, ts, value) "
                    "VALUES (?, ?, ?)",
                    (tag_id, ts.isoformat(), value),
                )
                db.commit()
        except Exception:
            log.exception("Gagal menulis buffer disk (lanjut dari memori)")

    def _buffer_delete_many(self, items: list[tuple[str, str]]) -> None:
        """Drop rows (by (tag_id, ts_iso)) that were confirmed stored in Supabase.
        Matching the exact ts string means a newer value an incoming message
        wrote (different ts) is never removed by mistake."""
        if not BUFFER_ENABLED or not items:
            return
        try:
            with self._buf_lock:
                db = self._buffer_db()
                db.executemany(
                    "DELETE FROM pending_samples WHERE tag_id = ? AND ts = ?",
                    items,
                )
                db.commit()
        except Exception:
            log.exception("Gagal membersihkan buffer disk (akan dicoba lagi)")

    def _buffer_all(self) -> list[tuple[str, str, float]]:
        if not BUFFER_ENABLED:
            return []
        try:
            with self._buf_lock:
                db = self._buffer_db()
                return db.execute(
                    "SELECT tag_id, ts, value FROM pending_samples"
                ).fetchall()
        except Exception:
            log.exception("Gagal membaca buffer disk")
            return []

    def recover_buffer(self) -> None:
        """On start (after reconcile, so intervals + ring set are known): replay
        every buffered value left by a previous crash/restart into the historian,
        stamped at its interval bucket and routed to scada_ring / scada_samples
        like a normal flush. ON CONFLICT DO NOTHING makes replay idempotent.
        Rows that fail (e.g. Supabase still down) stay for the next start."""
        rows = self._buffer_all()
        if not rows:
            return
        recovered = 0
        done: list[tuple[str, str]] = []  # (tag_id, ts_iso) rows safe to remove
        for tag_id, ts_iso, value in rows:
            try:
                dt = datetime.fromisoformat(ts_iso)
            except ValueError:
                done.append((tag_id, ts_iso))  # unparseable → drop, can't replay
                continue
            interval = self._interval.get(tag_id, FLUSH_INTERVAL_S)
            boundary = int(dt.timestamp() // interval) * interval
            bts = datetime.fromtimestamp(boundary, tz=timezone.utc)
            is_ring = tag_id in self._ring
            try:
                with self._db().cursor() as cur:
                    if is_ring:
                        cur.execute(
                            "INSERT INTO scada_raw (tag_id, ts, site_id, value) "
                            "VALUES (%s, %s, %s, %s) ON CONFLICT DO NOTHING",
                            (tag_id, bts, self._site_of.get(tag_id), value),
                        )
                    else:
                        cur.execute(
                            "INSERT INTO scada_samples (tag_id, ts, value) "
                            "VALUES (%s, %s, %s) ON CONFLICT DO NOTHING",
                            (tag_id, bts, value),
                        )
                recovered += 1
                done.append((tag_id, ts_iso))
            except Exception:
                # DB still unreachable / tag removed → leave in buffer, retry later
                log.exception("Recovery: gagal mengirim 1 nilai (tag %s)", tag_id)
        self._buffer_delete_many(done)
        if recovered:
            log.info("Recovery: %d nilai dari buffer disk terkirim ke database", recovered)

    def load_config(
        self,
    ) -> tuple[
        dict[str, SiteCfg], dict[str, Transform], dict[str, int], set[str],
        dict[str, str],
    ]:
        """Read enabled sites + their enabled MQTT tags from the DB.

        Returns the sites (with their topic→tag_id subscriptions), a
        tag_id→transform map used to scale each raw value before storing, a
        tag_id→storage-interval map (seconds), the set of ring-mode tags, and a
        tag_id→site_id map (stamped onto every scada_raw row).
        """
        sites: dict[str, SiteCfg] = {}
        xform: dict[str, Transform] = {}
        interval: dict[str, int] = {}
        ring: set[str] = set()
        site_of: dict[str, str] = {}
        with self._db().cursor() as cur:
            # Admin-tunable sampling-level durations + ring window (single row).
            try:
                cur.execute(
                    "SELECT level_fastest_s, level_fast_s, level_slow_s, "
                    "level_slowest_s, ring_window_h FROM scada_settings WHERE id = 1"
                )
                srow = cur.fetchone()
                if srow:
                    self._levels = {
                        "fastest": int(srow[0]),
                        "fast": int(srow[1]),
                        "slow": int(srow[2]),
                        "slowest": int(srow[3]),
                    }
                    self._ring_window_h = int(srow[4])
            except Exception:
                # Table missing (pre-migration DB) → keep defaults, don't crash.
                log.warning("scada_settings tidak terbaca, memakai default level")

            # SITE_ID scopes this PC to its own broker(s) (audit D-4). The
            # filter is applied in SQL, so an unscoped plant's credentials are
            # never even fetched to this machine.
            if SITE_IDS:
                cur.execute(
                    "SELECT id, mqtt_host, mqtt_port, mqtt_username, mqtt_password "
                    "FROM scada_sites WHERE enabled = true AND id = ANY(%s::uuid[])",
                    (list(SITE_IDS),),
                )
            else:
                cur.execute(
                    "SELECT id, mqtt_host, mqtt_port, mqtt_username, mqtt_password "
                    "FROM scada_sites WHERE enabled = true"
                )
            for sid, host, port, user, pw in cur.fetchall():
                sites[str(sid)] = SiteCfg(str(sid), host, int(port), user, pw)

            # Tags of other sites are dropped by the `sites.get(...) is None`
            # guard below, so this query needs no extra filter.
            cur.execute(
                "SELECT id, site_id, config FROM scada_tags "
                "WHERE source = 'mqtt' AND enabled = true AND site_id IS NOT NULL"
            )
            for tag_id, site_id, config in cur.fetchall():
                site = sites.get(str(site_id))
                if site is None:
                    continue  # tag points at a disabled/removed site
                topic = (config or {}).get("mqtt_topic")
                if isinstance(topic, str) and topic.strip():
                    site.topics[topic.strip()] = str(tag_id)
                    site_of[str(tag_id)] = str(site_id)
                    xform[str(tag_id)] = _parse_transform(config)
                    interval[str(tag_id)], is_ring = _parse_interval(config, self._levels)
                    if is_ring:
                        ring.add(str(tag_id))
        return sites, xform, interval, ring, site_of

    # -- mqtt callbacks (paho v2 signatures) ------------------------------- #

    def _on_connect(self, client, userdata, flags, reason_code, properties=None):
        site_id = userdata
        if reason_code != 0:
            log.warning("Site %s: gagal konek ke broker (rc=%s)", site_id, reason_code)
            return
        topics = list(self._routes.get(site_id, {}).keys())
        for topic in topics:
            client.subscribe(topic, qos=0)
        log.info("Site %s: terhubung, subscribe %d topik", site_id, len(topics))

    def _on_disconnect(self, client, userdata, *args):
        # paho reconnects automatically (loop + reconnect_delay_set); just note it
        log.warning("Site %s: broker terputus, mencoba menyambung ulang…", userdata)

    def _on_message(self, client, userdata, msg):
        site_id = userdata
        tag_id = self._routes.get(site_id, {}).get(msg.topic)
        if tag_id is None:
            return  # not a topic we care about
        raw = _coerce_value(msg.payload)
        if raw is None:
            log.debug("Site %s topik %s: payload tidak valid, dilewati", site_id, msg.topic)
            return
        # Scale/tune the raw sensor value before storing (config set in R-Net).
        value = _apply_transform(raw, self._xform.get(tag_id, (1.0, 0.0, None)))
        now = datetime.now(timezone.utc)
        # Persist to disk FIRST: if the box dies before flush() reaches the next
        # bucket boundary, this value survives and is replayed on restart.
        self._buffer_put(tag_id, now, value)
        with self._lock:
            self._pending[tag_id] = value
            self._latest_pending[tag_id] = (now, value)
            self._buf_ts[tag_id] = now

    # -- client lifecycle -------------------------------------------------- #

    def _make_client(self, site: SiteCfg) -> mqtt.Client:
        # Client id carries a per-PROCESS random suffix. With a fixed id, two
        # bridge instances (e.g. a forgotten old window + a fresh one) make the
        # broker kick each other every second — an endless connect/disconnect
        # ping-pong with data gaps. With unique ids both simply coexist:
        # duplicate history inserts dedup on the PK (ON CONFLICT DO NOTHING).
        client = mqtt.Client(
            mqtt.CallbackAPIVersion.VERSION2,
            client_id=f"rnet-bridge-{site.site_id[:8]}-{self._instance_id}",
            userdata=site.site_id,
        )
        if site.username:
            client.username_pw_set(site.username, site.password or None)
        if site.port == 8883:
            # Port standar MQTT-TLS → broker VPS memakai sertifikat Let's
            # Encrypt; verifikasi lewat CA bawaan OS (tanpa file CA khusus).
            # Port lain (1883 dsb.) tetap plaintext — broker uji lokal.
            client.tls_set()
        client.reconnect_delay_set(min_delay=1, max_delay=60)
        client.on_connect = self._on_connect
        client.on_disconnect = self._on_disconnect
        client.on_message = self._on_message
        return client

    def reconcile(self) -> None:
        """Re-read config and align live MQTT clients + subscriptions to it."""
        try:
            (sites, self._xform, self._interval, self._ring,
             self._site_of) = self.load_config()
        except Exception:
            log.exception("Gagal membaca konfigurasi dari database")
            return

        # Drop clients for sites that disappeared / got disabled
        for site_id in list(self._clients):
            if site_id not in sites:
                log.info("Site %s: dinonaktifkan, memutus koneksi", site_id)
                self._teardown_client(site_id)

        for site_id, site in sites.items():
            new_routes = site.topics
            old_routes = self._routes.get(site_id, {})
            self._routes[site_id] = new_routes

            client = self._clients.get(site_id)
            if client is None:
                # New site → connect
                client = self._make_client(site)
                self._clients[site_id] = client
                try:
                    client.connect_async(site.host, site.port, keepalive=MQTT_KEEPALIVE_S)
                    client.loop_start()
                    log.info("Site %s: memulai koneksi ke %s:%s", site_id, site.host, site.port)
                except Exception:
                    log.exception("Site %s: gagal memulai koneksi", site_id)
                continue

            # Existing site → adjust subscriptions live (on_connect handles the
            # full (re)subscribe after any reconnect)
            if client.is_connected():
                for topic in new_routes.keys() - old_routes.keys():
                    client.subscribe(topic, qos=0)
                for topic in old_routes.keys() - new_routes.keys():
                    client.unsubscribe(topic)

    def _teardown_client(self, site_id: str) -> None:
        client = self._clients.pop(site_id, None)
        self._routes.pop(site_id, None)
        if client is not None:
            try:
                client.loop_stop()
                client.disconnect()
            except Exception:
                pass

    # -- flush ------------------------------------------------------------- #

    def flush(self) -> None:
        """History lane: store buffered values whose interval bucket has passed.

        Called every ~1 s. For each tag holding a pending value, the sample is
        written when wall-clock time crosses the tag's next interval boundary,
        stamped AT that boundary — for 60 s tags this is byte-for-byte the old
        one-row-per-minute behavior. A value that first appears mid-bucket is
        "armed" and stored at the next boundary (so ts never lies about when
        the bucket ended)."""
        now_epoch = time.time()
        rows: list[tuple[str, datetime, float]] = []
        stored: list[str] = []
        # (tag_id, ts_iso) of the buffer rows backing the values we're storing —
        # deleted only after Supabase confirms the write.
        buf_deletes: list[tuple[str, str]] = []
        with self._lock:
            for tag_id, value in self._pending.items():
                interval = self._interval.get(tag_id, FLUSH_INTERVAL_S)
                bucket = int(now_epoch // interval)
                armed = self._bucket.get(tag_id)
                if armed is None:
                    # First value for this tag (or after a restart): wait for
                    # the current bucket to end before storing.
                    self._bucket[tag_id] = bucket
                    continue
                if bucket <= armed:
                    continue  # boundary not crossed yet
                ts = datetime.fromtimestamp(bucket * interval, tz=timezone.utc)
                rows.append((tag_id, ts, value))
                stored.append(tag_id)
            for tag_id in stored:
                self._pending.pop(tag_id, None)
                self._bucket[tag_id] = int(
                    now_epoch // self._interval.get(tag_id, FLUSH_INTERVAL_S)
                )
                buf_ts = self._buf_ts.get(tag_id)
                if buf_ts is not None:
                    buf_deletes.append((tag_id, buf_ts.isoformat()))

        if not rows:
            return
        # Route each row to its lane: ring tags → scada_raw (day-partitioned
        # 24h buffer), store tags → scada_samples (historian).
        #
        # scada_raw replaced scada_ring in phase 5. Rows now also carry their
        # plant (site_id) so "everything for plant X" needs no detour through
        # scada_tags (audit D-1). NOTE: rows must keep arriving in time order —
        # scada_raw's BRIN index on ts depends on it, and out-of-order writes
        # would quietly make that index useless.
        ring_rows = [
            (r[0], r[1], self._site_of.get(r[0]), r[2])
            for r in rows if r[0] in self._ring
        ]
        hist_rows = [r for r in rows if r[0] not in self._ring]
        try:
            with self._db().cursor() as cur:
                if ring_rows:
                    cur.executemany(
                        "INSERT INTO scada_raw (tag_id, ts, site_id, value) "
                        "VALUES (%s, %s, %s, %s) ON CONFLICT DO NOTHING",
                        ring_rows,
                    )
                if hist_rows:
                    cur.executemany(
                        "INSERT INTO scada_samples (tag_id, ts, value) "
                        "VALUES (%s, %s, %s) ON CONFLICT DO NOTHING",
                        hist_rows,
                    )
            log.info(
                "Flush: %d ring + %d historian tersimpan",
                len(ring_rows), len(hist_rows),
            )
            # Durably stored in Supabase now → drop the disk copies.
            self._buffer_delete_many(buf_deletes)
        except Exception:
            # Keep going — put the values back so the next pass retries them.
            # The buffer rows are intentionally NOT deleted here, so a crash
            # during a Supabase outage still recovers on restart.
            log.exception("Gagal menyimpan ke database, akan dicoba lagi")
            with self._lock:
                for tag_id, _ts, value in rows:
                    self._pending.setdefault(tag_id, value)

    def prune_ring(self) -> None:
        """DEPRECATED — retention now belongs to the backend, not to field PCs.

        Kept only as an explicit break-glass switch (PRUNE_ENABLED=1) for a
        deployment running against a backend too old to have the ring pruner.

        Why it moved (audit data D-3): this statement is not scoped to a site,
        so every bridge in the fleet swept the WHOLE table every 60 s — 50
        plants meant 50 identical full-table deletes per minute, 49 of them
        finding nothing. Retention is a property of the database and now has
        exactly one owner: backend/app/services/ring_pruner.py, which also
        deletes in bounded batches instead of one unbounded statement."""
        try:
            with self._db().cursor() as cur:
                cur.execute(
                    "DELETE FROM scada_ring WHERE ts < now() - make_interval(hours => %s)",
                    (self._ring_window_h,),
                )
        except Exception:
            log.exception("Gagal memangkas data ring, akan dicoba lagi")

    def flush_latest(self) -> None:
        """Live lane: UPSERT the newest value per tag into scada_tag_latest.

        The ~1 s batching here IS the throttle — however fast a device
        publishes, at most one row-update per tag per LATEST_FLUSH_S reaches
        the DB (and Supabase Realtime). Errors are logged and the newest value
        is kept for the next attempt."""
        with self._lock:
            if not self._latest_pending:
                return
            batch = list(self._latest_pending.items())
            self._latest_pending.clear()

        rows = [(tag_id, ts, value) for tag_id, (ts, value) in batch]
        try:
            with self._db().cursor() as cur:
                cur.executemany(
                    "INSERT INTO scada_tag_latest (tag_id, ts, value) "
                    "VALUES (%s, %s, %s) "
                    "ON CONFLICT (tag_id) DO UPDATE "
                    "SET ts = EXCLUDED.ts, value = EXCLUDED.value, "
                    "    updated_at = now()",
                    rows,
                )
        except Exception:
            log.exception("Gagal menyimpan nilai live, akan dicoba lagi")
            with self._lock:
                # Don't clobber values that arrived while we were writing
                for tag_id, pair in batch:
                    self._latest_pending.setdefault(tag_id, pair)

    def heartbeat(self) -> None:
        """Health lane: catat status koneksi tiap site ke scada_bridge_status.

        `updated_at` selalu maju (detak jantung — basi berarti bridge mati),
        `changed_at` hanya bergeser saat status connect berubah. Health
        monitor backend membaca keduanya lalu mengirim alarm Telegram."""
        rows = [
            (site_id, client.is_connected())
            for site_id, client in self._clients.items()
        ]
        if not rows:
            return
        try:
            with self._db().cursor() as cur:
                cur.executemany(
                    "INSERT INTO scada_bridge_status "
                    "  (site_id, connected, changed_at, updated_at) "
                    "VALUES (%s, %s, now(), now()) "
                    "ON CONFLICT (site_id) DO UPDATE SET "
                    "  connected = EXCLUDED.connected, "
                    "  changed_at = CASE "
                    "    WHEN scada_bridge_status.connected "
                    "         IS DISTINCT FROM EXCLUDED.connected "
                    "    THEN now() ELSE scada_bridge_status.changed_at END, "
                    "  updated_at = now()",
                    rows,
                )
            self._hb_warned = False
        except Exception:
            # Tabel belum ada (DB pra-migrasi) atau DB down — jangan crash,
            # dan jangan banjiri log: warning sekali, sisanya debug.
            if not self._hb_warned:
                log.warning(
                    "Gagal menulis heartbeat — tabel scada_bridge_status "
                    "belum ada (jalankan migrasi) atau database down"
                )
                self._hb_warned = True
            else:
                log.debug("Heartbeat masih gagal", exc_info=True)

    # -- main loop --------------------------------------------------------- #

    def run(self) -> None:
        if not self.dsn:
            raise SystemExit("DATABASE_URL belum diisi (lihat .env.example)")

        log.info(
            "R-Net MQTT bridge start — interval per-tag (default %ds), "
            "live-upsert tiap %.1fs%s, refresh konfig tiap %ds",
            FLUSH_INTERVAL_S,
            LATEST_FLUSH_S,
            "" if LATEST_ENABLED else " (NONAKTIF)",
            CONFIG_REFRESH_S,
        )
        if SITE_IDS:
            log.info("SITE_ID aktif — PC ini hanya menangani %d site: %s",
                     len(SITE_IDS), ", ".join(SITE_IDS))
        else:
            log.info("SITE_ID kosong — PC ini menangani SEMUA site aktif. "
                     "Isi SITE_ID di config.env begitu ada lebih dari satu plant.")
        self.reconcile()
        # Recover anything a previous crash/restart left in the disk buffer, now
        # that reconcile() has loaded intervals + ring flags to stamp/route them.
        self.recover_buffer()
        last_latest = last_refresh = last_prune = time.monotonic()
        last_hb = 0.0  # heartbeat pertama langsung pada tick pertama

        while not self._stop.is_set():
            now = time.monotonic()
            if now - last_refresh >= CONFIG_REFRESH_S:
                self.reconcile()
                last_refresh = now
            # History lane: cheap per-tag boundary checks every tick
            self.flush()
            if LATEST_ENABLED and now - last_latest >= LATEST_FLUSH_S:
                self.flush_latest()
                last_latest = now
            if PRUNE_ENABLED and now - last_prune >= PRUNE_EVERY_S:
                self.prune_ring()
                last_prune = now
            if now - last_hb >= HEARTBEAT_S:
                self.heartbeat()
                last_hb = now
            self._stop.wait(1.0)

        # Graceful shutdown: push the freshest live values, then close. Pending
        # history values whose bucket hasn't ended yet are NOT force-stamped now
        # (an early-stamped sample would lie about when the bucket ended) — they
        # stay in the disk buffer and are replayed at their true boundary on the
        # next start, so a restart no longer leaves a hole.
        log.info("Menghentikan bridge…")
        self.flush()
        if LATEST_ENABLED:
            self.flush_latest()
        for site_id in list(self._clients):
            self._teardown_client(site_id)
        if self._conn is not None and not self._conn.closed:
            self._conn.close()
        if self._buf is not None:
            try:
                self._buf.close()  # checkpoints WAL
            except Exception:
                pass

    def stop(self, *_args) -> None:
        self._stop.set()


def main() -> None:
    bridge = Bridge(DATABASE_URL, buffer_path=BUFFER_DB_PATH)
    signal.signal(signal.SIGINT, bridge.stop)
    signal.signal(signal.SIGTERM, bridge.stop)
    bridge.run()


if __name__ == "__main__":
    main()
