# Ringkasan Kerja — 28 Juli 2026

Satu sesi, tujuh commit, `24debb6..1b83ca9` di `main`.
Temanya satu: **membuat R-Net sanggup menerima plant 300 sensor**, dan
membereskan apa saja yang patah waktu dicoba.

---

## 1. Status verifikasi (dicek langsung ke production, 28 Juli 19:13)

| Yang dicek | Hasil |
|---|---|
| Alembic di database | `o5p6q7r8s9t0` — **sudah sama dengan head repo** |
| Tabel `scada_rollup_archives` | ADA |
| Tabel `scada_topic_probe` | ADA |
| Jembatan yang **sedang berjalan** | versi baru — Pemantau Topik terisi 16 baris, umur 3–9 detik |
| Data masuk | mengalir, `scada_raw` terakhir 0 menit lalu |
| Heartbeat jembatan | `connected = true` |
| `C:\rein-scada\data\bridge.py` di laptop ini | **basi** (27 Juli, 44 KB, tanpa dukungan paket gabungan) |

Kesimpulan: **production sudah jalan dengan kode baru.** Salinan di
`C:\rein-scada` pada laptop ini tinggalan lama yang tidak dipakai — yang
berjalan ada di tempat lain. Kalau suatu saat jembatan dijalankan dari path
itu, ia akan mundur ke perilaku lama; sebaiknya ditimpa atau dihapus.

### Satu hal yang masih perlu Anda ubah

Tag **`tes`** masih mencampur dua tangki. 15 menit terakhir:

```
Premix (line1/level1)   228 baris   nol   0 (  0,0%)   nilai 14,0
Premix (line2/level1)   227 baris   nol 227 (100,0%)   nilai 0,0
tes                      46 baris   nol  29 ( 63,0%)   nilai 0,0 .. 14,0
```

Topiknya `fikri/rnet/lombok/all` memuat kedua gateway, dan keduanya punya
`waterlevel1`. **Isi kolom Perangkat tag itu dengan `lombok1.waterlevel1`.**

### Sampling: terbukti benar

Jarak antar baris `tes` 15 menit terakhir: **50 dari 51 jaraknya tepat 5
detik** — persis level `fast` yang tersetel. Keluhan "sampling tidak bekerja"
kemarin berasal dari membandingkan data lama terhadap pengaturan baru: log
audit menunjukkan levelnya diubah `fastest`→`fast` pada 11:09:35, sedangkan
data terakhir di file ekspor jam 11:07:58 — 97 detik sebelumnya.

---

## 2. Yang dikerjakan

### A. Bentuk data di kabel — satu topik per gateway

```
sebelum   14 sensor = 14 topik = 14 pesan MQTT tiap gateway lapor
sesudah    2 gateway =  2 topik =  2 pesan
```

Terukur di plant ini: **4,6 → 0,7 pesan/detik** untuk pembacaan yang sama.

Nama kunci ditulis polos (`waterlevel1`), tanpa awalan gateway — nama gateway
sudah ada dua kali di paket (di topik dan di kolom `gateway`), jadi
mengulangnya di tiap kunci memakan ~8 byte per nilai tanpa memberi informasi.

| 50 plant, 15.000 tag | pesan/detik | bandwidth |
|---|---|---|
| satu topik per sensor | 5.000 | 2,57 Mbps |
| gabungan, kunci panjang | 167 | 1,86 Mbps |
| **gabungan, kunci pendek** | **167** | **1,54 Mbps** |

> **Catatan jujur:** bandwidth bukan alasan sebenarnya untuk pindah. Hematnya
> 40%, tapi 2,57 Mbps itu kecil untuk VPS mana pun. Alasan sebenarnya cuma
> satu, dan itu cukup: 15.000 tag dengan cara lama berarti **30.000 kotak
> Node-RED yang diketik tangan**, dan tidak ada yang bisa merawatnya.

Topik masuk di Node-RED ditulis **lengkap per gateway**, bukan `+` — atas
permintaan Anda. Menambah gateway = salin satu kotak `mqtt in`, ganti
topiknya, tarik garis. Kotak "Tempel Label" tidak pernah disentuh.

### B. Jembatan membaca paket gabungan

`SiteCfg.topics` (topik → 1 tag) menjadi `routes` (topik → {nama → tag}),
di mana **nama diambil dari kolom Perangkat**. Itu seluruh perubahan strukturalnya: satu topik kini bisa memberi
makan 300 tag.

Empat penjaga yang ditambahkan, semuanya untuk kegagalan yang **tidak punya
gejala**:

- **`float()`, bukan pembaca-awalan.** Nomor seri gateway Line 2 diawali
  angka; `parseFloat("31c73eb96aaf…")` = 31 dan masuk database terlihat
  seperti pembacaan wajar. Ketahuan dari tangkapan lapangan, bukan review.
- **Nama salah ketik dilaporkan sekali**, lengkap dengan daftar nama yang
  benar-benar dikirim gateway.
- **Satu paket = satu transaksi disk.** Dulu tiap nilai punya
  DELETE+INSERT+COMMIT+count(\*) sendiri: 300 sensor = 300 fsync beberapa kali
  sedetik di PC lapangan.
- **Topik gabungan di-subscribe QoS 1**, topik polos tetap QoS 0. Bundling
  mengubah harga satu paket hilang dari 1 pembacaan jadi 7; pengukuran 2 jam:
  jalur QoS 0 kehilangan 231 dari 34.692, jalur QoS 1 kehilangan 0.

### C. Nama yang bertabrakan — cacat yang ditemukan dari data Anda

Ekspor 28 Juli, jendela 10:45–11:07, sensor yang sama dibandingkan berdampingan:

```
rnet/lombok/line1/level1   438 baris   nol   0 (  0,0%)   nilai 12–13
rnet/lombok/line2/level1   442 baris   nol 442 (100,0%)   nilai 0
tag baru (waterlevel1)     642 baris   nol 282 ( 43,9%)   nilai 0/12/13
```

Tidak ada nilai yang salah — kolomnya yang berisi **dua tangki**. Setiap line
punya `waterlevel1`; selama ini yang membedakan adalah topiknya. Begitu satu
topik memuat seluruh plant, nama polos berhenti unik.

Perhatikan barisnya **naik** (642 vs 438). Itu justru gejalanya: dua gateway
mengisi satu penampung. Tidak ada error, tidak ada data hilang, jumlah baris
malah bertambah.

**Perbaikannya**: nama nilai itu ditulis di kolom **Perangkat** — satu kotak,
di tabel, bukan dua kotak di dua tempat:

| Bentuk topik | Isi kolom Perangkat |
|---|---|
| `rnet/lombok/gw/lombok1` | `waterlevel1` |
| `fikri/rnet/lombok/all` | `lombok1.waterlevel1` |

Plus jembatan sekarang **menangkap sendiri** kalau satu nama polos dikirim
lebih dari satu gateway di topik yang sama, dan menulisnya sekali di log.

### D. Arsip + retensi ringkasan 1 menit

Celah yang paling menentukan untuk 50 plant. R-Net punya dua jalur simpanan
panjang; sebelum ini baru satu yang selesai:

```
scada_samples    sensor "Simpan data"   -> arsip xlsx, lalu direset   ✅ ada
scada_rollup_1m  SEMUA sensor, 1 menit  -> tidak ada apa-apa          ❌ bolong
```

Yang kedua justru tumpuan rancangan Anda: nilai mentah bertahan 24–48 jam,
jadi begitu laci hariannya dibuang, **ringkasan per-menit ITULAH riwayatnya**
— untuk setiap sensor, dicentang "Simpan data" atau tidak.

Alurnya, mempertahankan aturan emas dari arsip yang lama:

```
① klaim (pabrik, bulan)          ⑤ email sekali per pabrik per bulan
② satu .zip per pabrik           ═══════════════════════════════════
   satu CSV per sensor           ⑥ laci bulan itu baru dibuang setelah
③ unggah ke Drive                   SEMUA pabrik punya tanda ④
④ catat id file = TANDA SELESAI
```

`ROLLUP_KEEP_MONTHS` naik dari `0` ke `1` (ringkasan hidup 30–61 hari). Angka
itu bukan pengamannya — pengamannya gerbang ⑥, yang menolak bulan mana pun
tanpa bukti di buku induk, setua apa pun bulan itu.

Formatnya `.zip` berisi CSV, bukan `.xlsx`: rancangan lama menghitung 20
sensor per pabrik, tapi di 300 sensor itu 13 juta sel dalam satu file.

**Arsip pertama baru akan berjalan 1 September 2026** — laci ringkasan baru ada
sejak Juli, dan retensinya menyimpan satu bulan penuh. Anda punya waktu
sebulan untuk mengujinya lewat tombol manual
`POST /api/scada/rollup-archives/run` (tidak menghapus apa pun).

### E. Impor sensor massal

Sensor sebelumnya hanya bisa dibuat satu per satu. Untuk klien 300 sensor itu
**bottleneck sebenarnya** — bukan MQTT, bukan penyimpanan.

Tombol **Impor Sensor** di toolbar Analisis: tempel CSV dari spreadsheet,
lihat pratinjau, impor. **Semua-atau-tidak sama sekali** — kalau ada satu
baris bermasalah, tidak ada satu pun sensor dibuat. Daftar setengah jadi lebih
buruk daripada ditolak.

Pemeriksaan terpenting: **(topik, perangkat) yang kembar**, dicek terhadap daftar
yang ditempel dan terhadap sensor yang sudah ada — karena satu typo yang
diseret ke bawah satu kolom spreadsheet persis begitu terjadinya.

### F. Pemantau Topik

Mengisi kolom Perangkat berarti mengetik nama yang harus sama persis dengan
variabel di script gateway. Sebelum ini satu-satunya cara mengetahuinya adalah membuka
Node-RED di PC lapangan lewat remote desktop.

Sekarang: **Analisis → Pemantau Topik**. Per (topik, gateway), paket terakhir
yang masuk, sudah diurai jadi nama → nilai, dengan penanda sensor mana yang
sudah memakainya. Klik untuk menyalin nama field-nya.

Tombol salin menyertakan nama gateway-nya: yang tertempel langsung berbentuk
`lombok1.waterlevel1`. Bentuk lengkap itu benar di **kedua** macam topik — di
topik per gateway awalannya dikupas karena cocok dengan gateway paket itu —
jadi tidak ada yang perlu ditebak orang yang menyalin.

Bukan log berjalan: satu baris per (topik, gateway), ditimpa terus. "Topik ini
mengirim apa" itu pertanyaan tentang **sekarang**; menyimpan tiap pesan di 300
sensor jadi gigabyte per hari untuk jawaban yang sama.

Yang sudah terbukti jalan hari ini: tabelnya menampilkan `fikri/rnet/lombok/all`
**dua kali** — `lombok1` dan `lombok2` — jadi tabrakan seperti di atas sekarang
kelihatan mata, bukan lagi harus ketahuan dari ekspor.

### G. Satu kotak, bukan dua

Revisi terakhir, atas masukan Anda. Sempat ada kotak **Field** di dialog Sumber
DAN kolom **Perangkat** di tabel — dua tempat untuk satu hal, dan tidak ada yang
bisa membedakan mana untuk apa.

Sekarang tinggal satu: **Perangkat** = nama nilai itu di sumbernya. Dialog
Sumber hanya mengatur topik.

Yang membuatnya aman untuk 14 sensor produksi: bentuk paket tidak lagi
ditentukan konfigurasi, tapi **per pesan**. Nama dicoba dicocokkan ke dalam
payload; kalau tidak ada yang cocok, payload dibaca sebagai satu angka polos —
persis perilaku lama. Sensor produksi berisi `DEV-01`/`boiler1` di kolom itu,
tidak cocok dengan apa pun, jadi tetap jalan tanpa disentuh.

Sisa `mqtt_field` dari versi kemarin diabaikan, dan jembatan menulis peringatan
sekali kalau menemukannya — supaya tidak jadi kebingungan yang sama dalam baju
baru. Membuka Sumber lalu Simpan sekali akan membersihkannya.

### H. Halaman Analisis siap 300 sensor

Ditemukan saat memperbaiki batas sparkline; semuanya penyakit yang sama —
kode ditulis dengan anggapan "semua sensor muat dalam satu permintaan":

| Di 300 sensor | Sebelum | Sesudah |
|---|---|---|
| Data mentah per baris | **300 permintaan HTTP / 60 dtk** | 1 (baris yang dibuka saja) |
| Sparkline | 60 sensor acak dapat grafik | semua baris di halaman |
| Seed nilai live | hanya 100 pertama | semua, dipecah per 100 |
| Refresh manual | hanya 100 pertama | semua, dipecah per 100 |

Pengikatnya paginasi (25/50 per halaman). Pager **menghilang** kalau semuanya
muat satu halaman, jadi tabel 14 sensor Anda terlihat persis seperti dulu.

### I. Dua lane tidak boleh saling menjatuhkan

Ditemukan saat memeriksa urutan rilis: `railway.json` hanya menjalankan
uvicorn, jadi **production tidak menjalankan migrasi saat deploy**. Di jendela
antara kode tayang dan migrasi dijalankan, `drop_expired_rollup` melempar
error — dan karena kedua lane berbagi satu transaksi, error itu menggulung
balik penghapusan partisi **lane 24 jam** yang sudah berjalan.

Gejalanya lambat dan sunyi: `scada_raw` berhenti dipangkas dan tumbuh
**~2,8 GB/hari/plant**, sementara log cuma bilang "maintenance iteration
failed" sekali sejam.

Sekarang lane ringkasan punya transaksi sendiri. Deploy sebelum migrasi jadi
aman.

---

## 3. Yang masih tersisa

| # | Tindakan | Mendesak? |
|---|---|---|
| 1 | Ubah **Perangkat** tag `tes` jadi `lombok1.waterlevel1` | ya — datanya masih tercampur |
| 2 | Timpa/hapus `C:\rein-scada\data\bridge.py` yang basi di laptop ini | sedang |
| 3 | **Tahap 4** — pindahkan 14 sensor asli ke topik+field baru | menunggu keputusan Anda |
| 4 | Tahap 5 (soak 48 jam) → Tahap 6 (matikan flow lama) | setelah Tahap 3 |
| 5 | Uji `POST /api/scada/rollup-archives/run` sebelum 1 September | sebulan lagi |

Tahap 4 adalah titik balik yang Anda sendiri minta saya berhenti dan lapor
dulu — belum saya sentuh.

---

## 4. Angka

```
commit                    7  (24debb6..1b83ca9 di main)
migrasi baru              2  (n4o5p6q7r8s9, o5p6q7r8s9t0) — sudah dijalankan
tes backend             302  lulus
uji flow Node-RED        29  lulus
tes baru sesi ini        ~65
utang lint frontend      17  (admin/library/dcc — nol di file yang disentuh)
```

Tiga cacat yang ditemukan dari **data lapangan**, bukan dari membaca kode:

1. Nomor seri gateway terbaca sebagai sensor bernilai 31
2. Denyut 1 detik membuang 2,0% pembacaan
3. Dua gateway berbagi nama field, mencampur dua tangki jadi satu kolom

Ketiganya tidak menghasilkan error apa pun. Semuanya ketahuan karena angkanya
dibandingkan berdampingan dengan jalur lama pada jendela waktu yang sama.
