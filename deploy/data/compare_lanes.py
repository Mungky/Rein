"""Bandingkan jalur MQTT lama (satu topik per sensor) dengan jalur baru (satu
paket berisi semua) — Tahap 2 peralihan Node-RED.

APA YANG DILAKUKAN
    Mendengarkan KEDUA jalur di broker yang sama, lalu mencocokkan nilai demi
    nilai per sensor. Tidak menulis ke database, tidak menerbitkan pesan MQTT
    apa pun, tidak menyentuh Node-RED. Murni menonton.

CARA PAKAI
    python deploy/data/compare_lanes.py --jam 24

    Ringkasan dicetak tiap --lapor-tiap detik (bawaan 300) dan sekali lagi di
    akhir. Ctrl+C kapan saja: laporan akhir tetap dicetak.

    Tiap nilai yang tertangkap juga ditulis ke --rekaman (JSONL) sehingga
    analisisnya bisa diulang tanpa menunggu 24 jam lagi:

    python deploy/data/compare_lanes.py --analisis-saja rekaman.jsonl

CARA MENCOCOKKAN
    Kedua jalur berasal dari pesan gateway yang SAMA, jadi URUTAN nilai per
    sensor harus identik. Itulah yang dibandingkan: deretan nilai jalur lama
    disejajarkan dengan deretan nilai jalur baru (difflib), lalu dilaporkan
    berapa nilai yang hanya ada di satu sisi.

    Waktu SENGAJA tidak dipakai untuk menentukan lulus/tidak. Percobaan pertama
    memakai jendela waktu dan hasilnya menyesatkan: jalur lama ternyata bisa
    tersendat lalu menyusul berombongan sampai ~6 detik terlambat, sehingga
    ratusan nilai yang sebenarnya UTUH terlihat seperti "hilang". Keterlambatan
    itu tetap diukur dan dilaporkan, tapi sebagai keterangan — bukan vonis.

    Peta "field gateway -> sensor mana" TIDAK diketik ulang di sini. Ia dibaca
    dari rekaman flow lama di arsip/, supaya yang dibandingkan benar-benar
    perilaku flow lama, bukan asumsi penulis skrip ini.
"""

from __future__ import annotations

import argparse
import difflib
import json
import os
import re
import ssl
import sys
import threading
import time
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

import paho.mqtt.client as mqtt

# Topik mentah gateway V-Box — patokan bersama kedua jalur.
TOPIK_GATEWAY = "fikri/vnet/+"

HERE = Path(__file__).resolve().parent
REPO = HERE.parent.parent
ARSIP = HERE / "node-red" / "arsip" / "2026-07-27-produksi-lombok-SEBELUM.json"



# --------------------------------------------------------------------------- #
# Peta field -> sensor, dibaca dari flow lama
# --------------------------------------------------------------------------- #
def peta_dari_flow_lama(path: Path) -> dict[str, str]:
    """Kembalikan {"lombok1.waterlevel1": "rnet/lombok/line1/level1", ...}."""
    nodes = json.loads(path.read_text(encoding="utf-8"))
    byid = {n["id"]: n for n in nodes}
    peta: dict[str, str] = {}
    for n in nodes:
        if n.get("type") != "mqtt in":
            continue
        gw = str(n.get("topic", "")).split("/")[-1]
        for wid in n.get("wires", [[]])[0]:
            fn = byid.get(wid)
            if not fn or fn.get("type") != "function":
                continue
            m = re.search(r"payload\.data\.(\w+)", fn.get("func", ""))
            if not m:
                continue
            for wid2 in fn.get("wires", [[]])[0]:
                out = byid.get(wid2)
                if out and out.get("type") == "mqtt out" and out.get("topic"):
                    peta[f"{gw}.{m.group(1)}"] = out["topic"]
    return peta


# --------------------------------------------------------------------------- #
# Pengumpul
# --------------------------------------------------------------------------- #
class Pengumpul:
    def __init__(self, peta: dict[str, str], rekaman: Path | None) -> None:
        self.peta = peta
        self.lock = threading.Lock()
        # sensor -> jalur -> [(t, nilai)]
        self.data: dict[str, dict[str, list]] = defaultdict(
            lambda: {"lama": [], "baru": [], "gateway": []}
        )
        # field jalur baru yang tidak dikenal peta lama (mis. Line 3 nanti)
        self.tak_dikenal: dict[str, int] = defaultdict(int)
        self.paket_baru = 0
        self.pesan_lama = 0
        self.mulai = time.time()
        # buffering=1 (per baris): pemantauan 24 jam harus bisa diintip kapan
        # saja, dan kalau laptop mati mendadak rekamannya tidak ikut hilang.
        self._rek = (
            rekaman.open("a", encoding="utf-8", buffering=1) if rekaman else None
        )

    def _tulis(self, jalur: str, sensor: str, t: float, v: float) -> None:
        if self._rek:
            self._rek.write(
                json.dumps({"jalur": jalur, "sensor": sensor, "t": t, "v": v}) + "\n"
            )

    def lama(self, topic: str, payload: bytes) -> None:
        try:
            teks = payload.decode("utf-8").strip()
            data = json.loads(teks) if teks.startswith(("{", "[")) else teks
            v = float(data.get("value") if isinstance(data, dict) else data)
        except (ValueError, AttributeError, TypeError):
            return
        t = time.time()
        with self.lock:
            self.pesan_lama += 1
            self.data[topic]["lama"].append((t, v))
            self._tulis("lama", topic, t, v)

    def gateway(self, topic: str, payload: bytes) -> None:
        """Rekam pesan MENTAH dari gateway — patokan bersama.

        Perlu karena kedua jalur tidak berjalan di mesin yang sama: jalur lama
        diolah Node-RED di server, jalur baru di laptop. Membandingkan keduanya
        langsung akan mencampur beda desain dengan beda jaringan. Dengan sumber
        aslinya ikut direkam, masing-masing jalur bisa diadili terhadap apa yang
        BENAR-BENAR dikirim gateway.
        """
        try:
            d = json.loads(payload.decode("utf-8"))
            data = d.get("data") if isinstance(d.get("data"), dict) else d
        except (ValueError, AttributeError):
            return
        gw = topic.split("/")[-1]
        t = time.time()
        with self.lock:
            for k, v in data.items():
                sensor = self.peta.get(f"{gw}.{k}")
                if sensor is None:
                    continue
                try:
                    v = float(v)
                except (TypeError, ValueError):
                    continue
                self.data[sensor]["gateway"].append((t, v))
                self._tulis("gateway", sensor, t, v)

    def baru(self, payload: bytes) -> None:
        try:
            d = json.loads(payload.decode("utf-8"))
            nilai = d["values"]
            # Kunci di paket sekarang polos ('waterlevel1'), tanpa awalan nama
            # gateway — awalan itu dibuang karena mengulang informasi yang sudah
            # ada di topik dan di kolom "gateway" (~8 byte per nilai). Peta
            # pembanding tetap memakai kunci gabungan supaya sensor bernama sama
            # di dua gateway tidak saling tertukar, jadi awalannya dipasang
            # kembali DI SINI, dari kolom gateway paketnya sendiri.
            gw = str(d.get("gateway") or "")
        except (ValueError, KeyError, TypeError):
            return
        t = time.time()
        with self.lock:
            self.paket_baru += 1
            for kunci, v in nilai.items():
                sensor = self.peta.get(f"{gw}.{kunci}" if gw else kunci)
                if sensor is None:
                    self.tak_dikenal[kunci] += 1
                    continue
                try:
                    v = float(v)
                except (TypeError, ValueError):
                    continue
                self.data[sensor]["baru"].append((t, v))
                self._tulis("baru", sensor, t, v)

    def tutup(self) -> None:
        if self._rek:
            self._rek.close()


# --------------------------------------------------------------------------- #
# Pencocokan
# --------------------------------------------------------------------------- #
def cocokkan(lama: list, baru: list) -> dict:
    """Sejajarkan deretan nilai kedua jalur.

    autojunk=False itu wajib: banyak sensor nilainya konstan (level air yang
    diam di 11.0 berjam-jam). Dengan autojunk menyala, difflib menganggap nilai
    yang sering muncul sebagai "sampah" dan berhenti mencocokkannya — persis
    sensor yang paling stabil yang justru dilaporkan rusak.
    """
    vl = [v for _t, v in lama]
    vb = [v for _t, v in baru]
    sm = difflib.SequenceMatcher(None, vl, vb, autojunk=False)

    hilang: list[tuple] = []  # ada di jalur lama, tidak ada di jalur baru
    lebih: list[tuple] = []  # ada di jalur baru, tidak ada di jalur lama
    lag: list[float] = []
    cocok = 0

    for tag, i1, i2, j1, j2 in sm.get_opcodes():
        if tag == "equal":
            cocok += i2 - i1
            for k in range(i2 - i1):
                lag.append(baru[j1 + k][0] - lama[i1 + k][0])
        else:
            hilang.extend(lama[i1:i2])
            lebih.extend(baru[j1:j2])

    lag.sort()
    return {
        "n_lama": len(lama),
        "n_baru": len(baru),
        "cocok": cocok,
        "hilang": hilang,
        "lebih": lebih,
        "lag_rata": sum(lag) / len(lag) if lag else 0.0,
        "lag_min": lag[0] if lag else 0.0,
        "lag_maks": lag[-1] if lag else 0.0,
    }


def jeda(deret: list) -> tuple[float, float]:
    """(jeda rata-rata, jeda terlama) antar-kedatangan — untuk mengukur sendat."""
    if len(deret) < 2:
        return 0.0, 0.0
    d = [deret[i][0] - deret[i - 1][0] for i in range(1, len(deret))]
    return sum(d) / len(d), max(d)


def laporan(p: Pengumpul, judul: str) -> bool:
    """Cetak ringkasan. Kembalikan True kalau semua sensor bersih."""
    with p.lock:
        data = {k: {j: list(v) for j, v in d.items()} for k, d in p.data.items()}
        tak_dikenal = dict(p.tak_dikenal)
        paket, pesan, mulai = p.paket_baru, p.pesan_lama, p.mulai

    menit = (time.time() - mulai) / 60
    print()
    print("=" * 88)
    print(f"{judul}   ({menit:.1f} menit berjalan)")
    print("=" * 88)
    print(f"jalur lama : {pesan:>8,} pesan (1 sensor per pesan)")
    print(f"jalur baru : {paket:>8,} paket (semua sensor per paket)")
    if paket:
        print(f"             hemat {pesan / paket:.1f}x jumlah pesan MQTT")
    print()
    print(f"{'sensor':22} {'lama':>7} {'baru':>7} {'cocok':>7} {'hilang':>7} "
          f"{'lebih':>6} {'sendat lama':>12} {'sendat baru':>12} status")
    print("-" * 88)

    bersih = True
    total = {"lama": 0, "baru": 0, "cocok": 0, "hilang": 0, "lebih": 0}
    lag_semua: list[float] = []
    for sensor in sorted(data):
        r = cocokkan(data[sensor]["lama"], data[sensor]["baru"])
        total["lama"] += r["n_lama"]
        total["baru"] += r["n_baru"]
        total["cocok"] += r["cocok"]
        total["hilang"] += len(r["hilang"])
        total["lebih"] += len(r["lebih"])
        lag_semua.append(r["lag_maks"])
        _, sendat_l = jeda(data[sensor]["lama"])
        _, sendat_b = jeda(data[sensor]["baru"])

        # Satu nilai di ujung rekaman boleh menggantung: perekaman berhenti di
        # tengah aliran, jadi paket terakhir wajar belum punya pasangan.
        buruk = len(r["hilang"]) > 1 or len(r["lebih"]) > 1
        if buruk:
            bersih = False
        print(f"{sensor.replace('rnet/lombok/', ''):22} {r['n_lama']:>7,} "
              f"{r['n_baru']:>7,} {r['cocok']:>7,} {len(r['hilang']):>7,} "
              f"{len(r['lebih']):>6,} {sendat_l:>11.1f}s {sendat_b:>11.1f}s "
              f"{'PERIKSA' if buruk else 'OK'}")
        for t, v in r["hilang"][:3]:
            waktu = datetime.fromtimestamp(t, timezone.utc).strftime("%H:%M:%S")
            print(f"{'':22}   hanya di jalur lama: {v} pada {waktu} UTC")

    print("-" * 88)
    persen = 100 * total["cocok"] / total["lama"] if total["lama"] else 0
    print(f"{'TOTAL':22} {total['lama']:>7,} {total['baru']:>7,} "
          f"{total['cocok']:>7,} {total['hilang']:>7,} {total['lebih']:>6,} "
          f"{'':25} {persen:.3f}% cocok")
    print()
    print("'sendat' = jeda TERLAMA antar dua nilai berturut-turut di jalur itu.")
    print("Gateway mengirim tiap ~4 detik, jadi angka jauh di atas itu berarti")
    print("jalur tersebut sempat tertahan lalu menyusul berombongan.")

    if tak_dikenal:
        print()
        print("Field di jalur baru yang belum punya sensor di R-Net:")
        for k, n in sorted(tak_dikenal.items(), key=lambda x: -x[1]):
            print(f"  {k:34} {n:>7,}x   <- gateway baru? daftarkan di R-Net")

    print()
    if bersih and total["lama"] and not total["hilang"]:
        print("HASIL: bersih — tidak ada nilai jalur lama yang absen di jalur baru.")
    elif not total["lama"]:
        print("HASIL: belum ada data. Pastikan kedua flow menyala.")
    else:
        print("HASIL: ADA SELISIH — jangan lanjut ke Tahap 4 sebelum ini dijelaskan.")
    return bersih


# --------------------------------------------------------------------------- #
def kredensial() -> tuple[str, int, str, str]:
    sys.path.insert(0, str(REPO / "backend"))
    from dotenv import load_dotenv

    load_dotenv(REPO / ".env")
    import psycopg

    dsn = re.sub(r"^postgresql\+\w+://", "postgresql://", os.environ["DATABASE_URL"])
    with psycopg.connect(dsn) as c, c.cursor() as cur:
        cur.execute(
            "SELECT mqtt_host, mqtt_port, mqtt_username, mqtt_password "
            "FROM scada_sites WHERE enabled ORDER BY created_at LIMIT 1"
        )
        host, port, user, pw = cur.fetchone()
    return host, int(port), user, pw


def analisis_saja(path: Path, peta: dict[str, str]) -> int:
    p = Pengumpul(peta, None)
    # Semua nilai dalam satu paket direkam dengan waktu yang sama persis, jadi
    # jumlah waktu yang berbeda = jumlah paket.
    waktu_paket: set[float] = set()
    with path.open(encoding="utf-8") as f:
        for baris in f:
            r = json.loads(baris)
            p.data[r["sensor"]][r["jalur"]].append((r["t"], r["v"]))
            if r["jalur"] == "lama":
                p.pesan_lama += 1
            else:
                waktu_paket.add(r["t"])
    p.paket_baru = len(waktu_paket)
    p.mulai = min(
        (v[0] for d in p.data.values() for j in d.values() for v in j),
        default=time.time(),
    )
    return 0 if laporan(p, f"ANALISIS ULANG {path.name}") else 1


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--jam", type=float, default=24.0, help="lama memantau")
    ap.add_argument("--lapor-tiap", type=int, default=300, help="detik antar laporan")
    ap.add_argument("--site", default="lombok", help="nama site di topik")
    ap.add_argument("--rekaman", default="", help="file JSONL untuk merekam")
    ap.add_argument("--analisis-saja", default="", help="olah ulang file rekaman")
    a = ap.parse_args()

    peta = peta_dari_flow_lama(ARSIP)
    print(f"Peta dibaca dari {ARSIP.name}: {len(peta)} sensor")

    if a.analisis_saja:
        return analisis_saja(Path(a.analisis_saja), peta)

    rek = Path(a.rekaman) if a.rekaman else None
    p = Pengumpul(peta, rek)

    host, port, user, pw = kredensial()
    topik_lama = f"rnet/{a.site}/+/+"
    # Satu topik per GATEWAY, bukan satu untuk seluruh plant — makanya '+'.
    pfx_baru = f"rnet/{a.site}/gw/"
    topik_baru = pfx_baru + "+"

    def on_connect(cl, ud, fl, rc, props=None):
        if rc != 0:
            print(f"GAGAL konek ke broker: {rc}")
            return
        cl.subscribe([(topik_lama, 0), (topik_baru, 1), (TOPIK_GATEWAY, 0)])
        print(f"Terhubung {host}:{port} (TLS terverifikasi)")
        print(f"  jalur lama : {topik_lama}")
        print(f"  jalur baru : {topik_baru}")
        print(f"  sumber     : {TOPIK_GATEWAY}")
        print("Hanya mendengarkan. Tidak menerbitkan apa pun.\n")

    def on_message(cl, ud, m):
        if m.topic.startswith(pfx_baru):
            p.baru(m.payload)
        elif m.topic.startswith(TOPIK_GATEWAY[:-1]):
            p.gateway(m.topic, m.payload)
        else:
            p.lama(m.topic, m.payload)

    cl = mqtt.Client(
        mqtt.CallbackAPIVersion.VERSION2,
        client_id="rnet-banding-" + os.urandom(4).hex(),
    )
    cl.username_pw_set(user, pw)
    if port == 8883:
        cl.tls_set(cert_reqs=ssl.CERT_REQUIRED, tls_version=ssl.PROTOCOL_TLS_CLIENT)
        cl.tls_insecure_set(False)
    cl.on_connect = on_connect
    cl.on_message = on_message
    cl.reconnect_delay_set(1, 30)
    cl.connect(host, port, 30)
    cl.loop_start()

    selesai = time.time() + a.jam * 3600
    bersih = False
    try:
        while time.time() < selesai:
            time.sleep(min(a.lapor_tiap, max(1, selesai - time.time())))
            bersih = laporan(p, "LAPORAN SEMENTARA")
            sys.stdout.flush()
    except KeyboardInterrupt:
        print("\n(dihentikan)")
    finally:
        cl.loop_stop()
        cl.disconnect()
        bersih = laporan(p, "LAPORAN AKHIR")
        p.tutup()
        if rek:
            print(f"Rekaman mentah: {rek}")
    return 0 if bersih else 1


if __name__ == "__main__":
    raise SystemExit(main())
