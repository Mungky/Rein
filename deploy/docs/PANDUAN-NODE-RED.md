# Panduan Node-RED — Pabrik Pura-Pura untuk Menguji R-Net

Panduan ini untuk menguji jalur DATA R-Net **tanpa alat pabrik asli**.
Node-RED akan berpura-pura jadi alat pabrik: mengirim angka sensor lewat MQTT,
lalu kita lihat apakah R-Net menampilkan angkanya secara live, menyimpan
riwayatnya, dan membunyikan alarm.

Tidak perlu mengetik perintah teknis — semuanya klik.

---

## Sekali saja: persiapan

1. **Nyalakan semuanya** (urutan bebas):
   - Broker MQTT (Mosquitto) — ada di **VPS**, sudah jalan sendiri. Tidak ada
     broker yang dipasang di PC ini.
   - Node-RED + jembatan (bridge): dobel-klik **`start.bat`** lalu pilih paket
     **data**. Keduanya terbuka di jendela masing-masing.
2. Buka browser ke **http://127.0.0.1:1880** — ini editor Node-RED.
3. **Impor flow pabrik pura-pura**:
   - Klik menu **☰** (kanan atas) → **Import**.
   - Klik **select a file to import**, pilih
     `deploy/scada/node-red/flow-pabrik-simulasi.json` → **Import**.
4. **Isi alamat broker**:
   - Dobel-klik salah satu kotak ungu **mqtt** → klik ikon pensil di samping
     "Broker R-Net" → isi:
     - **Server**: alamat broker Anda (contoh: alamat VPS, atau `127.0.0.1`
       kalau broker di laptop yang sama).
     - Tab **Security**: username & password broker (yang sama dengan yang
       diisi di R-Net "Kelola Site").
   - Klik **Update** lalu **Done**.
5. Klik tombol merah **Deploy** (kanan atas). Kalau berhasil, di bawah kotak
   mqtt muncul tulisan hijau **connected**.

> Kotak-kotak sensor akan langsung mulai mengirim angka tiap 2–5 detik.
> Status kecil di bawah tiap kotak menunjukkan nilai terakhir yang dikirim.

## Sekali saja: daftarkan sensornya di R-Net

1. Buka R-Net → tab **Data**.
2. Klik **Kelola Site** → tambah site dengan alamat broker + username +
   password yang sama seperti di atas (kalau belum ada).
3. Tambah 3 baris sensor (tombol **+ Tambah Baris**), lalu klik sel
   **Sumber** tiap baris dan isi:

   | Nama sensor      | Topik                           | Alarm bila > |
   |------------------|---------------------------------|--------------|
   | Suhu Boiler 1    | `rnet/demo/boiler1/temperature` | 85           |
   | Tekanan Boiler 1 | `rnet/demo/boiler1/pressure`    | (kosong)     |
   | Level Tangki 1   | `rnet/demo/tangki1/level`       | (kosong)     |

   Alarm "sensor bisu" otomatis aktif — tidak perlu diatur apa-apa.
4. (Opsional) klik panah **▸** di ujung baris untuk membuka detail:
   - **Simpan data ke riwayat** TIDAK dicentang = hanya 100 data terakhir
     yang disimpan (seperti SD card CCTV) — cocok untuk pantau live.
   - Dicentang = data disimpan sesuai **Interval Penyimpanan** (5 detik s.d.
     24 jam), ditahan 90 hari, lalu otomatis diarsip ke Google Drive.
5. Tunggu ±30 detik (jembatan membaca daftar sensor baru secara berkala).

## Sekali saja: nyalakan notifikasi (opsional tapi disarankan)

1. Di tab **Data**, klik **Notifikasi Alarm**.
2. **Email**: centang, isi alamat penerima (pisahkan dengan koma).
3. **Telegram** (opsional): buat bot lewat **@BotFather** di aplikasi Telegram
   (ketik `/newbot`, ikuti petunjuknya, salin token). Minta admin memasang
   token itu di server (variabel `TELEGRAM_BOT_TOKEN`), lalu isi **Chat ID**
   di sini. Cara tahu chat ID: kirim pesan apa pun ke bot
   **@userinfobot** — dia membalas dengan ID Anda.
4. Klik **Kirim Uji Coba** — pastikan pesan uji masuk sebelum lanjut.
5. **Simpan**.

---

## Skenario uji — klik demi klik

Di Node-RED, "menekan tombol" = klik **kotak kecil di sisi kiri** node.

### 1. Angka live, grafik mini & status Online
- Buka R-Net tab **Data**. Kolom **Terkini** untuk Suhu/Tekanan harus
  berdetak berubah tiap ±1–2 detik, kolom **Online** hijau, dan grafik
  mini di tiap baris menggambar 100 data terakhir.
- Klik panah **▸** di ujung baris → daftar 100 data terakhir dengan
  timestamp per detik (mode SD card). Centang **Simpan data ke riwayat**
  + pilih interval kalau sensor itu perlu direkam jangka panjang.

### 2. Alarm menyala sendiri (tanpa ada yang buka halaman)
- Di Node-RED, tekan **🔴 NILAI GILA**. Suhu boiler melonjak ke ±92–96 °C.
- Dalam ±5 detik:
  - Lonceng 🔔 di pojok kanan atas R-Net menyala merah + berbunyi bip.
  - Email/Telegram masuk (kalau diaktifkan).
- Penting: alarm ini dideteksi **server**, bukan browser — silakan tutup
  R-Net sebelum menekan tombolnya, alarm tetap tercatat dan notifikasi tetap
  terkirim.

### 3. Tombol "Saya sudah tahu" (Ack)
- Klik lonceng 🔔 → klik **Ack** pada alarm suhu.
- Status berubah jadi **Diakui** lengkap dengan **nama Anda dan jamnya** —
  semua orang tahu siapa yang sudah menangani.

### 4. Alarm selesai + riwayat abadi
- Di Node-RED, tekan **🟢 NORMAL LAGI**. Dalam ±5 detik alarm hilang dari
  daftar aktif dan notifikasi "NORMAL KEMBALI" terkirim.
- Klik ikon **riwayat** di lonceng → alarm tadi tetap tercatat selamanya:
  kapan mulai, nilai puncak, siapa yang meng-ack, kapan selesai.

### 5. Alarm "Sensor Bisu" (otomatis untuk semua sensor)
- Tekan **🔇 SENSOR BISU: ON** — semua sensor pura-pura mati (kabel putus).
- Tunggu ±1 menit → alarm **Sensor bisu** muncul dan kolom Online berubah
  jadi "Terakhir online: [waktu]".
- Tekan **🔊 SENSOR BISU: OFF** → data mengalir lagi, alarm selesai sendiri.

### 6. Anti-spam (opsional)
- Tekan NILAI GILA → NORMAL LAGI → NILAI GILA berulang-ulang cepat.
- Riwayat mencatat semuanya, tapi email/Telegram hanya terkirim maksimal
  sekali per "jeda antar-notifikasi" (bawaan 15 menit) — kotak masuk aman.

---

## Kalau nanti ada alat pabrik ASLI

Impor `flow-modbus-template.json` (tab-nya sengaja nonaktif) dan baca
petunjuk di dalamnya: pasang palette Modbus, arahkan ke alamat PLC,
samakan topiknya dengan R-Net. Prinsipnya sama persis dengan pabrik
pura-pura — R-Net tidak perlu diubah sama sekali.

**Catatan keamanan**: Node-RED sengaja TIDAK diberi kunci database. Dia hanya
"titip pesan" lewat MQTT seperti alat pabrik biasa — kalau mesin Node-RED
bermasalah, tidak ada kunci rahasia yang ikut bocor.

## Kalau ada yang tidak jalan

| Gejala | Periksa |
|---|---|
| Kotak mqtt tidak "connected" | Alamat/password broker salah, atau broker belum nyala. |
| Angka tidak muncul di R-Net | Topik di R-Net harus SAMA PERSIS dengan di Node-RED; tunggu 30 detik; pastikan jembatan (bridge) jalan. |
| Alarm tidak menyala | Pastikan backend server jalan (mesin alarm ikut backend); cek batas alarm sudah diisi. |
| Tidak ada email/Telegram | Buka **Notifikasi Alarm** → **Kirim Uji Coba** dulu; cek folder spam. |
| Tidak ada bunyi bip | Browser butuh satu kali klik di halaman sebelum boleh bersuara; cek juga ikon 🔇 di lonceng. |
