# Ringkasan Perbaikan Jalur Data R-Net — 26–27 Juli 2026

**Untuk siapa:** pemilik R-Net. Ditulis tanpa istilah teknis sejauh mungkin;
yang tidak bisa dihindari diberi analogi.

**Dasarnya:** temuan D-1 sampai D-12 di [AUDIT-DATA.md](AUDIT-DATA.md) dan rancangan
di [ARSITEKTUR-DATA.md](ARSITEKTUR-DATA.md).

**Status:** SELESAI SELURUHNYA. Semua sudah masuk ke `main` dan diterapkan ke
database produksi, termasuk langkah terakhir (menghapus tabel lama `scada_ring`)
yang dijalankan 27 Juli setelah persetujuan pemilik.

---

## 1. Apa yang berubah, dalam satu halaman

### Dulu

Semua data sensor masuk ke dua lemari besar tanpa sekat. Setiap menit, setiap PC
lapangan menyisir **seluruh** lemari untuk membuang lembar kedaluwarsa. Setiap
grafik dibuka, sistem menghitung ulang rata-rata dari data mentah. Setiap arsip
bulanan menghasilkan satu file per sensor.

### Sekarang

```
   SENSOR → BROKER → bridge (PC lapangan, hanya menangani plantnya sendiri)
                         │
          ┌──────────────┴──────────────┐
          ▼                             ▼
   scada_tag_latest              scada_raw  ← DIBAGI PER HARI
   "papan skor"                  laci 26 Juli │ 27 Juli │ 28 Juli
   angka hidup di layar          buang laci = seperseratus detik
                                        │
                                 tiap menit diringkas
                                        ▼
                                 scada_rollup_1m  ← DIBAGI PER BULAN
                                 rata²·min·maks·jumlah + identitas plant
                                        │
                                 akhir siklus, per plant
                                        ▼
                                 Google Drive: 1 file per plant,
                                 1 sheet per sensor
```

Tiga perubahan besar:

1. **Membuang data lama = mengangkat satu laci**, bukan menyisir jutaan lembar.
2. **Grafik membaca ringkasan yang sudah jadi**, bukan menghitung ulang tiap kali.
3. **Pekerjaan berat pindah dari PC lapangan dan dari browser ke server.**

---

## 2. Angka-angka yang terukur

Semua diukur langsung, bukan diperkirakan. Yang bertanda 🧪 dari benchmark
skala pilot (300 sensor, 48 jam, campuran sampling nyata).

| Yang diukur | Sebelum | Sesudah |
|---|---|---|
| Sapuan buang-data membaca | 1.235 halaman | **2 halaman** |
| 🧪 Buang data satu hari (3,3 juta baris) | 2.632 md + 3,3 juta bangkai baris | **109 md + nol bangkai** |
| Grafik `/history` 24 jam | 209 md | **17 md** |
| Gauge `/summary` 24 jam, 60 sensor | 293 md | **47 md** |
| 🧪 Mini-grafik 31 hari, 300 sensor | 2.557 md, tanpa cache | **243 md + cache 45 dtk** |
| 🧪 Query "kapan terakhir bicara" | 1.638 md | **1,7 md** |
| Halaman data dibaca per grafik | 1.235 | **565** |
| 🧪 Ukuran satu hari data mentah | 623 MB | **416 MB** |
| Ekspor Excel 10 sensor | ~4.000 permintaan dari browser | **1 permintaan** |
| Arsip 300 sensor / 15 plant | 300 file, 300 email | **15 file, 15 email** |
| Pesan Realtime ke tiap browser | semua sensor armada | **hanya yang tampil** |

**Pembuktian yang paling penting:** angka grafik sebelum dan sesudah dibandingkan
pada data nyata — **1.008 titik grafik, nol perbedaan**, dibandingkan pada
presisi yang benar-benar dikirim ke browser.

---

## 3. Apa yang diperbaiki, per temuan

| # | Temuan | Yang dilakukan |
|---|---|---|
| **D-1** | Data tak terbagi & tak punya identitas plant | `scada_raw` dibagi per hari; tiap baris membawa `site_id` |
| **D-2** | Tidak ada index waktu | Ditambahkan; sapuan berubah dari menyisir jadi menyasar |
| **D-3** | Tiap PC menyapu seluruh tabel tiap menit | Pindah ke satu pemilik di server, lalu diganti buang-laci |
| **D-4** | Tiap PC menyambung ke semua broker | `SITE_ID` per PC; kredensial plant lain tak pernah sampai ke sana |
| **D-6** | Mini-grafik tanpa batas & tanpa cache | Dibatasi 60 sensor + cache 45 detik + baca ringkasan |
| **D-7** | Ekspor dirakit di browser, boros memori | Pindah ke server, ditulis mengalir ke berkas |
| **D-8** | Semua sensor jatuh tempo bersamaan | 1 file per plant, dibatasi per putaran, jadwal disebar |
| **D-9** | Cadangan bridge cuma 1 nilai per sensor | Jadi antrian sungguhan, dengan batas atas |
| **D-10** | Hapus riwayat di tengah klik pengguna | Jadi tugas latar, dihapus bertahap |
| **D-11** | `/summary` cari nilai terakhir lewat jalan memutar | Baca langsung dari papan skor |
| **D-12** | Mesin alarm menembak 1 query per sensor | Digabung jadi satu, tetap cepat |

**D-5** (cara menulis `COPY`) **belum dikerjakan** — benchmark menunjukkan pada
300 sensor beban tulis cuma memakai 2% dari anggaran waktu bridge, jadi belum
mendesak. Angkanya ada di bagian 6 kalau nanti diperlukan.

---

## 4. Enam masalah yang ditemukan **sambil** mengerjakan

Ini bukan bagian dari audit — semuanya muncul saat pengerjaan atau pengujian.

1. **Grafik aneh sesaat saat halaman dibuka.** Ternyata bukan data kotor
   (nol data simulator di database). Layar menggambar jendela waktu yang salah
   selagi data asli dimuat: 3 detik data diregangkan sepenuh kotak. Sekarang
   menampilkan garis datar "memuat…".

2. **Tulisan toggle "Simpan data" jadi bohong.** Setelah ringkasan aktif, sensor
   tanpa centang tetap punya riwayat panjang — padahal layar bilang "data lama
   otomatis terhapus". Tulisannya diperbaiki.

3. **Index `scada_ring` menggembung 50×** (36 MB untuk 15 ribu baris) akibat
   tulis-hapus terus-menerus — persis yang diperingatkan audit. Hilang sendiri
   begitu tabel lama dihapus.

4. **Ekspor menghasilkan berkas kosong.** Pembangun berkas membaca lajur arsip,
   padahal semua sensor Anda mode ring. Ketahuan dari uji coba kering.

5. **Ekspor menghasilkan baris kembar.** Karena data lama **disalin** (bukan
   dipindah) demi bisa dibatalkan, kaca pengintip mengembalikan tiap baris dua
   kali. Berbahaya karena **angka grafik kebetulan tidak terpengaruh** —
   menggandakan nilai identik tidak mengubah rata-rata/min/maks — jadi lolos
   dari semua pemeriksaan otomatis dan baru ketahuan saat ada manusia membuka
   berkasnya.

6. **Pengaman pembuang laci nyaris tidak berfungsi.** Versi pertama menghitung
   juga laci kosong masa depan, sehingga pengamannya praktis mati. Diganti jadi
   "laci terbaru tidak pernah boleh dibuang".

---

## 5. Langkah terakhir: tabel lama sudah dihapus

`scada_ring` dihapus 27 Juli, setelah empat prasyarat diverifikasi:

1. ✅ Bridge baru aktif di PC lapangan (detak jantung ada, `scada_raw` menerima
   data, `scada_ring` diam 1,5 jam)
2. ✅ Penyapuan terakhir selesai — 2.464 baris sisa disalin, 0 tersisa
3. ✅ Diperiksa baris demi baris **termasuk nilainya**: 0 baris `scada_ring`
   tanpa padanan persis di `scada_raw`; 77.512 = 77.512 pada rentang yang sama
4. ✅ Tiga salinan tetap ada sesudahnya: `scada_raw`, ringkasan per menit, dan
   cuplikan CSV di `db/snapshots/2026-07-26-plant-tanobel/`

Efek sampingnya menyenangkan: **ukuran database turun 65 MB → 36 MB**, karena
index menggembung 36 MB yang jadi bukti temuan D-2/D-3 ikut lenyap bersama
tabelnya.

Kaca pengintip kembali sederhana (`scada_raw ∪ scada_samples`), dan tambalan
anti-duplikat dari masa transisi ikut dilepas.

Kode yang jadi mati sudah dibersihkan: pembersih ring, alat bantu transisi, dan
`prune_ring` di bridge — **bridge sekarang tidak pernah menghapus apa pun.**

## 6. Yang perlu Anda perhatikan sebelum plant pertama

### 6.1 Penyimpanan — ini yang paling perlu keputusan

Ukuran sesungguhnya **±2× perkiraan dokumen arsitektur** (204 byte/baris ringkasan,
bukan ~100):

| | Ringkasan 30 hari | Mentah (2–3 laci) | **Total** |
|---|---|---|---|
| **Pilot 300 sensor** | 2,46 GB | 0,8–1,25 GB | **≈ 3,3–3,7 GB** |
| 1.000 sensor | 8,20 GB | 2,8–4,2 GB | ≈ 11–12,4 GB |

**Tier gratis Supabase (500 MB) tidak cukup.** Pro (8 GB) cukup untuk pilot 300
sensor, tidak untuk 1.000. Knop pengecil kalau perlu, tanpa mengubah arsitektur:
perpendek retensi ringkasan 30 → 14 hari (separuh), atau tambah lapis ringkasan
15-menit untuk data di atas 7 hari.

### 6.2 Retensi sekarang perkiraan, bukan tepat

Karena membuang per laci harian, satu baris hidup **24–48 jam**, bukan tepat 24.
Setelan `ring_window_h` berarti "**minimal** sekian jam". Ringkasan bulanan:
30–60 hari. Kalau ketepatan penting, laci per jam bisa dipakai — cuma mengubah
satu angka.

### 6.3 Isi `SITE_ID` begitu ada plant kedua

Selama masih satu plant, boleh kosong. Begitu ada plant kedua, **wajib** diisi di
`config.env` tiap PC — kalau tidak, setiap PC menyambung ke semua broker, menulis
data semua plant, dan menyimpan password broker plant lain di harddisknya.

### 6.4 Satu pemilik untuk tugas latar

Kalau menjalankan backend di laptop sambil Railway hidup, tambahkan ke `.env` laptop:
```
PARTITION_MANAGER_ENABLED=0
ROLLUP_ENABLED=0
ALARM_ENGINE_ENABLED=0
HEALTH_MONITOR_ENABLED=0
```

### 6.5 Penghapus ringkasan sengaja MATI

`ROLLUP_KEEP_MONTHS=0` = tidak pernah membuang. Sebulan ringkasan adalah
satu-satunya salinan periode itu setelah laci mentahnya dibuang; ia baru boleh
dibuang setelah ada konfirmasi bulan itu aman di Google Drive. **Nyalakan hanya
setelah arsip per-plant terbukti jalan di produksi.**

### 6.6 Laci harus selalu tersedia di depan

Hari tanpa laci = baris **ditolak** database, diam-diam, tengah malam. Pengaman:
laci dibuat 7 hari di muka, dicek tiap jam, dan backend menulis log ERROR kalau
sisa laci depan kurang dari 2 hari. **Backend harus mati seminggu penuh baru
jadi masalah** — tapi kalau melihat error itu di log, tangani hari itu juga.

### 6.7 Urutan waktu penting untuk hemat penyimpanan

Penghematan 33% ukuran mentah bergantung pada baris masuk **berurutan waktu**.
Bridge memang begitu. Kalau nanti ada penulis lain yang menyisipkan data lama,
penghematan itu hilang diam-diam (tidak rusak, cuma boros).

---

## 7. Alat bantu yang bisa Anda jalankan sendiri

Semua aman, semua bisa diulang.

| Perintah | Gunanya |
|---|---|
| `python backend/scripts/archive_dry_run.py --list` | Plant & sensor mana yang akan diarsipkan |
| `python backend/scripts/archive_dry_run.py --days 7` | **Rakit berkas arsip sungguhan ke komputer Anda** — tanpa unggah, tanpa email, tanpa hapus |
| `python backend/scripts/rollup_backfill.py --dry-run` | Ringkasan tertinggal? |

`--dry-run` selalu berarti: tidak menulis apa pun.

---

## 8. Yang sengaja TIDAK diubah

- Aturan **"tidak ada arsip sukses → tidak ada penghapusan"** — utuh, tiap kali ditulis ulang.
- **Lubang dibiarkan kosong** saat sensor diam. Sistem tidak pernah mengarang nilai.
- **Kunci (sensor, waktu) + tolak duplikat** di semua penulis — proses dobel tidak pernah bisa menggandakan data.
- **Klaim per sensor saat mengarsip** — dua backend tidak bisa mengarsip ganda.
- **Bridge tidak pernah crash** — semua error ditangkap, loop terus jalan.
- **Siklus arsip tetap per sensor.** Dokumen membayangkan per plant; itu redesain berisiko yang menyentuh alarm dan konfigurasi tiap sensor. Yang dikelompokkan per plant adalah **berkasnya**, bukan jam siklusnya.

---

## 9. Sisa pekerjaan

| Pekerjaan | Kenapa ditunda |
|---|---|
| **D-5** — cara menulis `COPY` | Belum mendesak: 2% anggaran pada 300 sensor |
| **Cabut izin berlebih peran `anon`** | Saat ini tidak berbahaya (ditolak lapis lain), tapi menambah lapis kedua. Menyentuh semua tabel, bukan cuma R-Net |
| **Utang lint lama** | 17 error di berkas non-R-Net, tidak tersentuh pekerjaan ini |

### ✅ SELESAI 30 Juli 2026 — `scada_samples` dipensiunkan

Baris **"Lebur `scada_samples` ke `scada_raw`"** di tabel ini sudah dikerjakan.
Yang membuatnya jauh lebih ringan dari perkiraan: saat diperiksa, lajur itu
ternyata **sudah tidak dipakai sama sekali** — 0 baris, 0 tag bercentang, dari
17 tag. Jadi tidak ada arsip final, tidak ada migrasi data, tidak ada masa soak;
hanya pembersihan kode dengan migrasi berpagar (`p6q7r8s9t0u1`).

Tidak perlu deploy ke PC lapangan: `bridge.py` memilih lajur dari **data**
(`config.store_enabled`, dibaca ulang tiap 30 detik), bukan dari kode.

**Kerugian fidelitas, jujur.** Nilai mentah kini 24-48 jam untuk semua sensor,
padahal tag bercentang dulu menyimpannya ±1 bulan. Kecil, karena tag store sudah
dibatasi slow/slowest:

| Level | Dulu | Sekarang | Hilang |
|---|---|---|---|
| slowest 60 dtk | 30 hari mentah @60 dtk | ringkasan `n=1`/menit | **tidak ada** (rata=min=maks) |
| slow 30 dtk | 30 hari mentah @30 dtk | ringkasan `n=2`/menit | hanya urutan 2 sampel dalam 1 menit |

Naikkan `ring_window_h` di Panel Administrasi → R-Net kalau butuh mentah lebih
panjang; di skala sekarang biayanya nol.

**Dua bug ikut diperbaiki karena pensiun ini akan memunculkannya:**
jendela alarm bisu dulu memberi lantai 60 detik untuk tag non-store — setelah
pensiun semua tag masuk cabang itu, dan sensor *slowest* (interval 60 detik)
akan kedip-kedip bisu/normal selamanya; dan `DELETE` di archiver tidak berbatas
`ts` padahal workbook-nya hanya mencakup `[cycle_start, now)`.

---

## 10. Uji yang menjaga semua ini

```
214 tes backend  (dari 149 sebelum pekerjaan ini)
 33 tes frontend
```

Yang paling penting adalah tes yang mengunci hal-hal yang **kalau salah merusak
data diam-diam**:

- Rata-rata tertimbang cocok dengan hitungan mentah — **termasuk tes yang
  membuktikan cara sederhana `avg(avg)` akan salah**, supaya tidak ada yang
  "menyederhanakannya" nanti.
- Bucket ringkasan **selalu** kelipatan menit bulat, untuk semua kombinasi
  rentang × jatah titik yang API terima.
- Laci hari baru selalu dibuat sebelum laci lama dibuang.
- Laci terbaru tidak pernah bisa dibuang, apa pun kata jam sistem.
- Antrian cadangan bridge menyimpan **setiap** bucket saat database mati —
  bukan cuma nilai terakhir.
- Judul sheet Excel selalu unik (label "Holding" ada **tiga** di database Anda;
  duplikat membuat Excel menolak seluruh berkas).
