# R-Net MQTT Bridge

Menyalurkan data sensor dari broker MQTT ke historian R-Net (Supabase).
Data yang masuk otomatis muncul di semua panel R-Net (Grafik, Gauge, Tabel,
Bar, Analisis) — **tidak ada database kedua**, semuanya masuk ke tabel
`scada_samples` yang sudah dipakai dashboard.

## Cara kerja singkat

```
Sensor/PLC → V-Box → Broker MQTT → [bridge.py] → Supabase (scada_samples) → R-Net
```

- Bridge membaca daftar **site** (broker) dan **tag** (topik) dari database —
  yang Anda atur lewat frontend R-Net (**Kelola Site** + kolom **Sumber** di
  tab Analisis). Bridge **tidak** perlu dikonfigurasi manual per topik.
- Setiap menit, nilai terbaru tiap tag ditulis satu baris (selaras menit).
  Menit tanpa pesan = kosong (bukan data palsu).
- Tambah topik baru di UI → bridge ikut subscribe dalam ~30 detik, **tanpa
  restart**.

## Yang diatur di frontend (bukan di sini)

Operator **tidak perlu membuka Supabase**. Semua lewat R-Net:

| Hal | Di mana |
|---|---|
| Tambah/ubah site + alamat broker + user/password | Dialog **Kelola Site** (tab Analisis) |
| Tambah topik / tag MQTT + ambang alarm | Baris di grid **Analisis**, kolom **Sumber** → MQTT |
| Aktif/nonaktifkan | Toggle di Analisis |

## Yang diatur di sini (sekali saat pasang)

Bridge hanya butuh **satu** hal: `DATABASE_URL`.

```bash
cp .env.example .env
# edit .env → isi DATABASE_URL dari Supabase (Transaction pooler, port 6543).
# Bridge sudah memakai prepare_threshold=None sehingga aman di pooler 6543.
pip install -r requirements.txt
```

## Menjalankan

**Tes lokal (Windows):**
```
start-bridge.bat
```
Jendela tetap terbuka selama bridge jalan. Ctrl+C untuk berhenti. Bukan
autostart/service (sesuai preferensi: laptop pribadi = saklar manual).

**Server klien (Linux, systemd):**
```bash
sudo cp -r . /opt/rnet-mqtt-bridge
cd /opt/rnet-mqtt-bridge
python3 -m venv venv && venv/bin/pip install -r requirements.txt
cp .env.example .env    # isi DATABASE_URL
sudo cp rnet-mqtt-bridge.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now rnet-mqtt-bridge
journalctl -u rnet-mqtt-bridge -f
```

## Uji cepat tanpa perangkat asli

Dengan broker (mis. Mosquitto) berjalan dan sebuah tag MQTT bertopik
`rnet/tes/dev1/suhu` sudah dibuat di R-Net:

```bash
mosquitto_pub -h <broker> -t rnet/tes/dev1/suhu -m '{"value": 75.2}'
```

Tunggu ≤1 menit → nilai muncul di Analisis (sel Terkini) dan panel Grafik.

## Format payload dari perangkat

- **Topik:** persis yang Anda isi di kolom topik tag, mis.
  `rnet/tanobel/boiler1/temperature`
- **Payload:** `{"value": 72.5, "ts": "2026-07-07T10:00:00Z"}` (`ts` opsional).
  Angka polos (`72.5`) juga diterima.

## Tahan banting

- Broker putus → sambung ulang otomatis + subscribe ulang.
- Database down → nilai ditahan, dicoba lagi menit berikutnya.
- Payload rusak → dilewati + dicatat di log.
- Error tak terduga → dicatat, loop tetap jalan (tidak crash).
