# Arsitektur Data R-Net — Sekarang vs Seharusnya

**Tanggal:** 26 Juli 2026 · **Basis kode:** commit `d7cfd72` + perubahan belum di-commit

**Isi dokumen ini:**
- **Bagian 1 "Sekarang"** — alur data dari sensor sampai tersimpan, **persis seperti yang
  ada di kode saat ini**. Setiap tahap disebut nama file dan nama tabelnya.
- **Bagian 2 "Seharusnya"** — usulan arsitektur data time-series yang pas untuk kebutuhan
  ini, termasuk jawaban soal ekstensi TimescaleDB di Supabase.

Dokumen ini **usulan, bukan perubahan**. Tidak ada satu pun file kode yang diubah.
Temuan bernomor D-1..D-12 yang dirujuk di sini ada di [docs/AUDIT-DATA.md](docs/AUDIT-DATA.md).

Ditulis untuk dibaca tanpa latar belakang programming. Istilah teknis yang tak
terhindarkan selalu diberi analogi.

---
---

# BAGIAN 1 — SEKARANG

## 1.1 Diagram besar: dari sensor sampai layar

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  DI PABRIK (lapangan)                                                       │
└─────────────────────────────────────────────────────────────────────────────┘

   [SENSOR / PLC]
        │  kabel / Modbus
        ▼
   [V-Box Wecon]  atau  [Node-RED di PC]
   Node-RED: deploy/data/node-red/flow-line1.json
             deploy/data/node-red/flow-modbus-template.json
        │
        │  publish  →  topik, mis. "rnet/tanobel/boiler1/temperature"
        │              isi pesan: {"value": 72.5}
        ▼
   [BROKER MQTT]  ← ada di VPS, BUKAN di PC pabrik
        │             (port 8883 = terenkripsi)
        │
        │  subscribe
        ▼
   ┌──────────────────────────────────────────────────────┐
   │  bridge.py — "petugas pencatat"                      │
   │  Berkas: deploy/data/bridge.py                       │
   │  Dijalankan: start.bat data  →  run-bridge.ps1       │
   │  Kredensial: deploy/config.env  (hanya DATABASE_URL) │
   └──────────────────────────────────────────────────────┘
        │
        │  ══════ 4 aliran keluar, beda tujuan, beda kecepatan ══════
        │
   ┌────┴─────┬──────────────┬───────────────┬────────────────┐
   ▼          ▼              ▼               ▼                ▼
[tiap 1 dtk] [tiap periode] [tiap periode]  [tiap 15 dtk]  [tiap 60 dtk]
 timpa        simpan          simpan          lapor hidup    HAPUS yang
 nilai kini   (ring)          (arsip)                        > 24 jam
   │            │               │               │                │
   ▼            ▼               ▼               ▼                ▼
scada_tag_   scada_ring     scada_samples   scada_bridge_    (menghapus
  latest                                      status         dari
                                                             scada_ring)

┌─────────────────────────────────────────────────────────────────────────────┐
│  DI CLOUD (Supabase / Postgres)                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

## 1.2 Tahap demi tahap, dengan nama file dan tabel

### Tahap 1 — Pesan masuk dari broker

**Berkas:** `deploy/data/bridge.py`, fungsi `_on_message` (baris 485)

Yang terjadi berurutan untuk **setiap** pesan yang masuk:

| Urutan | Yang dilakukan | Di mana |
|---|---|---|
| 1 | Cek: topik ini milik sensor mana? | `_routes` (peta di memori, isinya dari database) |
| 2 | Baca angkanya (terima `{"value": 72.5}` atau angka polos) | `_coerce_value` (baris 200) |
| 3 | Kalikan/geser sesuai setelan skala sensor | `_apply_transform` (baris 245) |
| 4 | **Tulis ke cadangan harddisk PC dulu** | `_buffer_put` → file `bridge_buffer.db` (SQLite lokal) |
| 5 | Baru simpan di ingatan | `_pending` + `_latest_pending` (memori) |

Langkah 4 itu jaring pengaman kalau PC mati mendadak. **Catatan penting:** cadangan itu
hanya menyimpan **satu nilai terakhir per sensor** (nilai baru menimpa yang lama) —
jadi kalau database mati satu jam, yang selamat cuma nilai terakhir, bukan satu jam data.
Ini temuan **D-9**.

### Tahap 2 — Empat aliran keluar dari bridge

#### Aliran A — "papan skor" (angka hidup di layar)

| | |
|---|---|
| **Berkas** | `deploy/data/bridge.py` → `flush_latest()` (baris 670) |
| **Kapan** | tiap ±1 detik |
| **Tabel tujuan** | **`scada_tag_latest`** |
| **Bentuk** | 1 baris per sensor, **ditimpa terus** (tidak pernah menumpuk) |
| **Cara tulis** | borongan (`executemany`) dengan "kalau sudah ada, timpa" |
| **Dipakai siapa** | angka besar di layar (lewat Supabase Realtime), mesin alarm, monitor kesehatan |

#### Aliran B — riwayat mode "ring" (Simpan data TIDAK dicentang)

| | |
|---|---|
| **Berkas** | `deploy/data/bridge.py` → `flush()` (baris 583) |
| **Kapan** | saat periode sensor habis (2 / 5 / 30 / 60 detik, sesuai *sampling level*) |
| **Tabel tujuan** | **`scada_ring`** |
| **Analogi** | kartu SD CCTV — isinya 24 jam terakhir, sisanya ditimpa |
| **Cara tulis** | borongan, "kalau baris itu sudah ada, lewati saja" |
| **Aturan penting** | periode yang tidak ada pesannya = **dibiarkan kosong**, bukan diisi nilai palsu |

#### Aliran C — riwayat mode "arsip" (Simpan data DICENTANG)

| | |
|---|---|
| **Berkas** | sama, `flush()` — hanya tabel tujuannya beda |
| **Tabel tujuan** | **`scada_samples`** |
| **Analogi** | lemari arsip — dikumpulkan 1 bulan, diekspor ke Drive, lalu dikosongkan |

#### Aliran D — detak jantung

| | |
|---|---|
| **Berkas** | `deploy/data/bridge.py` → `heartbeat()` (baris 701) |
| **Kapan** | tiap 15 detik |
| **Tabel tujuan** | **`scada_bridge_status`** |
| **Isinya** | "bridge site ini masih hidup, broker tersambung/tidak, terakhir lapor kapan" |

### Tahap 3 — Pembersihan otomatis oleh bridge

| | |
|---|---|
| **Berkas** | `deploy/data/bridge.py` → `prune_ring()` (baris 657) |
| **Kapan** | tiap 60 detik |
| **Perintahnya** | `DELETE FROM scada_ring WHERE ts < (sekarang − 24 jam)` |
| **Masalahnya** | tabel tidak punya index waktu → database **menyisir seluruh tabel** tiap menit (**D-2**); dan perintah ini tidak dibatasi per pabrik, jadi 50 PC melakukannya bersamaan ke tabel yang sama (**D-3**) |

### Tahap 4 — Bridge membaca ulang konfigurasinya

| | |
|---|---|
| **Berkas** | `deploy/data/bridge.py` → `load_config()` (baris 412), `reconcile()` (baris 531) |
| **Kapan** | tiap 30 detik |
| **Tabel yang dibaca** | **`scada_settings`** (durasi 4 level sampling + jendela ring), **`scada_sites`** (daftar broker + password), **`scada_tags`** (daftar topik + skala + ambang alarm) |
| **Gunanya** | tambah sensor di layar R-Net → bridge ikut mendengarkan dalam ±30 detik, tanpa restart |
| **Masalahnya** | mengambil **semua** site, bukan hanya site PC itu. Tidak ada setelan `SITE_ID` di `deploy/config.env` → tiap PC menyambung ke semua broker dan menulis data semua pabrik (**D-4**) |

### Tahap 5 — Jalur data internal (simulator) — biasanya MATI

| | |
|---|---|
| **Berkas** | `backend/app/services/historian.py` |
| **Status** | **default mati** (`HISTORIAN_SIMULATOR=0`) |
| **Kalau nyala** | menulis nilai buatan berbentuk gelombang ke `scada_ring`/`scada_samples` tiap 60 detik, dan melewati sensor sumber "mqtt" supaya tidak bentrok dengan bridge |

### Tahap 6 — Bagaimana data itu dibaca kembali

```
                  scada_ring          scada_samples
                      │                     │
                      └──────── UNION ──────┘
                                 │
                                 ▼
                     scada_samples_all
                     ← BUKAN tabel. Ini "kaca pengintip" yang
                       menampilkan isi dua tabel sekaligus, supaya
                       setiap endpoint tidak perlu tahu data itu
                       ada di lemari mana.
                       Dibuat di: db/alembic/versions/
                                  e5f6g7h8i9j0_rnet_storage_redesign.py
                                 │
     ┌───────────────┬───────────┼──────────────┬────────────────┐
     ▼               ▼           ▼              ▼                ▼
 /tags/{id}/     /tags/{id}/  /history     /summary        /sparklines
   recent          samples    (grafik)     (gauge)         (mini-grafik)
 maks 500 baris  maks 5.000/  maks 4 tag   maks 60 tag     ✘ TANPA BATAS
                 halaman      720 titik    cache 45 dtk    JUMLAH TAG (D-6)
                              45 hari
     └──────────── semuanya di: backend/app/routers/scada.py ─────────────┘

 scada_tag_latest ──► /latest (maks 100 tag)  ── backend/app/routers/scada_alarms.py
                 └──► Supabase Realtime ──► browser
                      ✘ browser berlangganan SELURUH tabel tanpa saringan
                        (frontend/src/features/scada/analysis/use-live-samples.ts)
```

**Satu detail yang mudah terlewat:** tabel `scada_samples` **ikut disiarkan** lewat
Supabase Realtime (dimasukkan ke publikasi `supabase_realtime` di migrasi
`q1r2s3t4u5v6_add_workbench_columns_rls_realtime.py` baris 68, dan tidak pernah
dikeluarkan lagi). Artinya setiap baris arsip yang masuk ikut diproses mesin siaran,
padahal tidak ada layar yang membutuhkannya — pemborosan yang tidak kelihatan.
`scada_ring` sengaja **tidak** disiarkan (keputusan yang benar).

### Tahap 7 — Reset & arsip bulanan

| | |
|---|---|
| **Berkas** | `backend/app/services/archiver.py`, dibantu `backend/app/services/gdrive.py` dan `email_notifier.py` |
| **Kapan** | tiap 6 jam memeriksa: ada sensor yang siklus 1 bulannya habis? |
| **Urutan** | ① pasang klaim di **`scada_tag_archives`** → ② tarik seluruh data siklus sensor itu → ③ susun **satu file Excel per SENSOR** di memori → ④ unggah ke Google Drive (`R-Net Arsip/<tahun>/`) → ⑤ kirim email berlampiran → ⑥ **BARU** hapus baris sensor itu dari `scada_samples` → ⑦ setel ulang jam pasirnya |
| **Aturan emas** | **tidak ada arsip sukses → tidak ada penghapusan.** Ini benar dan harus dipertahankan |
| **Masalahnya** | satu file per sensor per bulan; seluruh data ditarik ke memori sekaligus; sensor 2 detik selama 1 bulan = 1,3 juta baris → **melewati batas fisik Excel (1.048.576 baris)** (**D-7**) |

### Tahap 8 — Tiga proses latar lain di server

| Proses | Berkas | Tiap | Membaca | Menulis |
|---|---|---|---|---|
| Mesin alarm | `backend/app/services/alarm_engine.py` | 5 detik | `scada_tag_latest`, `scada_tags`, `scada_samples_all` (jalur cadangan, **N+1** → D-12) | `scada_alarm_events` |
| Monitor kesehatan | `backend/app/services/health_monitor.py` | 60 detik | `scada_bridge_status`, `scada_tag_latest` | — (kirim Telegram/email) |
| Pemantau akses data | `backend/app/services/data_access_monitor.py` | tiap permintaan besar | `scada_data_access_log` | `scada_data_access_log` |

## 1.3 Ringkasan Bagian 1 dalam satu tabel

| Tahap | Berkas | Tabel yang disentuh |
|---|---|---|
| Sensor → broker | `deploy/data/node-red/flow-*.json` | — |
| Broker → bridge | `deploy/data/bridge.py` (`_on_message`) | — (+ `bridge_buffer.db` lokal) |
| Angka hidup | `bridge.py` (`flush_latest`) | `scada_tag_latest` |
| Riwayat 24 jam | `bridge.py` (`flush`) | `scada_ring` |
| Riwayat arsip | `bridge.py` (`flush`) | `scada_samples` |
| Detak jantung | `bridge.py` (`heartbeat`) | `scada_bridge_status` |
| Buang data > 24 jam | `bridge.py` (`prune_ring`) | `scada_ring` |
| Baca konfigurasi | `bridge.py` (`load_config`) | `scada_settings`, `scada_sites`, `scada_tags` |
| Simulator (mati) | `backend/app/services/historian.py` | `scada_ring`, `scada_samples` |
| Dibaca dashboard | `backend/app/routers/scada.py` | `scada_samples_all` (= ring ∪ samples) |
| Nilai terakhir | `backend/app/routers/scada_alarms.py` | `scada_tag_latest` |
| Arsip + reset | `backend/app/services/archiver.py` | `scada_samples` → Drive, `scada_tag_archives` |
| Alarm | `backend/app/services/alarm_engine.py` | `scada_alarm_events` |

**Kesimpulan Bagian 1:** semua data dari semua pabrik, semua sensor, sepanjang waktu,
masuk ke **dua tabel besar** (`scada_ring` dan `scada_samples`) yang **tidak dibagi
berdasarkan waktu maupun pabrik**. Baris datanya bahkan tidak menyimpan identitas
pabrik — hanya (nomor sensor, waktu, nilai). Inilah akar dari hampir semua masalah
skala di audit sebelumnya.

---
---

# BAGIAN 2 — SEHARUSNYA

## 2.1 Gagasan intinya, satu paragraf

Data sensor punya sifat yang khas: **yang baru dilihat detail, yang lama cukup
ringkasan.** Tidak ada yang butuh nilai per-2-detik dari bulan lalu; yang dibutuhkan
adalah "rata-rata, tertinggi, dan terendah per menit". Jadi jangan simpan semuanya
dengan detail yang sama. Simpan **detail penuh hanya 24 jam**, lalu **ringkas jadi
1 baris per menit** dan simpan ringkasan itu 30 hari, lalu **pindahkan ke Excel di
Google Drive** dan buang dari database.

Dan supaya "membuang" itu murah: **bagi tabelnya per waktu (partisi)**, sehingga
membuang data lama = membuang satu laci utuh, bukan mencabut lembar satu-satu.

## 2.2 Diagram usulan

```
   SENSOR → V-Box/Node-RED → BROKER MQTT
                                  │
                                  ▼
                        ┌──────────────────┐
                        │    bridge.py     │  ← hanya 1 perubahan wajib:
                        │  (PC per pabrik) │    SITE_ID, supaya PC ini
                        └──────────────────┘    hanya urus brokernya sendiri
                                  │
                    ┌─────────────┴──────────────┐
                    ▼                            ▼
         ┌──────────────────┐        ┌────────────────────────────┐
         │ scada_tag_latest │        │  scada_raw   (data mentah) │
         │  PAPAN SKOR      │        │  ── dibagi per HARI ──     │
         │  1 baris/sensor  │        │  raw_2026_07_26            │
         │  ditimpa terus   │        │  raw_2026_07_27  ← hari ini│
         │  → angka hidup   │        │  raw_2026_07_28            │
         └──────────────────┘        │  simpan 24 jam saja        │
                                     └────────────────────────────┘
                                                  │
                                     ┌────────────┴─────────────┐
                                     │ TUKANG RINGKAS           │
                                     │ tiap 1 menit, baca hanya │
                                     │ menit yang baru selesai  │
                                     └────────────┬─────────────┘
                                                  ▼
                                  ┌────────────────────────────────┐
                                  │ scada_rollup_1m  (RINGKASAN)   │
                                  │ ── dibagi per BULAN ──         │
                                  │ rollup_2026_06                 │
                                  │ rollup_2026_07  ← bulan ini    │
                                  │ 1 baris per sensor per menit:  │
                                  │ rata2 · min · maks · jumlah    │
                                  │ + id pabrik                    │
                                  │ simpan 30 hari                 │
                                  └────────────────────────────────┘
                                                  │
                                     ┌────────────┴─────────────┐
                                     │ TUKANG ARSIP             │
                                     │ akhir bulan, PER PABRIK  │
                                     └────────────┬─────────────┘
                                                  ▼
                              ┌───────────────────────────────────────┐
                              │  GOOGLE DRIVE                         │
                              │  R-Net Arsip/2026/                    │
                              │    Pabrik-Tanobel-2026-07.xlsx        │
                              │      ├─ sheet "Suhu Boiler 1"         │
                              │      ├─ sheet "Tekanan Line 2"        │
                              │      └─ sheet … (1 sheet per sensor)  │
                              │    Pabrik-Cikarang-2026-07.xlsx       │
                              │    … 1 file per pabrik per bulan      │
                              └───────────────────────────────────────┘
                                                  │
                                    setelah SEMUA pabrik terkonfirmasi
                                                  ▼
                                  BUANG LACI rollup_2026_06  ← INSTAN
                                  (bukan hapus baris satu-satu)
```

## 2.3 Empat lapis penyimpanan — apa, berapa lama, buat apa

| Lapis | Tabel | Detail | Umur simpan | Dipakai untuk |
|---|---|---|---|---|
| 1. Papan skor | `scada_tag_latest` (sudah ada) | 1 baris/sensor | selamanya (ditimpa) | angka hidup, alarm |
| 2. Mentah | `scada_raw` (baru, gabungan `scada_ring`+`scada_samples`) | asli, 2–60 detik | **24 jam** | grafik hari ini, zoom detail, investigasi kejadian |
| 3. Ringkasan | `scada_rollup_1m` (baru) | 1 baris/sensor/menit: rata²·min·maks·jumlah | **30 hari** | grafik mingguan/bulanan, gauge, mini-grafik, laporan |
| 4. Arsip | file Excel di Google Drive | ringkasan per menit | selamanya | audit, analisis kuartal/tahun, bukti ke klien |

**Perubahan konsep terpenting:** sekarang ada **dua** lemari mentah (`scada_ring` untuk
"tidak disimpan", `scada_samples` untuk "disimpan") yang dibedakan oleh centang per
sensor. Dalam usulan ini centang itu **tidak perlu lagi** — **semua** sensor otomatis
dapat perlakuan sama: mentah 24 jam, ringkasan 30 hari, lalu arsip. Satu jalur, tidak
ada lagi kebingungan "kok data sensor ini hilang, sensor itu tidak".

### ✅ TERPASANG (30 Juli 2026)

Bagian ini bukan usulan lagi. `scada_ring` dihapus di migrasi `m3n4o5p6q7r8`
(27 Juli) dan **`scada_samples` dipensiunkan** di `p6q7r8s9t0u1` (30 Juli),
bersama centang "Simpan data" di UI, jalur arsip xlsx per siklus, jam siklus
per sensor, dan batasan slow/slowest.

Saat diperiksa sebelum dieksekusi, lajur `scada_samples` ternyata **sudah kosong**
(0 baris, 0 tag bercentang) — jadi tidak ada arsip final atau migrasi data yang
diperlukan. Migrasinya berpagar `count(*) = 0`: dijalankan di database lain yang
masih berisi, ia menolak alih-alih menghapus.

Yang sekarang berlaku untuk **setiap** sensor, tanpa pilihan:

| Lapis | Tabel | Umur |
|---|---|---|
| Papan skor | `scada_tag_latest` | ditimpa terus |
| Mentah | `scada_raw` (partisi harian) | `ring_window_h`, nyatanya 1-2× itu |
| Ringkasan | `scada_rollup_1m` (partisi bulanan) | ±30 hari |
| Arsip | `.zip` CSV per plant di Google Drive | selamanya |

Keempat level sampling kini sah untuk semua sensor — batasan slow/slowest dulu
ada semata-mata agar sebulan baris muat di satu sheet Excel milik arsip lajur
yang sekarang sudah tidak ada.

**Export ikut jadi CSV (30 Juli 2026).** `GET /api/scada/export` (dulu
`/export.xlsx`) mengirim satu `.csv` untuk satu sensor, atau `.zip` berisi satu
CSV per sensor untuk beberapa sensor — kolomnya sama persis dengan arsip Drive
di §2.6, jadi berkas dari dua sumber itu bisa ditumpuk tanpa penyesuaian.
Alasannya sama dengan yang sudah ditulis di §2.6 untuk arsip: xlsx harus
membangun tiap sel, CSV mengalir apa adanya dan mampat ~8-10×. Dengan itu
`openpyxl` (backend) dan SheetJS/`xlsx` (bundle frontend) sama-sama keluar.

## 2.4 Kenapa membagi tabel per waktu (partisi) itu kuncinya

Analogi lemari arsip:

```
SEKARANG — satu lemari raksasa, semua tercampur
┌──────────────────────────────────────────────────┐
│ 17 juta lembar, semua pabrik, semua tanggal      │
└──────────────────────────────────────────────────┘
  "Buang yang lebih tua dari 24 jam"
  → petugas harus membuka SEMUA 17 juta lembar,
    cek tanggalnya satu-satu, cabut yang lama.
  → dilakukan TIAP MENIT. Oleh 50 petugas sekaligus.
  → lubang bekas lembar yang dicabut harus dibereskan
    petugas lain (autovacuum) yang selalu ketinggalan
    → lemari makin gembung, semua pencarian ikut lambat.

SEHARUSNYA — satu laci per hari
┌────────┐ ┌────────┐ ┌────────┐
│ 26 Jul │ │ 27 Jul │ │ 28 Jul │  ← hari ini
└────────┘ └────────┘ └────────┘
  "Buang yang lebih tua dari 24 jam"
  → ANGKAT LACI 26 JULI, BUANG UTUH. Selesai.
  → hitungan milidetik, tidak peduli isinya 17 juta
    atau 170 juta lembar.
  → tidak ada lubang, tidak ada gembung, tidak ada
    pekerjaan bersih-bersih.
```

Dalam istilah database: `DROP TABLE partisi_lama` (instan) menggantikan
`DELETE FROM ... WHERE ts < ...` (menyisir semuanya + meninggalkan sampah).

Ini menyelesaikan **D-1, D-2, D-3**, dan sebagian **D-8** sekaligus.

**Pembagiannya:**

| Tabel | Dibagi per | Jumlah laci hidup | Cara buang |
|---|---|---|---|
| `scada_raw` | **hari** (atau jam kalau volumenya besar) | 2–3 laci | buang laci tertua tiap hari |
| `scada_rollup_1m` | **bulan** | 2 laci (bulan ini + bulan lalu) | buang laci bulan lalu **setelah** arsip Excel terkonfirmasi |

## 2.5 Siapa yang membuat ringkasan per menit

Tiap 1 menit, satu tugas kecil berjalan:

```
  Ambil data mentah HANYA untuk menit yang baru selesai
  (mis. 10:35:00 – 10:35:59)
        │
        ▼
  Kelompokkan per sensor → hitung rata², min, maks, dan
  berapa banyak nilai yang tercatat
        │
        ▼
  Tulis ke scada_rollup_1m (kalau baris itu sudah ada, lewati)
```

Kuncinya: tugas ini **hanya menyentuh 1 menit data**, bukan seluruh tabel. Untuk 1.000
sensor itu ±12.000 baris dibaca → jadi ±1.000 baris ringkasan. Ringan, dan bebannya
**tetap ringan** walau data historis sudah bertahun-tahun — karena yang dibaca selalu
cuma satu menit terakhir dari laci hari ini.

Kolom `jumlah` (berapa nilai tercatat dalam menit itu) penting: dari situ ketahuan
menit mana sensornya bolong tanpa harus menyimpan lubangnya.

**Siapa yang menjalankan?** Dua pilihan, keduanya sudah tersedia:

| Pilihan | Caranya | Kelebihan | Kekurangan |
|---|---|---|---|
| **A. Di dalam database** — `pg_cron` | jadwal di Postgres, agregasi tak keluar dari database | paling hemat (data tidak lalu-lalang), tetap jalan walau backend restart | perlu ekstensi `pg_cron` aktif di Supabase (cek Dashboard → Database → Extensions) |
| **B. Di backend** — loop latar | pola yang **sudah dipakai** proyek ini (`historian_loop`, `alarm_loop`, `archiver_loop` di `backend/app/main.py`) | tak perlu ekstensi apa pun, mudah diuji, konsisten dengan kode yang ada | mati kalau backend mati; data lewat jaringan |

**Rekomendasi saya: mulai dengan B** (konsisten dengan arsitektur sekarang, nol
dependensi baru), lalu pindah ke A kalau volumenya menuntut. Beda biayanya kecil.

## 2.6 Arsip per pabrik ke Google Drive

Yang diminta: **satu file Excel per pabrik, satu sheet per sensor.** Ini kebetulan
sekaligus menyelesaikan bom Excel (**D-7**). Hitungannya:

| | Cara sekarang (per sensor, data mentah) | Usulan (per pabrik, data ringkasan) |
|---|---|---|
| Baris per sheet | sensor 2 detik × 1 bulan = **1.296.000** | 1 menit × 30 hari = **43.200** |
| Batas Excel | 1.048.576 → **TERLAMPAUI, file rusak** | ✔ aman, 4% dari batas |
| Jumlah file per bulan | 1.000 file (1 per sensor) | **50 file** (1 per pabrik) |
| Isi satu file | 1 sensor | 20 sensor = 20 sheet, semua konteks satu pabrik dalam satu file |

Alur arsipnya (mempertahankan aturan emas yang sudah benar):

```
  Awal bulan, untuk SETIAP pabrik:

  ① Pasang klaim di buku induk  ──────────► scada_plant_archives
     (pabrik + bulan). Sudah ada klaim?      (pengganti scada_tag_archives;
      → pabrik ini sudah/sedang dikerjakan,   pola yang sama, satuannya
        lewati. Aman walau 2 server jalan.    pabrik-bulan, bukan sensor-siklus)

  ② Buat file Excel SECARA MENGALIR:
     untuk setiap sensor pabrik itu
       → buka sheet baru dengan nama sensor
       → baca ringkasannya bertahap (mis. 50.000 baris sekali ambil)
       → tulis langsung ke file di disk sementara
     ← "mengalir" = tidak menumpuk semuanya di memori dulu
       (ini yang sekarang jadi masalah di archiver.py)

  ③ Unggah ke Google Drive (unggah bertahap/resumable)
     R-Net Arsip/2026/Pabrik-Tanobel-2026-07.xlsx

  ④ Catat id file Drive di buku induk  = TANDA SELESAI & TERVERIFIKASI

  ⑤ Kirim email ke penerima (opsional, best-effort — gagal email
     tidak menggagalkan apa pun, seperti sekarang)

  ══════════════════════════════════════════════════════════
  ⑥ HANYA setelah SEMUA pabrik bulan itu punya tanda selesai:
     BUANG LACI rollup bulan itu.  ← instan

     Kalau ada SATU pabrik saja yang gagal, laci TIDAK dibuang.
     Datanya cuma menumpuk sampai percobaan berikutnya berhasil.
     TIDAK ADA DATA YANG HILANG.
```

Aturan **"tidak ada arsip sukses → tidak ada penghapusan"** dari `archiver.py` sekarang
dipertahankan utuh — hanya satuannya naik dari *sensor* jadi *pabrik-bulan*, dan
penghapusannya berubah dari mencabut baris jadi membuang laci.

### ✅ TERPASANG (28 Juli 2026) — dengan dua penyesuaian

Rancangan di atas sekarang benar-benar berjalan. Nama sebenarnya di kode:

| Di rancangan ini | Di kode |
|---|---|
| buku induk `scada_plant_archives` | tabel **`scada_rollup_archives`** (migrasi `n4o5p6q7r8s9`) |
| pembuat arsip | **`backend/app/services/rollup_archiver.py`** |
| pembuang laci | `partitions.drop_expired_rollup` — gerbang ⑥ ada di sini |
| tombol manual | `POST /api/scada/rollup-archives/run`, daftar: `GET /api/scada/rollup-archives` |

**Penyesuaian 1 — formatnya `.zip` berisi CSV, bukan `.xlsx`.** Tabel di atas
menghitung satu pabrik = 20 sensor. Pada klien 300 sensor angkanya jadi 300
sheet × 43.200 baris = **13 juta sel dalam satu file**; sebagai xlsx itu ratusan
MB dan setiap selnya harus dibangun openpyxl. Satu CSV per sensor di dalam zip
mengalir apa adanya, mampat ~8–10× (kolom ringkasan sangat berulang), dan tetap
bisa dibuka Excel, Sheets, atau pandas. Satu file per pabrik tetap dipertahankan.

**Penyesuaian 2 — pengelompokan pabrik dibaca dari `scada_tags`, bukan dari kolom
`site_id` di baris ringkasan.** Kolom itu dicap saat baris ditulis, jadi sensor
yang pernah pindah pabrik punya baris lama bercap pabrik lama. Kalau
pengelompokan memakai cap tersebut, baris-baris itu masuk ke keranjang yang tak
pernah didatangi siapa pun — tidak ikut diarsipkan, dan gerbang ⑥ menunggu
selamanya. Dengan membaca peta pabrik yang berlaku sekarang, setiap baris pasti
tersentuh (FK `tag_id` ON DELETE CASCADE menjamin tiap baris punya sensor hidup).

**Retensi akhirnya menyala.** `ROLLUP_KEEP_MONTHS` naik dari `0` (simpan selamanya
— karena dulu belum ada arsipnya) jadi `1`, artinya ringkasan hidup 30–61 hari.
Angka itu bukan pengamannya; pengamannya tetap gerbang ⑥.

## 2.7 Bagaimana dashboard membaca data setelah perubahan ini

Sekarang semua endpoint membaca satu "kaca pengintip" `scada_samples_all`. Usulannya:
kaca itu diganti aturan sederhana **berdasarkan rentang waktu yang diminta**:

```
   Permintaan grafik masuk: "sensor X, dari kapan sampai kapan?"
                       │
        ┌──────────────┴───────────────┐
        ▼                              ▼
  Seluruhnya di dalam           Ada bagian yang lebih
  24 jam terakhir?              lama dari 24 jam?
        │                              │
        ▼                              ▼
   Ambil dari                    Ambil dari
   scada_raw                     scada_rollup_1m
   (detail asli)                 (ringkasan/menit)
        │                              │
        └──────────────┬───────────────┘
                       ▼
              Kirim ke browser
```

### ✅ KLARIFIKASI (30 Juli 2026) — aturan ini bukan untuk penggambaran grafik

Pohon keputusan di atas berlaku untuk **export CSV** dan **pembacaan di tab
Riwayat**: di sana rentangnya bebas, jadi memang perlu memilih lajur.

Untuk **grafik di tab Data**, aturannya lebih sederhana karena rentangnya
dibatasi: pilihan berhenti di **24 jam** (7 hari dan 30 hari dihapus dari
selektor). Di dalam 24 jam nilai mentahnya selalu ada, jadi grafik di sana
selalu membaca `scada_raw` — tidak ada yang perlu diputuskan. Rentang panjang
tetap tersedia di panel **Monitor**, yang memang membaca ringkasan.

Satu jebakan yang sempat aktif dan sekarang dikunci tes
(`backend/tests/test_data_tab_lane.py`): pemilihan lajur di `/history`
memakai **lebar bucket**, bukan rentang. Dengan jatah 360 titik, 24 jam jadi
bucket 240 detik — melewati ambang 60 detik — sehingga grafik 24 jam diam-diam
dijawab dari ringkasan. Sulit terlihat karena pada lebar bucket yang sama kedua
lajur mengembalikan angka **identik** (rata-rata tertimbang, min-dari-min,
maks-dari-maks); yang hilang cuma detailnya. Jatah titik tab Data kini 1800
(bucket 48 detik) dan plafon `MAX_HISTORY_POINTS` dinaikkan 720 → 2000, karena
di bawah 1.465 titik sub-menit di 24 jam mustahil diminta.

Dampaknya per endpoint:

| Endpoint | Sekarang | Setelah usulan |
|---|---|---|
| `/latest` | `scada_tag_latest` | tidak berubah ✔ |
| `/tags/{id}/recent`, `/samples` | jendela gabungan | `scada_raw` (≤24 jam) atau `scada_rollup_1m` |
| `/history` (grafik) | agregasi mahal di jendela gabungan | langsung dari `scada_rollup_1m` — **sudah teragregasi**, tinggal ambil. Jauh lebih murah |
| `/summary` (gauge) | `DISTINCT ON` mahal (**D-11**) | nilai terakhir dari `scada_tag_latest`, min/maks/rata² dari `scada_rollup_1m` |
| `/sparklines` | semua sensor, tanpa batas, tanpa cache (**D-6**) | dari `scada_rollup_1m` + batas jumlah sensor + cache seperti `/summary` |

Efek sampingnya menyenangkan: **grafik jadi lebih cepat, bukan sekadar lebih hemat.**
Sekarang grafik 30 hari harus meringkas 43 ribu baris mentah **setiap kali dibuka**;
setelah ini ringkasannya sudah jadi, tinggal diambil.

Dua perbaikan kecil yang ikut sekalian:
- **Keluarkan `scada_samples`/`scada_raw` dari siaran Realtime** — tidak ada layar yang
  butuh siaran baris riwayat.
- **Saring langganan Realtime di browser** supaya hanya menerima sensor yang sedang
  ditampilkan, bukan semua 1.000 sensor (bagian dari **D-6**).

## 2.8 Perkiraan ukuran setelah perubahan

Asumsi: 50 pabrik × 20 sensor = 1.000 sensor, level "Fast" (5 detik).

| | Sekarang | Usulan |
|---|---|---|
| Tabel mentah | `scada_ring` 17 juta baris (±1,5–2 GB) + churn hapus berat | `scada_raw` 17 juta baris (±2 GB), dibuang per laci — **tanpa churn** |
| Tabel arsip | `scada_samples` sampai **86 juta baris (±9–10 GB)** menjelang reset | `scada_rollup_1m` 30 hari = **43 juta baris (±4–5 GB)** |
| Total puncak | **±11–12 GB** dan terus tumbuh tak terduga | **±6–7 GB**, stabil dan bisa diprediksi |
| Waktu buang data lama | menyisir 17 juta baris **tiap menit** × 50 bridge | **satu perintah instan**, sekali sehari |
| Sampah/gembung tabel | terus menumpuk, autovacuum ketinggalan | **nol** |

Catatan jujur: **6–7 GB masih tidak kecil.** Kalau nanti perlu diperkecil, knop yang
tersedia (dan aman diputar tanpa mengubah arsitektur): perpendek retensi ringkasan
(30 → 14 hari), atau tambah lapis ringkasan per 15 menit untuk data > 7 hari. Sengaja
saya tidak masukkan ke usulan inti supaya tidak menambah rumit sebelum perlu.

## 2.9 Apakah TimescaleDB di Supabase cocok dipakai di sini?

### Apa itu TimescaleDB, dalam bahasa sederhana

Ekstensi Postgres khusus data time-series. Tiga jualan utamanya:

| Fitur | Artinya | Apakah kita butuh? |
|---|---|---|
| **Hypertable** | tabel yang **membagi laci per waktu sendiri, otomatis** — tak perlu membuat laci baru manual | Ya — ini persisnya §2.4 |
| **Continuous aggregate** | ringkasan yang **memperbarui dirinya sendiri** — tak perlu tugas tiap menit | Ya — ini persisnya §2.5 |
| **Compression** | memadatkan data lama, bisa hemat 90%+ ruang | Sangat berguna — lihat §2.8 |

Kalau ketiganya tersedia, TimescaleDB **memang alat yang tepat untuk kebutuhan ini.**
Masalahnya bukan pada teknologinya, tapi pada **versi mana yang tersedia di Supabase.**

### ⚠️ Yang harus Anda verifikasi sendiri sebelum memutuskan

Saya **tidak bisa memastikan** status TimescaleDB di Supabase per hari ini —
pengetahuan saya soal daftar ekstensi Supabase punya batas waktu dan hal ini sudah
beberapa kali berubah. **Cek langsung:** Dashboard Supabase → **Database → Extensions**
→ cari `timescaledb`. Yang perlu dilihat: ada/tidak, dan **edisi apa**
(jalankan `SELECT * FROM timescaledb_information.license;` kalau ekstensinya aktif).

Yang saya tahu, dan yang membuat saya berhati-hati:

1. **TimescaleDB punya dua edisi.** Edisi **Apache-2** (bebas) hanya berisi
   *hypertable*. Dua fitur yang justru paling kita inginkan — **continuous aggregate**
   dan **compression** — ada di edisi **Community/TSL**, dengan lisensi yang membatasi
   penyedia cloud pihak ketiga menawarkannya sebagai layanan.
2. Karena itu, penyedia terkelola seperti Supabase secara historis menyediakan **edisi
   Apache-2 saja** — artinya Anda dapat pembagian laci otomatis, **tapi tidak dapat
   ringkasan otomatis dan tidak dapat pemadatan.**
3. Ada arah yang jelas dari Supabase belakangan ini untuk **mengurangi dukungan
   TimescaleDB** dan mengarahkan pengguna ke **partisi asli Postgres + `pg_partman` +
   `pg_cron`**. Karena itu jangan bangun fondasi di atas ekstensi yang mungkin
   dihentikan.

### Penilaian saya: pakai cara manual, jangan TimescaleDB — kecuali…

**Kalau yang tersedia edisi Apache-2 (kemungkinan besar): JANGAN.** Alasannya sederhana —
satu-satunya fitur yang Anda dapat (pembagian laci otomatis) bisa didapat dari Postgres
biasa dengan usaha sekali pasang, sementara Anda menukarnya dengan ketergantungan pada
ekstensi yang bisa dicabut penyedia. Ringkasan otomatis dan pemadatan — dua alasan
sesungguhnya memakai Timescale — tidak Anda dapatkan.

**Kalau ternyata edisi Community tersedia dan tidak berstatus deprecated:**
pertimbangkan serius. *Continuous aggregate* menghapus seluruh §2.5, dan *compression*
bisa memotong 6–7 GB jadi di bawah 1 GB — dua keuntungan besar yang nyata.

### Untung-rugi berdampingan

| Aspek | **TimescaleDB** | **Manual: partisi Postgres + pg_cron** |
|---|---|---|
| Membuat laci baru per hari/bulan | otomatis | perlu tugas terjadwal (±40 baris SQL, sekali tulis) atau `pg_partman` |
| Buang data lama | `drop_chunks()` — instan | `DROP TABLE partisi` — instan. **Sama cepat** |
| Ringkasan per menit | **otomatis** (kalau edisi Community) | perlu tugas tiap menit (§2.5) |
| Pemadatan data lama | **hemat 90%+** (kalau edisi Community) | tidak ada |
| Query yang perlu diubah | hampir tidak ada (hypertable tampak seperti tabel biasa) | hampir tidak ada (tabel berpartisi juga tampak seperti tabel biasa) |
| Risiko dicabut penyedia | **ada** — pernah dan sedang terjadi | **nol** — ini fitur inti Postgres |
| Bisa pindah ke Postgres lain | terikat ekstensi | bisa pindah ke Postgres mana pun |
| Perlu izin/akses khusus | ya (aktifkan ekstensi) | tidak |
| Cocok dengan pola kode proyek ini | agak asing | **sangat cocok** — proyek sudah punya migrasi Alembic + loop latar |
| Yang harus dipelajari tim | konsep + perintah baru | partisi Postgres standar (ilmunya awet) |

**Kesimpulan:** **partisi asli Postgres**, ditambah tugas ringkas per menit dan tugas
arsip bulanan yang mengikuti pola loop latar yang **sudah ada** di proyek ini. Hasil
akhirnya setara untuk kebutuhan Anda, tanpa ketergantungan yang bisa hilang, dan
sepenuhnya di bawah kendali Anda.

Satu kalimat untuk diingat: **yang membuat sistem time-series cepat adalah pembagian
tabel per waktu — dan itu fitur Postgres biasa, bukan monopoli TimescaleDB.**

## 2.10 Urutan pengerjaan yang saya sarankan

Tiap tahap berdiri sendiri, bisa diuji, dan **tidak** membuang data.

| Tahap | Isi | Hasil yang langsung terasa | Menutup temuan |
|---|---|---|---|
| **0** | Penambal cepat: index waktu di `scada_ring`; `prune_ring` pindah ke server (bertahap); `SITE_ID` per bridge; `/summary` ambil nilai terakhir dari `scada_tag_latest` | beban database turun drastis **tanpa** migrasi besar | D-2, D-3, D-4, D-11 |
| **1** | Buat `scada_rollup_1m` (berpartisi bulan) + tugas ringkas per menit. **Belum** hapus apa pun — hanya menambah | grafik panjang jadi cepat; ringkasan mulai terkumpul | pondasi D-6 |
| **2** | Alihkan `/history`, `/summary`, `/sparklines` ke ringkasan; batasi jumlah sensor di `/sparklines`; saring langganan Realtime | dashboard ringan walau 50 pabrik | D-6 |
| **3** | Buat `scada_raw` berpartisi hari; bridge menulis ke sana; buang laci lama tiap hari; hentikan `prune_ring` | pembersihan jadi instan, gembung tabel hilang | D-1, sisa D-2/D-3 |
| **4** | Arsip per pabrik (1 file, 1 sheet/sensor, mengalir); buang laci ringkasan setelah terkonfirmasi | bom batas Excel hilang; jumlah file arsip turun 20× | D-7, D-8 |
| **5** | Bereskan sisa: cadangan bridge jadi antrian; hapus riwayat tidak lagi di tengah klik pengguna; N+1 mesin alarm | tahan mati-listrik, tidak ada klik yang membekukan layar | D-9, D-10, D-12 |

**Tahap 0 saja sudah membeli banyak waktu** — bisa dikerjakan dalam hitungan jam dan
tidak menyentuh struktur tabel. Tahap 1–2 boleh dikerjakan kapan saja karena hanya
menambah, tidak mengurangi. Tahap 3–4 yang perlu jendela pemeliharaan (sejalan dengan
jendela rilis mingguan 12.00–16.00).

## 2.11 Yang TIDAK perlu diubah

Supaya jelas batas usulan ini — hal-hal berikut sudah benar dan usulan di atas
**mempertahankannya apa adanya**:

1. **Bridge sebagai satu-satunya pintu masuk data**, dengan konfigurasi di database
   (bukan di file per PC). Pola yang benar.
2. **Kunci utama (sensor, waktu) + "kalau sudah ada, lewati"** — inilah yang membuat
   proses dobel, restart, dan pemutaran ulang data selalu aman.
3. **Lubang kosong dibiarkan kosong.** Kolom `jumlah` di tabel ringkasan justru membuat
   kejujuran ini lebih terbaca.
4. **"Tidak ada arsip sukses → tidak ada penghapusan."** Dipertahankan penuh, hanya
   satuannya berubah jadi pabrik-bulan.
5. **`scada_tag_latest` sebagai jalur angka hidup**, terpisah dari jalur riwayat.
6. **Bridge tidak pernah crash** — semua error ditangkap, loop terus jalan.
7. **Paging keyset** di `/samples`, **cache + single-flight** di `/summary`,
   **pemadatan grafik** di `/history`.
8. **Deteksi penarikan data berlebihan** dan **alarm kesehatan berbasis detak jantung**.
