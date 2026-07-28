# Audit Jalur Data R-Net — 25 Juli 2026

**Fokus:** semua kode yang berhubungan dengan pencatatan dan penyimpanan data sensor —
penerimaan data dari MQTT, penulisan ke database, penghapusan/reset data lama, dan
query yang dipakai grafik/dashboard.

**Sifat laporan:** hanya membaca kode. Tidak ada satu pun file yang diubah.

**Ditulis untuk dibaca orang non-programmer.** Istilah teknis yang tidak bisa dihindari
diberi penjelasan analogi di dalam kurung.

---

## 0. Cara membaca laporan ini

- **Bagian 1** — peta jalur data, supaya paham dulu "data itu lewat mana saja".
- **Bagian 2** — bedah per bagian kode. Tiap bagian menjawab 5 pertanyaan yang diminta:
  (a) apa yang dilakukan, (b) insert satu-satu atau borongan, (c) ada pembagian tabel
  per waktu atau tidak, (d) cara hapus data lama & risikonya, (e) query tanpa batas/tanpa index.
- **Bagian 3** — tabel ringkas jawaban (b)(c)(d)(e).
- **Bagian 4** — hitung-hitungan kasar kalau sistem menangani 50 plant.
- **Bagian 5** — **ringkasan 1 halaman**: apa yang HARUS diubah sebelum 50 plant,
  diurut dari paling mendesak. (Kalau waktu Anda sempit, langsung ke sini.)
- **Bagian 6** — hal-hal yang sudah benar dan jangan diutak-atik.

Kode temuan diberi nomor **D-1 … D-12** ("D" = Data), supaya tidak tertukar dengan
nomor K-/B- di `docs/AUDIT-CODEBASE-2026-07-25.md`.

---

## 1. Peta jalur data

```
   SENSOR / PLC
        │
        ▼
   V-Box / Node-RED  ──publish──►  BROKER MQTT (di VPS)
                                         │
                                         │ subscribe
                                         ▼
                              bridge.py  (program kurir di PC lapangan)
                                         │
              ┌──────────────────────────┼──────────────────────────┐
              ▼                          ▼                          ▼
      scada_tag_latest            scada_ring                 scada_samples
      "papan nilai               "kartu SD CCTV"            "arsip jangka
       sekarang"                  simpan 24 jam             panjang" simpan
      1 baris per sensor          lalu ditimpa              1 bulan lalu di-
      (ditimpa terus)                                       ekspor ke Drive
              │                          │                          │
              │                          └────────┬─────────────────┘
              │                                   ▼
              │                        scada_samples_all  (jendela gabungan;
              │                        bukan tabel baru, cuma "kaca" yang
              │                        menampilkan isi dua tabel sekaligus)
              │                                   │
              ▼                                   ▼
     angka hidup di layar              grafik / tabel / gauge / ekspor Excel
     (via Supabase Realtime)
```

Ada juga tiga proses latar di server backend yang ikut membaca data ini:

| Proses | Setiap berapa lama | Tugasnya |
|---|---|---|
| **Mesin alarm** (`alarm_engine.py`) | 5 detik | cek nilai lewat ambang / sensor bisu |
| **Monitor kesehatan** (`health_monitor.py`) | 60 detik | cek bridge mati / tag basi |
| **Pengarsip** (`archiver.py`) | 6 jam | ekspor siklus 1 bulan ke Drive, lalu hapus |

---

## 2. Bedah per bagian

### 2.1 Penerima data MQTT — `deploy/data/bridge.py`

Ini program "kurir" yang dijalankan di PC lapangan lewat tombol `start.bat data`.
File: [deploy/data/bridge.py](deploy/data/bridge.py)

#### (a) Apa yang dilakukan sekarang

Analogi: bridge adalah **petugas pencatat di ruang kontrol**.

1. **Ambil daftar tugas dari kantor pusat.** Setiap 30 detik bridge membaca database:
   daftar broker (site) dan daftar topik sensor yang aktif
   ([bridge.py:412](deploy/data/bridge.py#L412)). Jadi kalau Anda menambah sensor lewat
   layar R-Net, dalam ±30 detik bridge ikut mendengarkan — tanpa restart. Bagus.
2. **Dengar terus-menerus.** Sensor mengirim nilai kapan saja. Setiap pesan yang masuk
   langsung: (i) dikalikan/digeser sesuai setelan skala tag, (ii) **ditulis dulu ke
   catatan cadangan di harddisk PC** (file SQLite kecil), (iii) baru disimpan di ingatan
   ([bridge.py:485](deploy/data/bridge.py#L485)). Cadangan harddisk ini yang bikin data
   tidak hilang kalau PC mati mendadak.
3. **Tiga aliran keluar yang berbeda:**
   - **Aliran "angka sekarang"** — tiap ±1 detik, nilai terbaru tiap sensor ditimpa ke
     tabel `scada_tag_latest` (1 baris per sensor, selamanya 1 baris). Ini yang bikin
     angka di layar berkedip hidup ([bridge.py:670](deploy/data/bridge.py#L670)).
   - **Aliran "riwayat"** — sesuai *sampling level* tiap sensor (Fastest 2 dtk / Fast 5 dtk /
     Slow 30 dtk / Slowest 60 dtk). Bukan "tiap pesan disimpan", tapi "tiap periode,
     nilai terakhir dalam periode itu disimpan sekali"
     ([bridge.py:583](deploy/data/bridge.py#L583)). Periode yang tidak ada pesannya =
     **lubang kosong**, sengaja — supaya jelas kelihatan sensornya mati, bukan dibohongi
     dengan nilai palsu.
   - **Aliran "detak jantung"** — tiap 15 detik lapor "saya masih hidup, broker
     tersambung/tidak" ke tabel `scada_bridge_status` ([bridge.py:701](deploy/data/bridge.py#L701)).
4. **Tahan banting.** Broker putus → paho menyambung ulang sendiri. Database mati →
   dicoba lagi menit berikutnya. Payload rusak → dicatat, dilewati. Error apa pun →
   dicatat, loop tetap jalan. Ini desain yang benar dan sudah dipikirkan matang.

#### (b) Insert satu-satu atau borongan?

**Borongan (batch) — sudah benar.** Setiap detik bridge mengumpulkan semua sensor yang
periodenya baru habis, lalu mengirim satu perintah `executemany` untuk semua baris ring
sekaligus dan satu lagi untuk semua baris historian sekaligus
([bridge.py:628-641](deploy/data/bridge.py#L628)). Aliran "angka sekarang" juga borongan
([bridge.py:686](deploy/data/bridge.py#L686)).

Catatan kecil: `executemany` masih mengirim satu perintah per baris di balik layar
(walau lewat satu koneksi, dipipeline). Belum memakai `COPY` (metode borongan tercepat
Postgres). Untuk volume sekarang tidak masalah; untuk 50 plant ini mulai terasa —
lihat **D-5**.

**Kecuali satu tempat:** pemulihan setelah PC mati (`recover_buffer`) memasukkan
baris **satu per satu** dalam loop ([bridge.py:396-404](deploy/data/bridge.py#L396)).
Untungnya jumlahnya kecil (maksimal 1 baris per sensor), jadi ini bukan masalah.

#### (c) Ada pembagian tabel berdasarkan waktu?

**TIDAK ADA.** Ini temuan penting.

Semua data dari semua plant, semua sensor, masuk ke **dua tabel besar saja**:
`scada_ring` dan `scada_samples`. Tidak ada pembagian per bulan, per hari, atau per plant
(dalam istilah database: *tidak ada partitioning*). Saya cari di seluruh migrasi database
dan tidak ada satu pun jejak `PARTITION`, TimescaleDB, atau pg_partman.

Analogi: bayangkan satu lemari arsip raksasa berisi semua dokumen semua pabrik dicampur,
diurutkan hanya berdasarkan nomor sensor. Selama isinya ratusan ribu lembar, masih bisa
dicari. Kalau isinya puluhan juta lembar, setiap kali harus "buang arsip bulan lalu",
petugas harus membuka **seluruh lemari** lembar demi lembar.

Yang membuat ini lebih berat lagi: **baris data tidak menyimpan identitas plant.**
Satu baris hanya berisi (nomor sensor, waktu, nilai). Jadi "hapus semua data plant X"
atau "pindahkan plant X ke database sendiri" tidak bisa dilakukan langsung — harus
lewat tabel sensor dulu.

→ **Temuan D-1 (paling mendesak).**

#### (d) Bagaimana data lama dihapus, dan apakah bisa jadi lambat?

Untuk sensor mode **ring** ("Simpan data" TIDAK dicentang):

```
DELETE FROM scada_ring WHERE ts < now() - 24 jam
```
([bridge.py:657-668](deploy/data/bridge.py#L657)) — dijalankan **setiap 60 detik**.

**Ini akan jadi sangat lambat.** Alasannya:

1. **Tidak ada index waktu.** Tabel `scada_ring` hanya punya satu index bawaan, yaitu
   kunci utama (nomor sensor + waktu) ([migrasi e5f6g7h8i9j0:146-153](db/alembic/versions/e5f6g7h8i9j0_rnet_storage_redesign.py#L146)).
   Perintah hapus di atas menyaring **hanya berdasarkan waktu**, tanpa menyebut sensor.
   Index yang ada tidak bisa dipakai (analogi: buku telepon diurutkan per *nama*, tapi
   Anda diminta mencari semua orang yang lahir sebelum 1990 — mau tak mau baca semua
   halaman). Jadi Postgres **membaca seluruh tabel dari awal sampai akhir, setiap
   60 detik.**
2. **Setiap bridge melakukannya, untuk seluruh armada.** Perintah hapus itu tidak
   dibatasi per site. Kalau ada 50 PC lapangan menjalankan bridge, ada **50 kali
   pembacaan seluruh tabel per menit** — padahal satu kali saja sudah cukup.
3. **Sampah bertumpuk (bloat).** Postgres tidak langsung membuang baris yang dihapus;
   ada proses pembersih latar (autovacuum). Dengan laju hapus setinggi ini pada satu
   tabel raksasa, pembersih akan tertinggal, tabel membengkak, dan semua query jadi
   lebih lambat — termasuk grafik yang dilihat operator.

→ **Temuan D-2 (index waktu) dan D-3 (prune tidak dibatasi per site).**

#### (e) Query tanpa batas / tanpa index yang sesuai

| Lokasi | Masalah |
|---|---|
| [bridge.py:664](deploy/data/bridge.py#L664) | `DELETE ... WHERE ts < ...` — tanpa index waktu, tanpa batas jumlah, tanpa batas site. Baca seluruh tabel tiap menit. |
| [bridge.py:445-467](deploy/data/bridge.py#L445) | Baca daftar site & tag tanpa `LIMIT`. Sekarang aman (data konfigurasi kecil), tapi dijalankan tiap 30 detik oleh setiap bridge. |

#### (f) Dua hal lain yang saya temukan di bridge

**Cadangan harddisk hanya menyimpan 1 nilai per sensor.** Tabel cadangan SQLite memakai
nomor sensor sebagai kunci utama dan perintah "INSERT OR REPLACE"
([bridge.py:320-341](deploy/data/bridge.py#L320)). Artinya nilai baru **menimpa** nilai
lama yang belum sempat terkirim. Konsekuensinya: kalau Supabase mati 1 jam, yang selamat
hanya **nilai terakhir** tiap sensor — bukan seluruh 1 jam data. Dokumentasi di kepala
file menjanjikan "crash mid-bucket no longer punches a hole in the history", dan itu benar
untuk PC restart sesaat, tapi **tidak** melindungi dari database mati berkepanjangan.
→ **Temuan D-9.**

**Setiap bridge menyambung ke SEMUA broker, bukan hanya broker miliknya sendiri.**
`load_config` mengambil *semua* site yang aktif, lalu `reconcile` membuka koneksi ke
semuanya ([bridge.py:445](deploy/data/bridge.py#L445), [bridge.py:545](deploy/data/bridge.py#L545)).
Tidak ada setelan "PC ini hanya untuk site A" — saya cek `deploy/config.env.example`,
tidak ada `SITE_ID`. Dengan 1–2 plant ini tidak terasa. Dengan 50 plant: **setiap PC
membuka 50 koneksi broker dan menulis data 50 plant**, sehingga total 2.500 koneksi
broker dan setiap baris ditulis 50 kali (untungnya duplikatnya ditolak kunci utama,
tapi beban tulis ke databasenya tetap 50 kali lipat).
→ **Temuan D-4 (mendesak).**

---

### 2.2 Pencatat internal (simulator) — `backend/app/services/historian.py`

File: [backend/app/services/historian.py](backend/app/services/historian.py)

#### (a) Apa yang dilakukan

Ini "pabrik data palsu" untuk demo — menghasilkan nilai sensor buatan berbentuk gelombang,
supaya grafik bisa dilihat tanpa hardware. **Default-nya MATI**
(`HISTORIAN_SIMULATOR=0`, [historian.py:40](backend/app/services/historian.py#L40)),
karena dulu bikin bingung ("kok tag baru sudah ada nilainya?").

Kalau dinyalakan: setiap 60 detik menulis satu baris per sensor simulator; sensor
sumber "mqtt" **dilewati** supaya tidak bentrok dengan bridge
([historian.py:99](backend/app/services/historian.py#L99)).

#### (b) Insert satu-satu atau borongan?

**Borongan.** Semua baris dikumpulkan dulu lalu dikirim sekali
([historian.py:132-137](backend/app/services/historian.py#L132)). Pengisian riwayat awal
(*backfill* 7 hari) dipotong per 5.000 baris — ini pola yang benar
([historian.py:189-199](backend/app/services/historian.py#L189)).

#### (c)(d)(e)

Sama seperti bridge: tabel yang sama, tanpa partisi. Modul ini **tidak pernah menghapus**
apa pun (dikomentari jelas di [historian.py:46](backend/app/services/historian.py#L46)) —
penghapusan diserahkan ke bridge (ring) dan pengarsip (historian). Tidak ada query tanpa
batas yang berbahaya di sini.

**Risiko kecil:** kalau nanti simulator dinyalakan sementara ada 1.000 sensor, baris
`select semua tag` dijalankan tiap 60 detik dan tiap 5 detik
([historian.py:112](backend/app/services/historian.py#L112), [historian.py:147](backend/app/services/historian.py#L147))
tanpa `LIMIT`. Bukan prioritas selama simulator tetap mati di produksi.

---

### 2.3 Tabel penyimpanan — `db/models/scada.py` + migrasi

#### (a) Apa isi tiap tabel

| Tabel | Isi | Analogi | Retensi |
|---|---|---|---|
| `scada_tag_latest` | 1 baris per sensor: nilai terakhir | papan skor | selamanya (ditimpa) |
| `scada_ring` | riwayat sensor "Simpan data" MATI | kartu SD CCTV | 24 jam (bisa disetel) |
| `scada_samples` | riwayat sensor "Simpan data" NYALA | arsip | 1 bulan lalu diekspor+dihapus |
| `scada_samples_all` | **bukan tabel** — jendela gabungan ring + samples | kaca pengintip | — |
| `scada_alarm_events` | tiap kejadian alarm | buku kejadian | **tidak pernah dihapus** |
| `scada_tag_archives` | catatan file arsip di Drive | buku induk arsip | tidak pernah dihapus |
| `scada_audit_log`, `scada_data_access_log` | siapa mengubah apa / siapa menarik data besar | buku tamu | tidak ada pembersihan |

#### (b) Bentuk baris & index

Baris data sensor sangat ramping — hanya (nomor sensor, waktu, nilai). Bagus.

**Index yang ada:** hanya kunci utama `(tag_id, ts)` di kedua tabel data. Saya cari
`create_index` untuk `scada_ring`/`scada_samples` di seluruh folder migrasi: **nihil**.

Artinya:
- Query "ambil data sensor X antara jam A dan B" → **cepat** (index cocok). ✔
- Query "ambil/hapus semua data sebelum tanggal T (semua sensor)" → **baca seluruh
  tabel**. ✘ Ini persis yang dilakukan pembersih ring tiap menit.

#### (c) Partisi waktu

**Tidak ada** (sudah dibahas di 2.1c). Tabel `scada_samples_all` yang dipakai semua
pembacaan adalah **UNION** dari dua tabel — artinya setiap kali dashboard membaca data,
Postgres menyentuh **kedua** tabel, walaupun sensor itu jelas cuma ada di salah satunya
([migrasi:69-76](db/alembic/versions/e5f6g7h8i9j0_rnet_storage_redesign.py#L69)).
Untuk satu sensor ini murah. Untuk ratusan sensor sekaligus, biayanya dua kali lipat.

#### (d)(e)

Lihat 2.1 dan 2.5.

---

### 2.4 Penghapusan data lama, jalur 1: ring (24 jam)

Sudah dibahas lengkap di **2.1(d)**. Ringkas: satu perintah `DELETE` berbasis waktu,
tiap 60 detik, tanpa index waktu, tanpa batas jumlah baris per jalan, dijalankan oleh
**setiap** bridge. Ini titik yang paling cepat pecah saat data membesar.

Perbaikan yang biasa dipakai untuk kasus seperti ini, dari yang paling ringan:

1. Tambah index waktu → hapus jadi mencari sasaran, bukan menyisir semua.
2. Hapus bertahap (`DELETE ... LIMIT 10.000` dalam loop) → tidak mengunci tabel lama-lama.
3. Pindahkan tugas hapus ke **satu** tempat saja (server), bukan ke 50 bridge.
4. Yang paling benar untuk jangka panjang: **partisi per jam/hari**, lalu "hapus data
   lama" = *buang satu laci utuh* (operasi instan), bukan mencabut lembar satu-satu.

---

### 2.5 Penghapusan data lama, jalur 2: reset siklus historian — `archiver.py`

File: [backend/app/services/archiver.py](backend/app/services/archiver.py)

#### (a) Apa yang dilakukan

Untuk sensor "Simpan data" NYALA, tiap sensor punya jam pasirnya sendiri (default 1 bulan).
Ketika habis, urutannya:

1. **Pasang klaim** di buku induk (`scada_tag_archives`) — supaya dua server tidak
   mengarsip hal yang sama ([archiver.py:142](backend/app/services/archiver.py#L142)).
2. **Tarik seluruh data siklus itu** dan susun jadi satu file Excel di dalam memori
   ([archiver.py:49-76](backend/app/services/archiver.py#L49)).
3. **Unggah ke Google Drive.**
4. **Kirim email** berisi lampiran Excel ke penerima alarm.
5. **BARU** hapus data sensor itu dari database dan setel ulang jam pasirnya
   ([archiver.py:195-200](backend/app/services/archiver.py#L195)).

Aturannya tegas dan benar: **tidak ada arsip sukses → tidak ada penghapusan.** Kalau
Drive mati, data cuma menumpuk sampai percobaan berikutnya. Ini desain yang aman.

#### (b) Insert/hapus satu-satu atau borongan?

Penghapusan **borongan** dan memakai index dengan benar
(`DELETE ... WHERE tag_id = X` — sesuai kunci utama, jadi cepat, [archiver.py:195](backend/app/services/archiver.py#L195)).

#### (c) Partisi

Tidak ada. Penghapusan per-sensor menghapus lembar-lembar yang tersebar di seluruh
tabel besar. Dengan partisi, ini bisa jadi operasi buang-laci.

#### (d) Bisa jadi lambat / gagal kalau data sangat banyak? **Ya, tiga cara:**

1. **Seluruh siklus dimuat ke memori sekaligus.** `_build_tag_workbook` menarik semua
   baris tanpa `LIMIT` lalu menyusun Excel di RAM
   ([archiver.py:55-76](backend/app/services/archiver.py#L55)). Untuk sensor 30 detik
   selama 1 bulan ≈ 86 ribu baris — aman. Untuk sensor **2 detik** selama 1 bulan
   ≈ **1,3 juta baris** — berat, dan…
2. **…melewati batas fisik Excel.** Satu sheet Excel maksimal 1.048.576 baris. Sensor
   2 detik selama 1 bulan melebihi itu. File akan terbentuk tapi **tidak bisa dibuka
   utuh**. Ini bom waktu yang menunggu ada orang memilih level "Fastest" + "Simpan data".
   → **Temuan D-7.**
3. **Semua sensor diproses berurutan dalam satu putaran.** `archive_once` melewati semua
   sensor satu per satu ([archiver.py:222-249](backend/app/services/archiver.py#L222)).
   Kalau 300 sensor jatuh tempo di hari yang sama, ratusan ekspor + unggah + email
   berjalan berderet dalam satu proses. Tidak ada pembatas jumlah per putaran.
   → **Temuan D-8.**

#### (e) Query tanpa batas di sini

- [archiver.py:55](backend/app/services/archiver.py#L55) — tarik seluruh siklus, tanpa `LIMIT`, langsung ke memori.
- [archiver.py:226](backend/app/services/archiver.py#L226) — ambil semua sensor aktif, tanpa `LIMIT`.

#### (f) Satu penghapusan lagi yang luput dari perhatian

Di [scada.py:1110-1115](backend/app/routers/scada.py#L1110): saat pengguna **mengganti
sumber sensor atau menyalakan/mematikan "Simpan data"**, seluruh riwayat sensor itu
dihapus dari 3 tabel — **langsung di dalam permintaan HTTP**, sambil pengguna menunggu
layar. Untuk sensor dengan jutaan baris, klik ini bisa membekukan layar sampai timeout.
Dan penghapusannya **tanpa arsip** — beda dengan jalur pengarsip yang hati-hati.
→ **Temuan D-10.**

---

### 2.6 Query untuk grafik & dashboard — `backend/app/routers/scada.py`

Ini bagian yang paling sering dijalankan: setiap operator yang membuka layar memicunya
berulang-ulang.

| Endpoint | Dipakai untuk | Batas jumlah | Penilaian |
|---|---|---|---|
| `/latest` | angka hidup | maks 100 sensor | ✔ murah, baca `scada_tag_latest` |
| `/tags/{id}/recent` | drawer Riwayat | maks 500 baris | ✔ |
| `/tags/{id}/samples` | scroll riwayat + ekspor | maks 5.000 baris/halaman, paging *keyset* | ✔ pola yang benar |
| `/history` | grafik garis | maks 4 sensor, 720 titik, 45 hari | ✔ dibatasi rapi |
| `/summary` | gauge/tabel | maks 60 sensor, hasil di-cache 45 detik | ⚠ ada 1 query mahal di dalamnya |
| `/sparklines` | mini-grafik di tabel Analisis | **TIDAK DIBATASI jumlah sensor** | ✘ **bahaya di 50 plant** |
| `/alarms/active` | lonceng alarm | **tanpa batas** | ⚠ |
| `/archives` | daftar arsip Drive | **tanpa batas** | ⚠ |

#### (a) Apa yang dilakukan yang paling penting

- **`/history`** — memampatkan data mentah jadi maksimal 720 titik dengan cara
  mengelompokkan per rentang waktu lalu mengambil rata-rata/min/maks
  ([scada.py:1262-1281](backend/app/routers/scada.py#L1262)). Jadi grafik 30 hari tidak
  pernah mengirim 43 ribu baris ke browser. **Ini benar dan penting.**
- **`/summary`** — untuk gauge: nilai terakhir + min/maks/rata-rata. Dilengkapi dua
  pengaman bagus: hasil disimpan 45 detik (*cache*), dan kalau 50 orang meminta hal yang
  sama bersamaan, query-nya hanya dijalankan **sekali** lalu hasilnya dibagi
  (*single-flight*, [scada.py:1534-1587](backend/app/routers/scada.py#L1534)). Ini
  pekerjaan yang matang.

#### (e) Query tanpa batas / tanpa index yang sesuai — daftar lengkap

**E-1. `/sparklines` tidak membatasi jumlah sensor — paling berbahaya.**
[scada.py:1645-1674](backend/app/routers/scada.py#L1645). Endpoint ini mengambil
**semua** sensor yang terlihat pengguna (tanpa `LIMIT` sama sekali), lalu menjalankan
satu agregasi besar atas rentang sampai **744 jam (31 hari)** untuk semua sensor itu
sekaligus — dan **tanpa cache**. Dengan 20 sensor sekarang: wajar. Dengan 1.000 sensor
di 50 plant: satu klik buka halaman Analisis = satu query yang menyisir puluhan juta
baris di **dua** tabel. Kalau lima orang membuka halaman itu bersamaan, database bisa
tersandera.
→ **Temuan D-6 (mendesak).**

**E-2. `/summary` mencari "nilai terakhir" lewat jalan memutar yang mahal.**
[scada.py:1509-1515](backend/app/routers/scada.py#L1509) memakai `DISTINCT ON` pada
jendela gabungan `scada_samples_all` untuk mengambil baris terbaru tiap sensor.
Karena jendela gabungan itu hasil UNION dua tabel, urutan yang dibutuhkan tidak bisa
diambil langsung dari index — Postgres harus **mengurutkan** dulu semua baris milik 60
sensor itu untuk mengambil 60 baris teratas. Padahal **nilai terakhir sudah tersedia
gratis** di tabel `scada_tag_latest` (1 baris per sensor, tinggal ambil).
Ini perbaikan kecil dengan dampak besar. → **Temuan D-11.**

**E-3. `/alarms/active` dan `/archives` tanpa `LIMIT`.**
[scada_alarms.py:79-86](backend/app/routers/scada_alarms.py#L79) mengambil **semua**
alarm yang sedang terbuka — dan setiap browser memanggilnya **tiap 30 detik**
([use-alarm-events.ts:17](frontend/src/features/scada/use-alarm-events.ts#L17)). Kalau
satu plant mati dan 300 sensornya kompak bilang "bisu", daftar itu jadi ratusan baris
yang dikirim ke setiap layar, dua kali per menit.
[scada_alarms.py:206-211](backend/app/routers/scada_alarms.py#L206) mengambil **seluruh
riwayat arsip sejak awal waktu**, tanpa paging.

**E-4. Riwayat alarm memakai paging model lama.**
[scada_alarms.py:116-127](backend/app/routers/scada_alarms.py#L116) memakai
`COUNT(*)` penuh + `OFFSET`. `scada_alarm_events` **tidak pernah dihapus** (disengaja —
riwayat permanen). Setelah beberapa tahun dan 50 plant, menghitung total baris tiap
buka halaman jadi mahal, dan halaman ke-500 makin lambat.

**E-5. Mesin alarm: satu query tambahan per sensor (pola "N+1").**
[alarm_engine.py:145-158](backend/app/services/alarm_engine.py#L145). Kalau sebuah
sensor belum punya baris di `scada_tag_latest`, mesin alarm menembak query terpisah ke
jendela gabungan untuk mencari kapan terakhir sensor itu bicara — **untuk setiap sensor
seperti itu, setiap 5 detik**. Dengan 1.000 sensor yang belum pernah kirim data
(misalnya baru dipasang massal), itu 1.000 query tiap 5 detik = 200 query/detik hanya
untuk mengecek hal yang sama berulang-ulang.
→ **Temuan D-12.**

---

### 2.7 Ekspor Excel di browser — `frontend/.../export-excel.ts`

File: [frontend/src/features/scada/analysis/export-excel.ts](frontend/src/features/scada/analysis/export-excel.ts)

#### (a) Apa yang dilakukan

Mengunduh **data mentah apa adanya** (bukan rata-rata) untuk rentang tanggal yang dipilih.
Caranya: browser meminta halaman demi halaman ke `/samples`, mundur dari tanggal akhir,
sampai melewati tanggal awal.

#### (b)(d)(e) Catatan

- Batas pengaman: 400 halaman × 5.000 baris = **2 juta baris per sensor**
  ([export-excel.ts:9-10](frontend/src/features/scada/analysis/export-excel.ts#L9)).
- Semua sensor ditarik **paralel** ([export-excel.ts:61](frontend/src/features/scada/analysis/export-excel.ts#L61)).
  Pilih 10 sensor sekaligus → hingga 10 × 400 = **4.000 permintaan** menghantam server
  hampir bersamaan, dan seluruh hasilnya (bisa 20 juta baris) disusun **di dalam RAM
  browser**. Kemungkinan besar tab browser-nya yang mati duluan.
- Setiap permintaan itu juga menulis satu baris ke log akses data
  ([data_access_monitor.py:104](backend/app/services/data_access_monitor.py#L104))
  dan menjalankan satu query `SUM` — jadi beban tulis ikut berlipat.
- Sisi baiknya: sudah ada **detektor penyalahgunaan** — kalau satu akun menarik lebih
  dari 2 juta baris sehari, admin dapat peringatan Telegram/email
  ([data_access_monitor.py:37-38](backend/app/services/data_access_monitor.py#L37)). Bagus.

Untuk 50 plant, ekspor sebaiknya dipindah ke server (server yang membuat file lalu
mengirim tautan unduh), bukan dirakit di browser. → bagian dari **Temuan D-7**.

---

### 2.8 Angka hidup lewat Supabase Realtime

File: [frontend/src/features/scada/analysis/use-live-samples.ts](frontend/src/features/scada/analysis/use-live-samples.ts)

Setiap browser berlangganan perubahan tabel `scada_tag_latest` — **seluruh tabel, tanpa
saringan** ([use-live-samples.ts:92-101](frontend/src/features/scada/analysis/use-live-samples.ts#L92)).

Sekarang: 20 sensor × 1 pembaruan/detik = 20 pesan/detik per browser. Ringan.

Dengan 50 plant (≈1.000 sensor): **1.000 pesan per detik dikirim ke setiap browser yang
terbuka**, padahal layar itu mungkin hanya menampilkan 8 sensor. Ini akan membuat laptop
operator panas dan koneksi Realtime Supabase menyentuh batas kuota.
→ bagian dari **Temuan D-6**.

---

## 3. Tabel ringkas jawaban (b)(c)(d)(e)

| Bagian kode | (b) Insert borongan? | (c) Partisi waktu? | (d) Hapus data lama | (e) Query tanpa batas/index |
|---|---|---|---|---|
| Bridge MQTT | ✔ ya (`executemany`), belum `COPY` | ✘ tidak ada | `DELETE ... WHERE ts <` tiap 60 dtk — **tanpa index, tanpa batas, ×50 bridge** | prune ring; baca konfig tiap 30 dtk |
| Simulator historian | ✔ ya, backfill per 5.000 | ✘ | tidak menghapus apa pun | ambil semua tag (aman, simulator mati) |
| Pengarsip (siklus 1 bulan) | ✔ hapus per-sensor pakai index | ✘ | ekspor→Drive→email→hapus. **Aman**, tapi tarik semua baris ke RAM | tarik seluruh siklus tanpa `LIMIT`; semua tag tanpa `LIMIT` |
| Ganti sumber / toggle Simpan | ✔ | ✘ | hapus **tanpa arsip**, di tengah request HTTP | hapus tanpa batas saat pengguna menunggu |
| `/history`, `/recent`, `/samples` | — | ✘ | — | ✔ semuanya berbatas |
| `/summary` | — | ✘ | — | ⚠ `DISTINCT ON` mahal untuk cari nilai terakhir |
| `/sparklines` | — | ✘ | — | ✘ **semua sensor, sampai 31 hari, tanpa cache** |
| `/alarms/active`, `/archives` | — | ✘ | alarm tak pernah dihapus | ✘ tanpa `LIMIT` |
| Mesin alarm | — | ✘ | — | ✘ N+1 tiap 5 detik |
| Ekspor Excel (browser) | — | — | — | ✘ sampai 4.000 permintaan paralel |

---

## 4. Hitung-hitungan kasar untuk 50 plant

Asumsi konservatif: **50 plant × 20 sensor = 1.000 sensor**, level "Fast" (5 detik).

| Hal | Sekarang (1 plant, 20 sensor) | 50 plant (1.000 sensor) |
|---|---|---|
| Baris riwayat masuk | ±240 baris/menit | **±12.000 baris/menit** (17,3 juta/hari) |
| Isi tabel `scada_ring` (24 jam) | ±350 ribu baris | **±17 juta baris (±1,5–2 GB)** |
| Kalau level "Fastest" (2 dtk) | ±870 ribu | **±43 juta baris/hari (±5 GB)** |
| Isi `scada_samples` jelang reset bulanan | ±1,7 juta | **±86 juta baris (±9–10 GB)** |
| Pembacaan seluruh tabel ring untuk prune | 350 ribu baris/menit | **17 juta baris × 50 bridge = 850 juta baris dibaca/menit** ← titik pecah |
| Pembaruan `scada_tag_latest` | 20/detik | **1.000/detik** (dan semuanya disiarkan ke tiap browser) |
| Koneksi broker dari armada bridge | 1 | **2.500** (50 PC × 50 site, karena tidak ada penyaring site) |

Angka-angka ini kasar (±30%), tapi cukup untuk melihat mana yang pecah duluan:
**bukan kecepatan menulis data** (12.000 baris/menit itu ringan untuk Postgres),
melainkan **pembersihan data lama, query dashboard yang tak berbatas, dan duplikasi
kerja antar-bridge.**

---

## 5. RINGKASAN 1 HALAMAN — yang HARUS diubah sebelum 50 plant

Diurut dari paling mendesak. Kolom "berat" = perkiraan usaha, bukan janji jadwal.

| # | Yang harus diubah | Kenapa mendesak | Berat |
|---|---|---|---|
| **D-1** | **Bagi tabel data per waktu (partisi), dan tambahkan identitas plant di barisnya** — `scada_ring` per jam/hari, `scada_samples` per bulan | Ini akar dari D-2, D-3, dan sebagian D-8. Dengan partisi, "buang data lama" berubah dari *menyisir 17 juta baris tiap menit* jadi *buang satu laci* (instan). Tanpa ini, semua perbaikan lain hanya menunda | **Besar** — perlu migrasi database + uji |
| **D-2** | **Tambah index waktu** pada `scada_ring` (dan `scada_samples`) | Perintah hapus tiap 60 detik sekarang membaca seluruh tabel. Ini penambal cepat kalau D-1 belum sempat. Satu baris migrasi | **Kecil** |
| **D-3** | **Pindahkan tugas hapus ring ke satu tempat (server), hapus dari bridge**; dan buat penghapusannya bertahap (mis. 10.000 baris per putaran) | Sekarang 50 PC melakukan pekerjaan berat yang sama pada tabel yang sama, tiap menit | **Kecil–sedang** |
| **D-4** | **Beri setiap bridge identitas site-nya sendiri** (`SITE_ID` di `config.env`), supaya PC lapangan hanya menangani brokernya sendiri | Tanpa ini, tiap PC menyambung ke 50 broker dan menulis data 50 plant → beban tulis dan koneksi 50× lipat, plus tiap plant memegang kredensial broker plant lain (ini juga isu keamanan) | **Kecil** |
| **D-5** | **Ganti cara tulis ke `COPY` / multi-baris**, dan gunakan satu koneksi tulis khusus | Pada 12.000 baris/menit dari 50 sumber, cara sekarang (`executemany`) mulai jadi hambatan | **Sedang** |
| **D-6** | **Batasi `/sparklines`** (maks N sensor per permintaan + cache seperti `/summary`), dan **saring langganan Realtime** supaya browser hanya menerima sensor yang sedang ditampilkan | Satu klik "buka Analisis" pada 1.000 sensor = query raksasa tanpa cache; dan tiap browser menerima 1.000 pesan/detik yang 99%-nya tidak dipakai | **Sedang** |
| **D-7** | **Pindahkan ekspor Excel ke server**, tulis file secara mengalir (streaming), dan **pecah file per 1 juta baris** | Dua bom: (i) sensor 2 detik selama 1 bulan = 1,3 juta baris → melewati batas fisik Excel, file arsip tidak bisa dibuka utuh; (ii) ekspor 10 sensor dari browser = ribuan permintaan paralel | **Sedang** |
| **D-8** | **Batasi jumlah sensor yang diarsipkan per putaran** dan sebar jadwalnya | Kalau 300 sensor jatuh tempo di hari yang sama, ratusan ekspor+unggah+email berderet dalam satu proses | **Kecil** |
| **D-9** | **Perbaiki cadangan harddisk bridge**: simpan antrian, bukan hanya 1 nilai terakhir per sensor | Sekarang, database mati 1 jam = hilang 1 jam data (kecuali nilai terakhir), padahal dokumentasinya menjanjikan sebaliknya | **Kecil** |
| **D-10** | **Jangan hapus riwayat di tengah request HTTP** saat ganti sumber / toggle "Simpan data" — jadikan tugas latar, dan arsipkan dulu | Sekarang satu klik bisa menghapus jutaan baris sambil pengguna menunggu layar; dan menghapus data yang mungkin masih dibutuhkan tanpa cadangan | **Kecil** |
| **D-11** | **`/summary` ambil "nilai terakhir" dari `scada_tag_latest`**, bukan `DISTINCT ON` di jendela gabungan | Perbaikan ±5 baris, menghilangkan salah satu query termahal di jalur paling sering dipanggil | **Sangat kecil** |
| **D-12** | **Hilangkan N+1 di mesin alarm**: ambil "kapan terakhir bicara" untuk semua sensor dalam satu query | Tiap 5 detik, satu query per sensor yang belum punya nilai terakhir | **Kecil** |

### Kalau hanya sempat mengerjakan tiga hal

**D-2 + D-3 + D-4.** Ketiganya kecil, bisa selesai dalam hitungan jam, dan bersama-sama
menghilangkan beban terbesar yang muncul saat armada bertambah (pembersihan ring yang
menyisir seluruh tabel, dikalikan jumlah PC lapangan). **D-11** bisa ditambahkan gratis —
perubahannya hanya beberapa baris.

**D-1 (partisi) tetap harus dijadwalkan.** Penambal di atas membeli waktu; partisi yang
menyelesaikan masalahnya. Semakin lama ditunda, semakin besar tabel yang harus dimigrasi.

---

## 6. Yang sudah benar — jangan diutak-atik

Supaya seimbang: fondasi jalur data ini dipikirkan jauh lebih matang daripada rata-rata
sistem sejenis. Yang berikut ini sudah benar dan sebaiknya dipertahankan apa adanya:

1. **Pemisahan tiga jalur** (angka sekarang / ring 24 jam / arsip 1 bulan). Ini keputusan
   arsitektur yang tepat: churn tulis-hapus yang berat tidak mengotori tabel arsip.
2. **"Tidak ada arsip sukses → tidak ada penghapusan"** di pengarsip. Persis aturan yang
   seharusnya. Klaim atomik supaya dua server tidak mengarsip ganda juga sudah benar.
3. **Kunci utama (sensor, waktu) + `ON CONFLICT DO NOTHING`** di semua penulis. Artinya
   proses yang jalan dobel atau data yang diputar ulang tidak pernah menciptakan
   duplikat. Ini yang membuat pemulihan aman.
4. **Lubang kosong dibiarkan kosong** saat sensor diam. Tidak mengarang nilai palsu —
   ini kejujuran data yang sering dikorbankan sistem lain.
5. **Grafik memakai pemadatan (bucket), bukan data mentah.** `/history` dibatasi 4 sensor,
   720 titik, 45 hari.
6. **Paging keyset** di `/samples` — halaman ke-1000 sama cepatnya dengan halaman pertama.
7. **Cache + single-flight** di `/summary`. Lima puluh penonton halaman yang sama hanya
   menghasilkan satu query.
8. **Bridge tidak pernah crash.** Semua error ditangkap dan dicatat; loop terus jalan.
9. **Deteksi penyalahgunaan penarikan data** (M12) — ambang harian per akun dengan alert.
10. **Alarm kesehatan sistem** berbasis detak jantung bridge, dengan pesan hanya saat
    status berubah (tidak spam).

---

## 7. Berkas yang dibaca untuk audit ini

**Penerima & penulis data**
- `deploy/data/bridge.py` (812 baris) — kurir MQTT → database
- `backend/app/services/historian.py` — pencatat internal/simulator
- `backend/app/services/archiver.py` — ekspor & reset siklus

**Definisi penyimpanan**
- `db/models/scada.py` — bentuk semua tabel R-Net
- `db/alembic/versions/p0q1r2s3t4u5_add_historian_tables.py` — tabel awal
- `db/alembic/versions/e5f6g7h8i9j0_rnet_storage_redesign.py` — pemisahan ring/historian
- `db/session.py` — pengaturan koneksi database

**Pembaca data**
- `backend/app/routers/scada.py` (1.738 baris) — endpoint riwayat/grafik/ringkasan
- `backend/app/routers/scada_alarms.py` — alarm, nilai terakhir, daftar arsip
- `backend/app/services/alarm_engine.py`, `health_monitor.py`, `data_access_monitor.py`
- `backend/app/services/rnet_settings.py` — resolusi level sampling & jam siklus
- `backend/app/main.py` — proses latar yang dijalankan

**Sisi browser**
- `frontend/src/features/scada/analysis/export-excel.ts`
- `frontend/src/features/scada/analysis/use-live-samples.ts`
- `frontend/src/features/scada/use-alarm-events.ts`, `panels/use-panel-refresh.ts`

**Konfigurasi lapangan**
- `deploy/config.env.example`, `deploy/data/README-bridge.md`
