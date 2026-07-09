# Panduan Data Sensor R-Net via MQTT (Broker → V-Net → R-Net)

> Untuk **siapa pun yang bisa klik mouse** — tidak perlu ngerti coding.
> Tujuannya: menarik data sensor/PLC dari lapangan lewat **MQTT**, menyimpannya
> rapi di R-Net, lalu menampilkannya (tabel, grafik, gauge, bar, alarm) dan
> mengekspornya ke Excel. Semua pengaturan dilakukan **dari halaman R-Net** —
> tidak perlu buka database.
>
> Panduan ini pendamping panduan streaming (`PANDUAN-SERVER-SCADA.md`). Kalau
> Anda sudah punya PC server yang menjalankan streaming, **jembatan MQTT di
> panduan ini dipasang di PC yang sama** (satu server untuk semuanya).

---

## 1. Gambaran Besar — Seperti Kantor Pos

```
┌──────────┐   ┌───────────┐   ┌──────────────┐   ┌───────────┐   ┌──────────┐
│  Sensor  │──▶│  V-Box /  │──▶│    Broker    │──▶│ Jembatan  │──▶│  R-Net   │
│  / PLC   │   │  V-Net    │   │    MQTT      │   │ (bridge)  │   │ (Analisis│
│          │   │ (pengirim)│   │ (kantor pos) │   │(kurir→DB) │   │ + panel) │
└──────────┘   └───────────┘   └──────────────┘   └───────────┘   └──────────┘
     lapangan ───────────────┘        internet          server        browser
```

| Bagian | Fungsi | Analogi |
|---|---|---|
| **Sensor / PLC** | Mengukur suhu, tekanan, arus, dll | Sumber kabar |
| **V-Box / V-Net** | Membaca PLC, mengirim nilainya ke broker (MQTT publish) | Pengirim surat |
| **Broker MQTT** | Menampung pesan, meneruskan ke yang berlangganan | Kantor pos |
| **Jembatan (bridge)** | Berlangganan topik, menuliskan nilai ke database R-Net tiap menit | Kurir dari kantor pos ke gudang |
| **R-Net** | Menyimpan, menghitung, menampilkan, mengekspor | Gudang + ruang pamer |

**Kunci yang harus cocok di ketiga sisi:** **TOPIK**. Topik yang dipublish
V-Box harus **persis sama** dengan topik yang Anda daftarkan di R-Net. Anggap
topik = alamat tujuan surat. Salah satu huruf beda → surat tak sampai.

Konvensi topik yang disarankan (boleh Anda ubah, yang penting konsisten):
```
rnet/<lokasi>/<perangkat>/<ukuran>
contoh:  rnet/tanobel/boiler1/suhu
         rnet/tanobel/boiler1/tekanan
         rnet/plandaan/pompa2/arus
```

**Format isi pesan (payload)** yang diterima R-Net:
```json
{"value": 72.5}
```
atau angka polos saja: `72.5`. (Boleh menambah `"ts"` ISO-8601 kalau perangkat
mengirim waktunya sendiri; kalau tidak, R-Net memakai waktu saat pesan tiba.)

---

## 2. BAGIAN A — Siapkan Broker MQTT (sekali saja)

Broker adalah "kantor pos". Pilih **salah satu**:

### Opsi 1 — Broker awan (paling mudah, tanpa server sendiri) ✅ disarankan untuk mulai

Pakai layanan broker siap pakai, mis. **HiveMQ Cloud** atau **EMQX Cloud**
(punya paket gratis untuk perangkat sedikit).

1. Daftar akun → buat satu "cluster/broker".
2. Buat **user + password** broker (mis. user `rnet`, password kuat).
3. Catat 4 hal ini — nanti dipakai di R-Net **dan** di V-Box:
   - **Host** (mis. `xxxxx.s1.eu.hivemq.cloud`)
   - **Port** (biasanya `8883` untuk TLS, atau `1883` tanpa TLS)
   - **User**
   - **Password**

> TLS (port 8883) = koneksi terenkripsi, disarankan untuk broker awan. Pastikan
> V-Box Anda mendukung MQTT over TLS bila memakai port 8883.

### Opsi 2 — Broker sendiri (Mosquitto) di PC server Anda

Kalau ingin semuanya di dalam kendali sendiri (dan V-Box berada di jaringan yang
bisa menjangkau server ini):

1. Unduh **Mosquitto** dari https://mosquitto.org/download (Windows/Linux).
2. Buat user + password (jangan biarkan anonim):
   ```
   mosquitto_passwd -c C:\mosquitto\passwd rnet
   ```
   (masukkan password saat diminta)
3. Buat file config `mosquitto.conf`:
   ```
   listener 1883
   allow_anonymous false
   password_file C:\mosquitto\passwd
   ```
4. Jalankan Mosquitto sebagai service (Windows: installer-nya sudah menyediakan
   service; Linux: `systemctl enable --now mosquitto`).
5. Buka port `1883` di firewall **hanya** dari jaringan tepercaya (jangan buka
   ke seluruh internet tanpa TLS).
6. Catat 4 hal yang sama: **Host** (IP/hostname server), **Port** `1883`,
   **User** `rnet`, **Password**.

> Ada file contoh untuk tes lokal: `deploy/scada/mqtt-bridge/mosquitto-local-test.conf`.

---

## 3. BAGIAN B — Siapkan sisi V-Net / V-Box (pengirim data)

Tujuannya: menyuruh V-Box **mem-publish** nilai PLC ke broker dengan topik dan
format yang benar. Menu persisnya berbeda antar firmware V-Net/V-Box, tetapi
**yang harus ada** selalu sama:

1. **Aktifkan MQTT Client** di V-Box (kadang namanya "MQTT", "Cloud Publish",
   atau "Data Transfer → MQTT").
2. **Alamat broker:** isi Host + Port dari Bagian A. Kalau port 8883, aktifkan
   **TLS/SSL**.
3. **Kredensial:** isi User + Password broker.
4. **Client ID:** bebas tapi **unik** per V-Box (mis. `vbox-tanobel-01`). Dua
   perangkat dengan Client ID sama akan saling menendang dari broker.
5. **Petakan tiap titik data (register PLC) ke satu topik.** Untuk setiap
   sensor buat satu entri publish:
   - **Topic:** `rnet/tanobel/boiler1/suhu` (sesuai konvensi di Bagian 1)
   - **Payload:** usahakan format JSON `{"value": <nilai>}`. Kalau V-Box hanya
     bisa mengirim **angka mentah** (mis. nilai register 0–65535 atau 4–20 mA
     dalam satuan mentah), **tidak apa-apa** — R-Net bisa mengubahnya ke satuan
     asli lewat **Scaling** (Bagian C-3). Jadi kirim apa adanya.
   - **Interval:** kirim tiap **1–60 detik**. R-Net menyimpan 1 nilai/menit, jadi
     lebih sering dari itu tidak menambah baris (nilai terbaru per menit yang
     dipakai) — pilih interval yang nyaman untuk V-Box & jaringan.
6. **QoS:** 0 atau 1 keduanya diterima. QoS 1 lebih tahan kalau jaringan labil.
7. Simpan & terapkan. Kalau V-Box punya tombol **Test/Publish now**, gunakan itu
   untuk mengirim satu nilai percobaan.

> **Cara cek V-Box sudah mengirim** (tanpa R-Net): dari komputer mana pun yang
> bisa menjangkau broker, jalankan:
> ```
> mosquitto_sub -h <host> -p <port> -u <user> -P <password> -t "rnet/#" -v
> ```
> Kalau nilai-nilai bermunculan, sisi V-Box sudah benar. `rnet/#` = "semua topik
> di bawah rnet".

---

## 4. BAGIAN C — Siapkan sisi R-Net (penerima & tampilan)

Semua langkah di bawah dilakukan di halaman **R-Net → tab Analisis**. Butuh izin
**Kelola R-Net** (`scada:manage`).

### C-1. Daftarkan broker sebagai "Site"

1. R-Net → **Analisis** → tombol **Kelola Site** → **Tambah Site**.
2. Isi dari Bagian A:
   - **Nama:** bebas, mis. "Broker Tanobel"
   - **Host Broker**, **Port**
   - **User Broker**, **Password Broker**
   - **Topik Dasar:** opsional (sekadar catatan, mis. `rnet/tanobel`)
   - Centang **Site aktif**.
3. Simpan. (Password broker disimpan aman — tidak pernah ditampilkan lagi;
   kosongkan saat mengedit kalau tidak ingin menggantinya.)

### C-2. Tambahkan tag (satu baris = satu sensor)

1. Di grid Analisis, klik **+ Tambah Baris**. Muncul baris baru.
2. Isi **Nama** (mis. "Suhu Boiler 1") dan **Unit** (mis. `°C`) — klik selnya.
3. Klik sel **Sumber** pada baris itu → pilih **MQTT**:
   - **Site:** pilih broker dari C-1.
   - **Topik MQTT:** ketik **persis** topik dari V-Box, mis.
     `rnet/tanobel/boiler1/suhu`.
   - (Alarm & Scaling — lihat di bawah.)
4. Simpan. Jembatan (Bagian D) akan mulai berlangganan topik ini dalam ~30 detik,
   **tanpa restart**. Nilai pertama muncul di kolom **Terkini** dalam ≤1 menit.

### C-3. Scaling / Kalibrasi (mengubah nilai mentah → satuan asli)

Ada di dialog **Sumber** (mode MQTT), kotak **Scaling / Kalibrasi**. Rumusnya:

```
nilai_tersimpan = nilai_mentah × Skala + Offset
```

Gunakan ini kalau V-Box mengirim angka mentah, bukan satuan sebenarnya:

| Kasus | Skala | Offset | Contoh |
|---|---|---|---|
| Nilai sudah benar (tak perlu ubah) | `1` | `0` | 72.5 → 72.5 |
| Sinyal 4–20 mA → 0–100 % | `6.25` | `-25` | 4 mA → 0 ; 20 mA → 100 |
| ADC 0–1023 → 0–102.3 | `0.1` | `0` | 512 → 51.2 |
| Kalibrasi nol (geser 5 ke atas) | `1` | `5` | 20 → 25 |

- **Desimal:** berapa angka di belakang koma yang disimpan (kosong = apa adanya).
- Kotak dialog menampilkan **contoh langsung** ("nilai mentah 100 tersimpan
  jadi …") supaya Anda yakin sebelum menyimpan.
- ⚠️ **Berlaku untuk data baru saja.** Data yang sudah tersimpan tidak berubah
  surut. Set scaling **sebelum** mulai mengumpulkan data penting.

### C-4. Alarm (ambang batas per tag)

Di dialog **Sumber** yang sama, isi **Alarm bila <** (batas bawah) dan/atau
**Alarm bila >** (batas atas). Nilai di luar rentang itu ditandai **merah** di
panel Alarm. Kosongkan kalau tag ini tidak perlu alarm.

### C-5. Tampilkan di Monitor (grafik, gauge, bar, tabel, alarm)

**Cara cepat dari Analisis:** centang beberapa tag → muncul bilah aksi → klik
**Buat Grafik / Buat Gauge / Buat Bar**. Panel langsung ditambahkan ke layout
Monitor aktif.

**Cara lengkap:** ke mode **Monitor** → **Atur Layout** → **Tambah Panel** →
pilih jenis (Grafik/Gauge/Bar/Tabel/**Alarm**) → pilih tag → Simpan.

- **Grafik** = tren garis (maks 4 tag). **Gauge** = satu angka + status.
- **Bar** = perbandingan antar tag. **Tabel** = ringkasan min/rata/maks.
- **Alarm** = daftar tag yang melewati ambang (dari C-4).

### C-6. Export Excel

Toolbar Analisis → **Export Excel**. Menghasilkan 2 lembar: **Analisis**
(snapshot tabel sekarang) dan **Riwayat** (deret waktu lebar sesuai rentang yang
dipilih). Untuk satu tag saja: buka riwayatnya (klik nama tag) → export dari
sana.

---

## 5. BAGIAN D — Pasang "Jembatan" (bridge) di server

Jembatan adalah program kecil yang berlangganan broker dan menuliskan nilai ke
database R-Net. **Ini satu-satunya bagian yang berjalan di server** (bukan di
browser). Pasang di **PC server yang sama** dengan streaming (`deploy/scada`) —
satu server untuk semuanya.

Jembatan hanya butuh **satu** setelan: `DATABASE_URL` (koneksi ke Supabase,
**Transaction pooler port 6543**). Semua site & tag dibaca otomatis dari
database — tidak ada konfigurasi topik manual di sini.

### Windows (server 24/7)

1. Salin folder `deploy/scada/mqtt-bridge/` ke server, mis. `C:\rein-scada\mqtt-bridge\`.
2. Pasang Python 3.11+ (sekali), lalu:
   ```
   cd C:\rein-scada\mqtt-bridge
   pip install -r requirements.txt
   copy .env.example .env
   ```
3. Buka `.env`, isi `DATABASE_URL` (dari Supabase → Settings → Database →
   Connection string, **mode pooling port 6543**).
4. **Tes dulu (jendela manual):** dobel-klik `start-bridge.bat`. Jendela tetap
   terbuka; log menampilkan "terhubung, subscribe N topik" dan "Flush: N nilai
   tersimpan". Ctrl+C untuk berhenti.
5. **Jadikan otomatis 24/7:** daftarkan sebagai service memakai NSSM (sama seperti
   MediaMTX/cloudflared di panduan streaming):
   ```
   C:\rein-scada\nssm\nssm.exe install rnet-mqtt-bridge "C:\Python311\python.exe" "C:\rein-scada\mqtt-bridge\bridge.py"
   C:\rein-scada\nssm\nssm.exe set rnet-mqtt-bridge AppDirectory "C:\rein-scada\mqtt-bridge"
   C:\rein-scada\nssm\nssm.exe set rnet-mqtt-bridge AppExitAction Restart
   C:\rein-scada\nssm\nssm.exe start rnet-mqtt-bridge
   ```
   Sekarang jembatan hidup sendiri saat server nyala dan restart kalau macet —
   berdampingan dengan service streaming.

### Linux (systemd)

```bash
sudo cp -r deploy/scada/mqtt-bridge /opt/rnet-mqtt-bridge
cd /opt/rnet-mqtt-bridge
python3 -m venv venv && venv/bin/pip install -r requirements.txt
cp .env.example .env      # isi DATABASE_URL (pooler 6543)
sudo cp rnet-mqtt-bridge.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now rnet-mqtt-bridge
journalctl -u rnet-mqtt-bridge -f
```

> Detail teknis jembatan ada di `deploy/scada/mqtt-bridge/README.md`.

---

## 6. Uji End-to-End (tanpa perlu sensor asli)

Dengan broker jalan, jembatan jalan, dan sebuah tag MQTT bertopik
`rnet/tes/dev1/suhu` sudah dibuat di R-Net:

```
mosquitto_pub -h <host> -p <port> -u <user> -P <password> -t rnet/tes/dev1/suhu -m "{\"value\": 75.2}"
```

Tunggu ≤1 menit → **75.2** (atau nilai setelah scaling) muncul di kolom
**Terkini** tag itu di Analisis, dan di panel Grafik/Gauge yang memakainya.

---

## 7. Kalau Ada Masalah

| Gejala | Kemungkinan penyebab | Cara cek / obat |
|---|---|---|
| Nilai tak muncul di R-Net | Topik di V-Box ≠ topik di R-Net | Samakan **persis** (huruf besar/kecil, garis miring). Uji dengan `mosquitto_sub -t "rnet/#" -v` — lihat topik asli yang dikirim. |
| `mosquitto_sub` pun kosong | V-Box belum publish / kredensial broker salah | Cek MQTT Client di V-Box aktif; user/password broker benar; port/TLS benar. |
| Nilai muncul tapi **salah besaran** | Perlu scaling | Isi Skala/Offset di dialog Sumber (Bagian C-3). |
| Jembatan log "Gagal menyimpan ke database" | `DATABASE_URL` salah / DB tak terjangkau | Pastikan pakai **pooler 6543**; tes koneksi internet server. |
| Jembatan log "gagal konek ke broker" | Host/port/kredensial/TLS broker salah | Cocokkan dengan Bagian A; kalau 8883 pastikan broker & jaringan mengizinkan TLS. |
| Nilai berhenti update, sel "usang" | V-Box berhenti kirim / broker putus | Cek V-Box & jaringan; jembatan menyambung ulang otomatis saat broker kembali. |
| Data sebelumnya tidak ikut ter-scaling | Scaling hanya untuk data baru | Wajar; set scaling sebelum kumpulkan data penting. |

**Aturan emas:** kalau buntu, lacak dari hulu ke hilir —
**V-Box publish? → broker terima (`mosquitto_sub`)? → jembatan jalan (log)? →
tag & topik benar di R-Net?** Titik pertama yang gagal adalah biangnya.

---

## Ringkasan Checklist

- [ ] **Broker** siap (host/port/user/password dicatat) — Bagian A
- [ ] **V-Box** publish ke broker dengan topik & payload benar — Bagian B
- [ ] **R-Net**: Site dibuat, tag dibuat (topik cocok), scaling & alarm diisi — Bagian C
- [ ] **Jembatan** terpasang di server (DATABASE_URL 6543) — Bagian D
- [ ] **Uji** `mosquitto_pub` → nilai muncul di Analisis — Bagian 6
