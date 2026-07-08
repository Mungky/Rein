#!/usr/bin/env python3
"""R-Net MQTT bridge — field sensor data → Supabase historian.

WHAT IT DOES
    V-Boxes (or any device) publish sensor values to an MQTT broker. This
    bridge subscribes to the topics configured in the R-Net UI, keeps the
    latest value per tag, and every minute writes one row per tag into the
    SAME `scada_samples` table the R-Net dashboards already read. No second
    database, no second data model — the charts/gauges/Analisis light up with
    real data automatically.

CONFIG LIVES IN THE DATABASE, NOT HERE
    Sites (brokers) and tags (topics) are managed entirely from the R-Net
    frontend ("Kelola Site" + the Sumber cell in Analisis). This script only
    needs DATABASE_URL. It re-reads the config every CONFIG_REFRESH_S, so
    adding a topic in the UI makes the bridge subscribe within ~30s — no
    restart.

RESOLUTION
    MQTT is push (messages arrive any time) but the historian stores one row
    per tag per minute (PK tag_id+ts, ON CONFLICT DO NOTHING). So we buffer the
    latest value received each minute and flush it minute-aligned. A tag that
    sends nothing in a given minute produces a gap — exactly what a real
    sampled historian should show (the UI already flags stale data).

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
LOG_LEVEL = os.getenv("LOG_LEVEL", "INFO").upper()

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


def _aligned_minute() -> datetime:
    return datetime.now(timezone.utc).replace(second=0, microsecond=0)


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


# --------------------------------------------------------------------------- #
# Bridge
# --------------------------------------------------------------------------- #


class Bridge:
    def __init__(self, dsn: str) -> None:
        self.dsn = dsn
        self._lock = threading.Lock()
        # Values received during the current minute: tag_id -> value. Cleared
        # on every successful flush so dead sensors produce gaps, not fake data.
        self._pending: dict[str, float] = {}
        # site_id -> live paho client
        self._clients: dict[str, mqtt.Client] = {}
        # site_id -> topic -> tag_id (the desired subscription set)
        self._routes: dict[str, dict[str, str]] = {}
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

    def load_config(self) -> dict[str, SiteCfg]:
        """Read enabled sites + their enabled MQTT tags from the DB."""
        sites: dict[str, SiteCfg] = {}
        with self._db().cursor() as cur:
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
        return sites

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
        value = _coerce_value(msg.payload)
        if value is None:
            log.debug("Site %s topik %s: payload tidak valid, dilewati", site_id, msg.topic)
            return
        with self._lock:
            self._pending[tag_id] = value

    # -- client lifecycle -------------------------------------------------- #

    def _make_client(self, site: SiteCfg) -> mqtt.Client:
        client = mqtt.Client(
            mqtt.CallbackAPIVersion.VERSION2,
            client_id=f"rnet-bridge-{site.site_id[:8]}",
            userdata=site.site_id,
        )
        if site.username:
            client.username_pw_set(site.username, site.password or None)
        client.reconnect_delay_set(min_delay=1, max_delay=60)
        client.on_connect = self._on_connect
        client.on_disconnect = self._on_disconnect
        client.on_message = self._on_message
        return client

    def reconcile(self) -> None:
        """Re-read config and align live MQTT clients + subscriptions to it."""
        try:
            sites = self.load_config()
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
        """Write the minute's buffered values into scada_samples."""
        with self._lock:
            if not self._pending:
                return
            batch = list(self._pending.items())
            self._pending.clear()

        ts = _aligned_minute()
        rows = [(tag_id, ts, value) for tag_id, value in batch]
        try:
            with self._db().cursor() as cur:
                cur.executemany(
                    "INSERT INTO scada_samples (tag_id, ts, value) "
                    "VALUES (%s, %s, %s) ON CONFLICT DO NOTHING",
                    rows,
                )
            log.info("Flush: %d nilai tersimpan @ %s", len(rows), ts.isoformat())
        except Exception:
            # Keep going — put the values back so the next flush retries them
            log.exception("Gagal menyimpan ke database, akan dicoba lagi")
            with self._lock:
                for tag_id, value in batch:
                    self._pending.setdefault(tag_id, value)

    # -- main loop --------------------------------------------------------- #

    def run(self) -> None:
        if not self.dsn:
            raise SystemExit("DATABASE_URL belum diisi (lihat .env.example)")

        log.info(
            "R-Net MQTT bridge start — flush tiap %ds, refresh konfig tiap %ds",
            FLUSH_INTERVAL_S,
            CONFIG_REFRESH_S,
        )
        self.reconcile()
        last_flush = last_refresh = time.monotonic()

        while not self._stop.is_set():
            now = time.monotonic()
            if now - last_refresh >= CONFIG_REFRESH_S:
                self.reconcile()
                last_refresh = now
            if now - last_flush >= FLUSH_INTERVAL_S:
                self.flush()
                last_flush = now
            self._stop.wait(1.0)

        # Graceful shutdown: flush what we have, then close everything
        log.info("Menghentikan bridge…")
        self.flush()
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
