"""Bundled MQTT payloads — one topic carrying a whole gateway.

The bridge used to assume one topic = one number. That assumption is what made
a 300-sensor plant cost 300 topics and ~100 messages a second on a self-hosted
broker. These tests cover the shape that replaces it, weighted towards the
failures that are SILENT:

  - a value invented out of text that merely starts with digits (the gateway
    serial "31c73eb9..." read as 31 — found in live capture, not in review),
  - a configured field the gateway never sends, which produces an empty sensor
    and no error anywhere,
  - the plain single-value path quietly changing behaviour, which would break
    every sensor currently in production.

Also pinned here: one MQTT packet must cost ONE disk transaction, not one per
sensor. At 300 sensors the difference is 300 fsyncs several times a second on
an unattended field PC.

The bridge lives at deploy/data/bridge.py (outside the app package) and is
loaded by path, same as test_bridge_buffer.py.
"""

import importlib.util
import logging
import sys
import uuid
from pathlib import Path

import pytest

BRIDGE_PATH = Path(__file__).resolve().parents[2] / "deploy" / "data" / "bridge.py"


def _load_bridge():
    spec = importlib.util.spec_from_file_location("rnet_bridge_bulk", BRIDGE_PATH)
    mod = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = mod
    spec.loader.exec_module(mod)
    return mod


bridge_mod = _load_bridge()
Bridge = bridge_mod.Bridge


class FakeMsg:
    def __init__(self, topic, payload):
        self.topic = topic
        self.payload = payload


TOPIC = "rnet/lombok/gw/lombok1"
SITE = "site-1"

# A real capture from the pilot plant, serial number and all.
REAL_PACKET = (
    b'{"site":"lombok","gateway":"lombok1","ts":"2026-07-28T03:12:30.114Z",'
    b'"values":{"waterlevel1":12,"waterlevel2":11,"waterlevel3":9,'
    b'"waterlevel4":93,"temperature1":90.785011291504,'
    b'"temperature2":89.820960998535,"temperature3":81.25}}'
)


def _bridge(tmp_path, fields, topic=TOPIC):
    """A bridge wired to `fields` (name -> tag id) on one bundled topic."""
    br = Bridge("", buffer_path=str(tmp_path / "buf.db"))
    # rute = {nama-di-sumber (kolom Perangkat) -> tag_id}
    br._routes = {SITE: {topic: dict(fields)}}
    br._xform = {tid: (1.0, 0.0, None) for tid in fields.values()}
    return br


# --- reading numbers out of a payload -------------------------------------


def test_a_serial_number_is_not_read_as_a_reading():
    """parseFloat-style prefix parsing turns '31c73eb96aaf...' into 31, which
    lands in the database looking like a plausible sensor value. float() must
    reject the whole string."""
    assert bridge_mod._num("31c73eb96aaf3a7fece51f8d1deeec91") is None
    assert bridge_mod._num("12abc") is None


def test_a_flag_is_not_read_as_a_reading():
    """True is an int in Python, so a boolean would otherwise store as 1.0."""
    assert bridge_mod._num(True) is None
    assert bridge_mod._num(False) is None


@pytest.mark.parametrize("bad", [float("nan"), float("inf"), float("-inf"), None, [], {}])
def test_unusable_values_are_dropped(bad):
    assert bridge_mod._num(bad) is None


def test_numbers_as_text_are_still_numbers():
    assert bridge_mod._num("12.5") == 12.5
    assert bridge_mod._num(0) == 0.0          # zero is a reading, not "missing"


def test_bulk_parsing_ignores_the_envelope_fields():
    gw, out = bridge_mod._coerce_bulk(REAL_PACKET)
    assert gw == "lombok1"
    assert set(out) == {
        "waterlevel1", "waterlevel2", "waterlevel3", "waterlevel4",
        "temperature1", "temperature2", "temperature3",
    }
    assert out["temperature1"] == 90.785011291504


def test_a_payload_without_the_values_envelope_still_works():
    """A gateway that bundles without wrapping must not be silently empty."""
    gw, out = bridge_mod._coerce_bulk(b'{"suhu": 30, "level": 4.5}')
    assert gw is None
    assert out == {"suhu": 30.0, "level": 4.5}


@pytest.mark.parametrize("bad", [b"", b"bukan json", b"[1,2,3]", b'"teks"'])
def test_a_payload_that_is_not_an_object_is_rejected(bad):
    assert bridge_mod._coerce_bulk(bad) is None


# --- routing one packet to many tags --------------------------------------


def test_one_packet_feeds_every_configured_sensor(tmp_path):
    fields = {f"waterlevel{i}": str(uuid.uuid4()) for i in range(1, 5)}
    fields["temperature1"] = str(uuid.uuid4())
    br = _bridge(tmp_path, fields)

    br._on_message(None, SITE, FakeMsg(TOPIC, REAL_PACKET))

    assert br._pending[fields["waterlevel1"]] == 12.0
    assert br._pending[fields["temperature1"]] == 90.785011291504
    assert len(br._pending) == 5


def test_values_nobody_asked_for_do_not_become_sensors(tmp_path):
    """The packet carries 7 readings; only the 2 configured ones may land."""
    fields = {"waterlevel1": str(uuid.uuid4()), "temperature3": str(uuid.uuid4())}
    br = _bridge(tmp_path, fields)

    br._on_message(None, SITE, FakeMsg(TOPIC, REAL_PACKET))

    assert set(br._pending) == set(fields.values())


def test_a_missing_field_leaves_its_sensor_empty_and_the_rest_working(tmp_path, caplog):
    """A typo must not take the whole gateway down with it — and must not be
    silent either."""
    good, typo = str(uuid.uuid4()), str(uuid.uuid4())
    br = _bridge(tmp_path, {"waterlevel1": good, "WaterLevel2": typo})

    with caplog.at_level(logging.WARNING):
        br._on_message(None, SITE, FakeMsg(TOPIC, REAL_PACKET))

    assert br._pending[good] == 12.0
    assert typo not in br._pending
    warning = "\n".join(r.getMessage() for r in caplog.records)
    assert "WaterLevel2" in warning
    assert "waterlevel2" in warning      # the names that WERE sent


def test_the_missing_field_warning_is_logged_once(tmp_path, caplog):
    """It fires on every packet — several times a second, forever. A warning
    that repeats that fast is a warning nobody reads."""
    br = _bridge(tmp_path, {"tidakada": str(uuid.uuid4())})

    with caplog.at_level(logging.WARNING):
        for _ in range(20):
            br._on_message(None, SITE, FakeMsg(TOPIC, REAL_PACKET))

    assert len([r for r in caplog.records if "tidakada" in r.getMessage()]) == 1


def test_a_reconfigure_lets_the_warning_fire_again(tmp_path):
    """Fixed, then broken again, must warn again."""
    br = _bridge(tmp_path, {"tidakada": str(uuid.uuid4())})
    br._on_message(None, SITE, FakeMsg(TOPIC, REAL_PACKET))
    assert br._missing_warned

    br.load_config = lambda: ({}, {}, {}, set(), {})
    br.reconcile()
    assert br._missing_warned == set()


def test_a_zero_reading_is_stored_not_treated_as_missing(tmp_path):
    tag = str(uuid.uuid4())
    br = _bridge(tmp_path, {"level": tag})

    br._on_message(None, SITE, FakeMsg(TOPIC, b'{"values":{"level":0}}'))

    assert br._pending[tag] == 0.0


def test_scaling_is_applied_per_sensor(tmp_path):
    a, b = str(uuid.uuid4()), str(uuid.uuid4())
    br = _bridge(tmp_path, {"waterlevel1": a, "waterlevel2": b})
    br._xform = {a: (6.25, -25.0, None), b: (1.0, 0.0, None)}   # 4-20 mA → 0-100

    br._on_message(None, SITE, FakeMsg(TOPIC, REAL_PACKET))

    assert br._pending[a] == 12 * 6.25 - 25
    assert br._pending[b] == 11.0


def test_an_unreadable_bundle_stores_nothing(tmp_path):
    br = _bridge(tmp_path, {"waterlevel1": str(uuid.uuid4())})

    br._on_message(None, SITE, FakeMsg(TOPIC, b"rusak"))

    assert br._pending == {}


def test_a_topic_nobody_subscribed_to_is_ignored(tmp_path):
    br = _bridge(tmp_path, {"waterlevel1": str(uuid.uuid4())})

    br._on_message(None, SITE, FakeMsg("rnet/lain/gw/x", REAL_PACKET))

    assert br._pending == {}


# --- the single-value path must not change --------------------------------


def test_plain_single_value_topics_still_work(tmp_path):
    """Every sensor in the live database is shaped this way. A regression here
    is a plant going dark."""
    tag = str(uuid.uuid4())
    br = Bridge("", buffer_path=str(tmp_path / "buf.db"))
    br._routes = {SITE: {"rnet/lombok/line1/level1": {"DEV-01": tag}}}
    br._xform = {tag: (1.0, 0.0, None)}

    br._on_message(None, SITE, FakeMsg("rnet/lombok/line1/level1", b'{"value": 72.5}'))
    assert br._pending[tag] == 72.5

    br._on_message(None, SITE, FakeMsg("rnet/lombok/line1/level1", b"73.5"))
    assert br._pending[tag] == 73.5


def test_a_bundle_arriving_on_a_plain_topic_is_rejected_not_guessed(tmp_path):
    """Shape is decided by the CONFIG, not by sniffing the payload — otherwise
    a plain topic would behave differently depending on what arrived."""
    tag = str(uuid.uuid4())
    br = Bridge("", buffer_path=str(tmp_path / "buf.db"))
    br._routes = {SITE: {TOPIC: {"DEV-01": tag}}}
    br._xform = {tag: (1.0, 0.0, None)}

    br._on_message(None, SITE, FakeMsg(TOPIC, REAL_PACKET))

    assert br._pending == {}


# --- one topic for a whole plant: the field name stops being unique -------
#
# Regresi dari kejadian nyata 28 Juli 2026. Node-RED diarahkan menerbitkan
# SATU topik untuk seluruh plant (fikri/rnet/lombok/all), dan sebuah tag
# membaca field polos `waterlevel1`. Setiap line punya waterlevel1, jadi tag itu
# mengambil milik gateway yang kebetulan menerbitkan paling akhir. Terekspor
# 43,9% nilai 0 — bukan sensor rusak, melainkan tangki Line 2 (0) berselang-
# seling dengan tangki Line 1 (12-13) dalam satu kolom. Tidak ada error, tidak
# ada nilai hilang, jumlah baris justru NAIK.

L1 = (b'{"site":"lombok","gateway":"lombok1","values":{"waterlevel1":12}}')
L2 = (b'{"site":"lombok","gateway":"lombok2","values":{"waterlevel1":0}}')
ALL = "fikri/rnet/lombok/all"


def test_a_qualified_field_takes_only_its_own_gateway(tmp_path):
    """`lombok1.waterlevel1` di topik bersama harus mengabaikan paket lombok2."""
    tag = str(uuid.uuid4())
    br = _bridge(tmp_path, {"lombok1.waterlevel1": tag}, topic=ALL)

    br._on_message(None, SITE, FakeMsg(ALL, L1))
    assert br._pending[tag] == 12.0

    br._on_message(None, SITE, FakeMsg(ALL, L2))
    assert br._pending[tag] == 12.0        # nilai lombok2 TIDAK menimpa


def test_two_gateways_on_one_topic_feed_two_separate_tags(tmp_path):
    """Bentuk yang benar untuk satu topik per plant: satu tag per gateway,
    dibedakan oleh awalan di kolom Field."""
    a, b = str(uuid.uuid4()), str(uuid.uuid4())
    br = _bridge(
        tmp_path, {"lombok1.waterlevel1": a, "lombok2.waterlevel1": b}, topic=ALL
    )

    br._on_message(None, SITE, FakeMsg(ALL, L1))
    br._on_message(None, SITE, FakeMsg(ALL, L2))

    assert br._pending[a] == 12.0
    assert br._pending[b] == 0.0           # dua tangki, dua kolom


def test_a_field_addressed_to_another_gateway_is_not_reported_missing(tmp_path, caplog):
    """`lombok2.x` saat paket datang dari lombok1 bukan salah ketik — kalau
    diperingatkan, log akan banjir peringatan palsu tiap paket."""
    br = _bridge(tmp_path, {"lombok2.waterlevel1": str(uuid.uuid4())}, topic=ALL)

    with caplog.at_level(logging.WARNING):
        br._on_message(None, SITE, FakeMsg(ALL, L1))

    assert caplog.records == []


def test_a_bare_field_fed_by_two_gateways_is_reported(tmp_path, caplog):
    """Cacat yang tidak punya gejala apa pun. Hanya jembatan yang bisa
    melihatnya, karena hanya dia yang menerima kedua paket."""
    br = _bridge(tmp_path, {"waterlevel1": str(uuid.uuid4())}, topic=ALL)

    with caplog.at_level(logging.WARNING):
        br._on_message(None, SITE, FakeMsg(ALL, L1))
        assert caplog.records == []        # satu gateway saja: belum ada masalah
        br._on_message(None, SITE, FakeMsg(ALL, L2))

    pesan = "\n".join(r.getMessage() for r in caplog.records)
    assert "waterlevel1" in pesan
    assert "lombok1" in pesan and "lombok2" in pesan


def test_the_collision_warning_is_logged_once(tmp_path, caplog):
    br = _bridge(tmp_path, {"waterlevel1": str(uuid.uuid4())}, topic=ALL)

    with caplog.at_level(logging.WARNING):
        for _ in range(20):
            br._on_message(None, SITE, FakeMsg(ALL, L1))
            br._on_message(None, SITE, FakeMsg(ALL, L2))

    assert len(caplog.records) == 1


def test_a_bare_field_on_a_per_gateway_topic_never_warns(tmp_path, caplog):
    """Topik per gateway sudah membedakannya, jadi field polos memang benar —
    peringatan di sini akan jadi gangguan untuk pemakaian yang normal."""
    br = _bridge(tmp_path, {"waterlevel1": str(uuid.uuid4())})

    with caplog.at_level(logging.WARNING):
        for _ in range(20):
            br._on_message(None, SITE, FakeMsg(TOPIC, REAL_PACKET))

    assert caplog.records == []


def test_a_dotted_field_name_from_the_gateway_still_works(tmp_path):
    """Titik di nama field belum tentu awalan gateway. Pencocokan harfiah
    didahulukan supaya gateway seperti ini tidak ikut rusak."""
    tag = str(uuid.uuid4())
    br = _bridge(tmp_path, {"tank.level": tag}, topic=ALL)

    br._on_message(
        None, SITE,
        FakeMsg(ALL, b'{"gateway":"lombok1","values":{"tank.level":7.5}}'),
    )

    assert br._pending[tag] == 7.5


# --- "Perangkat" = nama nilai itu di sumbernya ------------------------------
#
# SATU kotak, bukan dua. Sebelumnya ada "Field" di dialog Sumber DAN "Perangkat"
# di tabel, dan tidak ada yang bisa membedakan mana untuk apa. Sekarang cuma
# Perangkat, kolom yang memang sudah ada dan memang artinya "nilai ini namanya
# apa di alat sana".
#
# Yang paling dijaga di sini: 14 sensor produksi memakai topik bernilai tunggal
# dan Perangkat-nya berisi "DEV-01", "boiler1", dan sejenisnya. Nama-nama itu
# tidak cocok dengan apa pun di payload, dan HARUS jatuh ke jalur polos —
# kalau tidak, seluruh plant diam seketika.


def _bridge_dev(tmp_path, entries, topic=ALL):
    """entries: {nama-di-kolom-Perangkat: tag_id}"""
    br = Bridge("", buffer_path=str(tmp_path / "buf.db"))
    br._routes = {SITE: {topic: dict(entries)}}
    br._xform = {tid: (1.0, 0.0, None) for tid in entries.values()}
    return br


def test_nama_polos_mengambil_nilai_dari_paket_gabungan(tmp_path):
    tag = str(uuid.uuid4())
    br = _bridge_dev(tmp_path, {"waterlevel1": tag}, topic=TOPIC)

    br._on_message(None, SITE, FakeMsg(TOPIC, REAL_PACKET))

    assert br._pending[tag] == 12.0


def test_nama_lengkap_juga_benar_di_topik_per_gateway(tmp_path):
    """Ini yang membuat tombol salin di Pemantau Topik boleh SELALU menyertakan
    nama gateway: bentuk lengkap benar di kedua macam topik.

    Di topik per gateway, `lombok1.waterlevel1` tidak ada harfiah di paket —
    awalannya dikupas karena cocok dengan gateway paket itu. Kalau ini tidak
    berlaku, orang harus menebak kapan memakai awalan dan kapan tidak, dan
    salahnya tidak bergejala."""
    tag = str(uuid.uuid4())
    br = _bridge_dev(tmp_path, {"lombok1.waterlevel1": tag}, topic=TOPIC)

    br._on_message(None, SITE, FakeMsg(TOPIC, REAL_PACKET))

    assert br._pending[tag] == 12.0


def test_nama_berawalan_gateway_memisahkan_dua_line(tmp_path):
    """Satu topik untuk seluruh plant: yang membedakan adalah awalan gateway di
    kolom Perangkat. Ini kasus 28 Juli."""
    a, b = str(uuid.uuid4()), str(uuid.uuid4())
    br = _bridge_dev(tmp_path, {
        "lombok1.waterlevel1": a,
        "lombok2.waterlevel1": b,
    })

    for _ in range(3):
        br._on_message(None, SITE, FakeMsg(ALL, L1))
        br._on_message(None, SITE, FakeMsg(ALL, L2))

    assert br._pending[a] == 12.0     # Line 1 tidak pernah jadi 0
    assert br._pending[b] == 0.0      # dua tangki, dua kolom


def test_sensor_produksi_bernilai_tunggal_tetap_jalan(tmp_path):
    """SATU-SATUNYA cara perubahan ini bisa memadamkan plant. "DEV-01" tidak
    cocok dengan apa pun, jadi payload polos harus tetap terbaca."""
    tag = str(uuid.uuid4())
    br = _bridge_dev(tmp_path, {"DEV-01": tag}, topic="rnet/lombok/line1/level1")

    br._on_message(None, SITE, FakeMsg("rnet/lombok/line1/level1", b"72.5"))
    assert br._pending[tag] == 72.5

    br._on_message(None, SITE, FakeMsg("rnet/lombok/line1/level1", b'{"value": 73.5}'))
    assert br._pending[tag] == 73.5


def test_nama_yang_tidak_cocok_di_paket_gabungan_dilaporkan(tmp_path, caplog):
    """Paket JELAS gabungan tapi tidak ada nama yang cocok = salah ketik, bukan
    topik polos. Harus bersuara, sekali, dengan daftar nama yang benar."""
    br = _bridge_dev(tmp_path, {"WaterLevel9": str(uuid.uuid4())}, topic=TOPIC)

    with caplog.at_level(logging.WARNING):
        for _ in range(10):
            br._on_message(None, SITE, FakeMsg(TOPIC, REAL_PACKET))

    assert br._pending == {}
    pesan = "\n".join(r.getMessage() for r in caplog.records)
    assert "WaterLevel9" in pesan and "waterlevel1" in pesan
    assert len(caplog.records) == 1


def test_satu_nama_meleset_tidak_menjatuhkan_yang_lain(tmp_path, caplog):
    baik, salah = str(uuid.uuid4()), str(uuid.uuid4())
    br = _bridge_dev(tmp_path, {"waterlevel1": baik, "salahketik": salah},
                     topic=TOPIC)

    with caplog.at_level(logging.WARNING):
        br._on_message(None, SITE, FakeMsg(TOPIC, REAL_PACKET))

    assert br._pending[baik] == 12.0
    assert salah not in br._pending
    assert any("salahketik" in r.getMessage() for r in caplog.records)


def test_awalan_yang_benar_mematikan_peringatan_tabrakan(tmp_path, caplog):
    """Sudah dipisahkan = tidak ada yang bercampur = tidak ada yang perlu
    diperingatkan. Peringatan yang tetap muncul setelah diperbaiki adalah
    peringatan yang mulai diabaikan."""
    a, b = str(uuid.uuid4()), str(uuid.uuid4())
    br = _bridge_dev(tmp_path, {
        "lombok1.waterlevel1": a,
        "lombok2.waterlevel1": b,
    })

    with caplog.at_level(logging.WARNING):
        for _ in range(10):
            br._on_message(None, SITE, FakeMsg(ALL, L1))
            br._on_message(None, SITE, FakeMsg(ALL, L2))

    assert caplog.records == []


def test_topik_polos_hanya_di_subscribe_qos_0(tmp_path):
    """Jumlah sensor di satu topik yang menentukan, karena konfigurasi tidak
    lagi menyimpan bentuk paket."""
    assert Bridge._qos_for({"DEV-01": "t1"}) == 0
    assert Bridge._qos_for({"waterlevel1": "t1", "waterlevel2": "t2"}) == 1


# --- delivery guarantee scales with what a lost packet costs --------------


def test_a_bundled_topic_is_subscribed_at_qos_1():
    """One dropped message used to cost one reading; bundled it costs every
    sensor on the gateway. Measured on the pilot: the QoS 0 lane lost 231 of
    34 692 readings over 2 h, the QoS 1 lane lost 0."""
    assert Bridge._qos_for({"waterlevel1": "t1", "temperature1": "t2"}) == 1


def test_a_plain_topic_keeps_qos_0():
    """Unchanged for every sensor currently in production."""
    assert Bridge._qos_for({"DEV-01": "t1"}) == 0


# --- one packet, one disk transaction -------------------------------------


def test_a_packet_costs_one_disk_commit_not_one_per_sensor(tmp_path):
    """The reason _buffer_put_many exists. 300 sensors arriving together used
    to mean 300 DELETE+INSERT+COMMIT+count(*) cycles on the field PC's disk."""
    fields = {f"sensor{i}": str(uuid.uuid4()) for i in range(1, 8)}
    br = Bridge("", buffer_path=str(tmp_path / "buf.db"))
    br._routes = {SITE: {TOPIC: dict(fields)}}
    br._xform = {tid: (1.0, 0.0, None) for tid in fields.values()}

    # sqlite3.Connection.commit is read-only, so count through a proxy that
    # forwards everything else to the real connection — the rows still have to
    # land on disk for the assertions below to hold.
    class _Counting:
        def __init__(self, conn, sink):
            self._conn, self._sink = conn, sink

        def commit(self):
            self._sink.append(1)
            return self._conn.commit()

        def __getattr__(self, name):
            return getattr(self._conn, name)

    commits = []
    br._buf = _Counting(br._buffer_db(), commits)

    payload = b'{"values":{' + b",".join(
        f'"sensor{i}":{i}'.encode() for i in range(1, 8)
    ) + b"}}"
    br._on_message(None, SITE, FakeMsg(TOPIC, payload))

    assert len(commits) == 1
    assert len(br._buffer_all()) == 7      # every value still reached the disk


def test_every_value_in_a_packet_reaches_the_disk_buffer(tmp_path):
    """Batching must not become 'only the last one survives a crash'."""
    fields = {f"waterlevel{i}": str(uuid.uuid4()) for i in range(1, 5)}
    br = _bridge(tmp_path, fields)

    br._on_message(None, SITE, FakeMsg(TOPIC, REAL_PACKET))

    stored = {tag_id: value for tag_id, _ts, value in br._buffer_all()}
    assert stored[fields["waterlevel1"]] == 12.0
    assert stored[fields["waterlevel4"]] == 93.0
    assert len(stored) == 4


def test_a_newer_packet_replaces_the_in_flight_values(tmp_path):
    """One row per tag while a bucket is still open — otherwise a fast gateway
    fills the buffer with every intermediate reading."""
    fields = {"waterlevel1": str(uuid.uuid4()), "waterlevel2": str(uuid.uuid4())}
    br = _bridge(tmp_path, fields)

    br._on_message(None, SITE, FakeMsg(TOPIC, b'{"values":{"waterlevel1":1,"waterlevel2":2}}'))
    br._on_message(None, SITE, FakeMsg(TOPIC, b'{"values":{"waterlevel1":3,"waterlevel2":4}}'))

    stored = {tag_id: value for tag_id, _ts, value in br._buffer_all()}
    assert len(br._buffer_all()) == 2
    assert stored[fields["waterlevel1"]] == 3.0
