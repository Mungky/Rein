#!/usr/bin/env python3
"""R-Net MQTT bridge — field sensor data → Supabase historian.

WHAT IT DOES
    V-Boxes (or any device) publish sensor values to an MQTT broker. This
    bridge subscribes to the topics configured in the R-Net UI, keeps the
    latest value per tag, and writes rows into the two historian lanes the
    R-Net dashboards read through the `scada_samples_all` view:
      - ring tags ("Simpan data" OFF) → `scada_ring` (24h buffer, pruned here)
      - store tags ("Simpan data" ON)  → `scada_samples` (monthly archive+reset)
    Both sample at the tag's chosen sampling level (fastest/fast/slow/slowest,
    seconds set by admin in scada_settings). No second database — the
    charts/gauges/Analisis light up with real data automatically.

CONFIG LIVES IN THE DATABASE, NOT HERE
    Sites (brokers) and tags (topics) are managed entirely from the R-Net
    frontend ("Kelola Site" + the Sumber cell in Analisis). This script only
    needs DATABASE_URL. It re-reads the config every CONFIG_REFRESH_S, so
    adding a topic in the UI makes the bridge subscribe within ~30s — no
    restart.

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
                                values are kept.
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

logging.basicConfig(
    level=getattr(logging, LOG_LEVEL, logging.INFO),
    format="%(asctime)s %(levelname)s %(message)s",
)
log = logging.getLogger("rnet-bridge")


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
    def __init__(self, dsn: str) -> None:
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

    # -- database ---------------------------------------------------------- #

    def _db(self) -> psycopg.Connection:
        if self._conn is None or self._conn.closed:
            # prepare_threshold=None: no server-side prepared statements — required
            # when DATABASE_URL points at Supabase's transaction pooler (port 6543).
            self._conn = psycopg.connect(
                self.dsn, autocommit=True, connect_timeout=10, prepare_threshold=None
            )
        return self._conn

    def load_config(
        self,
    ) -> tuple[dict[str, SiteCfg], dict[str, Transform], dict[str, int], set[str]]:
        """Read enabled sites + their enabled MQTT tags from the DB.

        Returns the sites (with their topic→tag_id subscriptions), a
        tag_id→transform map used to scale each raw value before storing, a
        tag_id→storage-interval map (seconds), and the set of ring-mode tags.
        """
        sites: dict[str, SiteCfg] = {}
        xform: dict[str, Transform] = {}
        interval: dict[str, int] = {}
        ring: set[str] = set()
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

            cur.execute(
                "SELECT id, mqtt_host, mqtt_port, mqtt_username, mqtt_password "
                "FROM scada_sites WHERE enabled = true"
            )
            for sid, host, port, user, pw in cur.fetchall():
                sites[str(sid)] = SiteCfg(str(sid), host, int(port), user, pw)

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
                    xform[str(tag_id)] = _parse_transform(config)
                    interval[str(tag_id)], is_ring = _parse_interval(config, self._levels)
                    if is_ring:
                        ring.add(str(tag_id))
        return sites, xform, interval, ring

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
        with self._lock:
            self._pending[tag_id] = value
            self._latest_pending[tag_id] = (datetime.now(timezone.utc), value)

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
            sites, self._xform, self._interval, self._ring = self.load_config()
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

        if not rows:
            return
        # Route each row to its lane: ring tags → scada_ring (24h buffer),
        # store tags → scada_samples (historian).
        ring_rows = [r for r in rows if r[0] in self._ring]
        hist_rows = [r for r in rows if r[0] not in self._ring]
        try:
            with self._db().cursor() as cur:
                if ring_rows:
                    cur.executemany(
                        "INSERT INTO scada_ring (tag_id, ts, value) "
                        "VALUES (%s, %s, %s) ON CONFLICT DO NOTHING",
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
        except Exception:
            # Keep going — put the values back so the next pass retries them
            log.exception("Gagal menyimpan ke database, akan dicoba lagi")
            with self._lock:
                for tag_id, _ts, value in rows:
                    self._pending.setdefault(tag_id, value)

    def prune_ring(self) -> None:
        """Ring lane keeps only the last `ring_window_h` hours (CCTV-by-time
        model): rows older than the window are deleted. One statement across all
        of scada_ring — runs every PRUNE_EVERY_S."""
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
        self.reconcile()
        last_latest = last_refresh = last_prune = time.monotonic()

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
            if now - last_prune >= PRUNE_EVERY_S:
                self.prune_ring()
                last_prune = now
            self._stop.wait(1.0)

        # Graceful shutdown: push the freshest live values, then close.
        # Pending history values whose bucket hasn't ended yet are dropped on
        # purpose — a gap is honest, an early-stamped sample is not.
        log.info("Menghentikan bridge…")
        self.flush()
        if LATEST_ENABLED:
            self.flush_latest()
        for site_id in list(self._clients):
            self._teardown_client(site_id)
        if self._conn is not None and not self._conn.closed:
            self._conn.close()

    def stop(self, *_args) -> None:
        self._stop.set()


def main() -> None:
    bridge = Bridge(DATABASE_URL)
    signal.signal(signal.SIGINT, bridge.stop)
    signal.signal(signal.SIGTERM, bridge.stop)
    bridge.run()


if __name__ == "__main__":
    main()
