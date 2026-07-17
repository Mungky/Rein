# Panduan Server R-Net — Satu Panduan untuk Semuanya

> Panduan tunggal untuk menyiapkan **PC server/pemancar R-Net** dari nol:
> video streaming (OBS → MediaMTX → Cloudflare Tunnel), data sensor
> (V-Box → Mosquitto MQTT), otomasi (Node-RED), sampai troubleshooting.
> Ditulis untuk orang non-teknis. Panduan-panduan lama
> (PANDUAN-INSTALASI-STREAMING, PANDUAN-SERVER-SCADA, PANDUAN-MQTT-RNET,
> TUTORIAL-TES-LOKAL) sudah dilebur ke sini.

---

## 1. Gambaran Besar — Tiga Jalur

R-Net punya tiga jalur yang berdiri sendiri (boleh pasang salah satu saja):

```
JALUR VIDEO (tab Monitor):
┌───────┐   ┌──────────┐   ┌──────────────┐   ┌────────────────┐
│  OBS  │──▶│ MediaMTX │──▶│  Cloudflare  │──▶│ R-Net di       │
│(kamera│   │(pemancar)│   │  Tunnel      │   │ browser mana   │
│studio)│   │          │   │ (kabel aman) │   │ pun (TV-nya)   │
└───────┘   └──────────┘   └──────────────┘   └────────────────┘

JALUR DATA SENSOR (panel Grafik/Gauge/Tabel):
┌────────┐   ┌─────────┐   ┌───────────┐   ┌──────────┐   ┌───────┐
│ Sensor │──▶│ V-Box / │──▶│ Mosquitto │──▶│ Jembatan │──▶│ R-Net │
│ / PLC  │   │ V-Net   │   │ (broker,  │   │ (bridge) │   │       │
│        │   │         │   │kantor pos)│   │          │   │       │
└────────┘   └─────────┘   └───────────┘   └──────────┘   └───────┘

JALUR SPION LAYAR / VNC (channel "VNC (Layar PC)"):
┌──────────────────┐   ┌──────────┐   ┌──────────────┐   ┌───────┐
│ PC dedicated:    │──▶│ TightVNC │──▶│  websocat +  │──▶│ R-Net │
│ browser membuka  │   │(view-only│   │  Cloudflare  │   │(tajam,│
│ cloud SCADA      │   │ mirror)  │   │  Tunnel      │   │ live) │
└──────────────────┘   └──────────┘   └──────────────┘   └───────┘
```

| Komponen | Fungsi | Wajib untuk |
|---|---|---|
| **MediaMTX + cloudflared** | Menerima video OBS, menyiarkannya ke internet tanpa buka port router | Jalur video |
| **OBS Studio** | Menggabungkan layar V-Net/SCADA jadi satu tampilan siaran | Jalur video |
| **Mosquitto** | Broker MQTT — menampung data sensor dari V-Box | Jalur data |
| **Jembatan (mqtt-bridge)** | Menyalin data dari broker ke database R-Net | Jalur data |
| **Node-RED** | Opsional — otomasi alur data (mis. baca Modbus/PLC → kirim ke MQTT) | Sesuai kebutuhan |
| **TightVNC + websocat** | Memantulkan layar PC (mis. browser cloud SCADA) ke channel R-Net, view-only, tanpa OBS | Jalur spion layar |

Prinsip penting: **tidak ada yang autostart**. Semua dinyalakan/dimatikan
lewat saklar (file `.bat` yang tinggal dobel-klik).

---

## 2. Instalasi (sekali per PC, ±10–30 menit)

1. Salin folder `deploy/scada/` ini ke PC target (flashdisk juga bisa).
2. Buka PowerShell di folder itu, jalankan:

   ```
   powershell -NoProfile -ExecutionPolicy Bypass -File install.ps1
   ```

3. Installer menanyakan **komponen mana yang mau dipasang**:

   ```
   [1] MediaMTX + Cloudflare Tunnel  - pemancar video (inti R-Net)
   [2] Mosquitto (broker MQTT)       - terima data sensor V-Box
   [3] Node-RED                      - otomasi alur data / gateway PLC
   [4] OBS Studio                    - sumber siaran layar
   [5] Sumber VNC (TightVNC+websocat)- spion layar PC ini utk channel R-Net
   ```

   Ketik nomornya dipisah koma, mis. `1,2,4`. Enter saja = `1`
   (video saja). Semua komponen dipasang **versi terbaru** dari sumber
   resmi (GitHub resmi / winget); cloudflared diverifikasi tanda tangan
   digitalnya.

4. Ikuti pertanyaan installer:
   - **Password publish & viewer** — Enter saja = dibuatkan otomatis.
     **CATAT keduanya** (publish untuk OBS, viewer untuk Kelola Stream).
   - **Kredensial Supabase** — supaya alamat stream ter-update otomatis
     tiap kali server dinyalakan. Boleh dikosongkan (mode manual:
     salin-tempel URL sendiri, lihat bagian 5).
   - **STREAM_NAME** — nama stream milik mesin ini. **WAJIB diisi kalau
     ada lebih dari satu mesin siaran** (mis. "Line Server", "Line
     Laptop"); tanpa ini mesin-mesin saling menimpa alamat.
   - **Akun MQTT** (kalau pilih komponen 2) — username + password yang
     nanti diisi di V-Box. Bisa dilihat/diubah kapan pun lewat
     **Pengaturan MQTT.bat** (bagian 6).
   - **Password VNC + nomor channel** (kalau pilih komponen 5) — password
     KONTROL (untuk Anda) dan VIEW-ONLY (untuk channel R-Net), maks 8
     karakter, Enter = dibuatkan otomatis. Detail di bagian 8.

5. Selesai. Isi folder `C:\rein-scada\` sekarang:

   | File | Fungsi |
   |---|---|
   | `start-scada.bat` | Saklar ON: MediaMTX + tunnel + Mosquitto |
   | `stop-scada.bat` | Saklar OFF semuanya |
   | `Pengaturan MQTT.bat` | **UI pengaturan broker MQTT** (port/akun/tes) |
   | `start-nodered.bat` | Saklar ON Node-RED (kalau dipasang) |
   | `start-vnc.bat` / `stop-vnc.bat` | Saklar sumber VNC (kalau dipasang, bagian 8) |
   | `config.env` | Kredensial Supabase + STREAM_NAME + VNC_CHANNEL (RAHASIA) |
   | `mediamtx\`, `cloudflared\`, `mosquitto\`, `websocat\` | Program + config masing-masing |

   Installer aman dijalankan ulang kapan pun (update komponen, tambah
   komponen baru) — config dan password lama **tidak pernah ditimpa**.

---

## 3. Setting OBS (sekali saja)

**Settings → Stream:**

| Kolom | Isi |
|---|---|
| Service | Custom |
| Server | `rtmp://127.0.0.1:1935` |
| Stream Key | `scada?user=obs&pass=PASSWORD_PUBLISH` |

**Settings → Output → Streaming** (kunci delay rendah — 🔑 = paling penting):

| Setelan | Nilai |
|---|---|
| Keyframe Interval | **1 s** 🔑 (kalau 0/auto, video patah-patah & delay bengkak) |
| Preset / Tuning | Fastest / **Ultra Low Latency** (NVENC) atau `zerolatency` (x264) 🔑 |
| Max B-frames | **0** 🔑 |
| Look-ahead & Psycho Visual Tuning | **OFF** 🔑 |
| Multipass | Disabled |

> B-frames & Look-ahead membuat encoder "menunggu beberapa frame ke depan"
> sebelum mengirim — itu saja menambah 2–4 detik delay. Mematikannya jauh
> lebih berpengaruh daripada mengutak-atik config MediaMTX.

---

## 4. Daftarkan Stream di R-Net (sekali saja)

1. Login R-Net sebagai admin → halaman **R-Net** → tab **Channel** →
   **Kelola Stream** → Tambah Stream:

   | Kolom | Isi |
   |---|---|
   | Nama | PERSIS sama dengan `STREAM_NAME` di config.env (mis. `Line Server`) |
   | URL HLS | otomatis ter-update oleh saklar; mode manual: tempel URL dari jendela start-scada |
   | User (read) | `rein-viewer` |
   | Password (read) | password **viewer** dari installer |

2. Buat Channel yang memakai stream itu, taruh panelnya di tab Monitor.

---

## 5. Rutinitas Tiap PC Dinyalakan

1. Dobel-klik **`C:\rein-scada\start-scada.bat`** — menyalakan MediaMTX,
   Cloudflare Tunnel, dan Mosquitto (kalau terpasang).
   - **Kalau config.env diisi:** alamat stream ter-update otomatis di
     database — tidak ada yang perlu disalin. Jendela menampilkan
     `=== R-NET SIAP ===`.
   - **Kalau kosong (mode manual):** jendela menampilkan URL
     `https://xxxx.trycloudflare.com/scada/index.m3u8` — salin ke
     R-Net → Kelola Stream → URL HLS. (URL berubah tiap dinyalakan —
     itu sifat Quick Tunnel gratis.)
2. Buka **OBS** → **Start Streaming**.
3. Selesai kerja: **`stop-scada.bat`** (OBS ditutup sendiri).

> **Butuh alamat TETAP / server 24 jam?** Pakai jalur relay VPS —
> lihat `deploy/vps/PANDUAN-VPS-RELAY.md` (termasuk jalur SRT untuk
> jaringan jelek). Mode NSSM/named-tunnel yang lama sudah dipensiunkan.

---

## 6. Data Sensor MQTT — Sekarang Ada UI-nya

Tidak perlu lagi edit `mosquitto.conf` manual. Dobel-klik
**`C:\rein-scada\Pengaturan MQTT.bat`**:

- **Status broker** — terlihat langsung BERJALAN/MATI, plus tombol
  Nyalakan / Matikan (saklar manual, konsisten dengan yang lain).
- **Port, username, password, mode anonim** — isi kolomnya, klik
  **Simpan Pengaturan**. Kalau broker sedang jalan, otomatis direstart
  dengan pengaturan baru; aturan firewall untuk port baru dibuatkan.
- **Tes Koneksi** — memastikan username/password benar-benar diterima
  broker, TANPA perlu perangkat sungguhan.
- **Contekan V-Net/V-Box** — kotak di bawah menampilkan **persis** apa
  yang harus diisi di perangkat: Host (IP PC ini), Port, Username,
  Password. Tinggal salin.

Yang diisi di **V-Net / V-Box** (menu MQTT perangkat):

| Kolom di V-Net | Isi |
|---|---|
| Broker/Host | IP PC server (lihat kotak contekan) |
| Port | 1883 (atau yang Anda set) |
| Username / Password | akun dari Pengaturan MQTT |
| Topik | bebas tapi konsisten, mis. `rnet/site1/boiler1/suhu` |
| Payload | `{"value": 72.5}` atau angka polos `72.5` |

**Jembatan ke database (bridge):** data di broker belum otomatis masuk
R-Net — perlu bridge kecil yang jalan di PC yang sama. Cara pasang +
menjalankan: **`mqtt-bridge/README.md`** (intinya: isi `DATABASE_URL`
di `.env`, lalu dobel-klik `start-bridge.bat`). Site + topik diatur dari
frontend R-Net, bukan file config.

---

## 7. Node-RED (opsional — otomasi alur data)

Node-RED = editor alur visual (drag-drop) untuk urusan seperti:
baca Modbus/PLC langsung → publish ke MQTT, konversi format payload,
kirim notifikasi, dsb. Cocok kalau ada perangkat yang tidak bisa lewat
V-Box.

- Nyalakan: dobel-klik **`start-nodered.bat`** → buka
  **http://127.0.0.1:1880** di browser.
- Matikan: tutup jendela hitamnya (atau Ctrl+C). Bukan service — tidak
  ada yang jalan diam-diam.
- Untuk publish ke broker lokal: node **mqtt out**, server
  `127.0.0.1:1883`, isi username/password dari Pengaturan MQTT, topik
  sesuai tag di R-Net.

---

## 8. Sumber VNC — Spion Layar PC (opsional)

Untuk menampilkan **layar sebuah PC** (misal browser yang membuka cloud
SCADA) sebagai channel R-Net — tajam dan tanpa OBS. R-Net **selalu
view-only**: penonton tidak pernah bisa menggerakkan mouse/keyboard PC
sumber.

**Sekali saja (di PC sumber):**

1. Jalankan installer, pilih komponen **5**. Installer memasang TightVNC
   (winget) + websocat + cloudflared, menyetel dua password (KONTROL untuk
   Anda, VIEW-ONLY untuk R-Net), dan mengisi `VNC_SOURCE` +
   `VNC_VIEW_PASSWORD` di `config.env`.
2. Di R-Net → **Channel** → **Kelola Screen** → Tambah Sumber → jenis
   **VNC (Layar PC)**, dengan **nama PERSIS sama dengan `VNC_SOURCE`**.
   Alamat & password boleh dikosongkan — saklar yang mengisinya.
3. Masih di R-Net → **Channel Baru** → jenis **Video Screen** → pilih
   sumber VNC tadi (boleh di-crop). Taruh channel di layout Monitor.

**Rutinitas tiap PC dinyalakan:**

1. Buka browser ke cloud SCADA, **login**, atur tampilannya (token cloud
   SCADA yang kedaluwarsa 24 jam tetap urusan PC ini).
2. Dobel-klik **`start-vnc.bat`** — TightVNC + websocat + Quick Tunnel
   hidup, lalu alamat (dan password view-only) **sumber** VNC ter-update
   otomatis di database. Halaman R-Net yang sudah terbuka cukup
   di-refresh sekali.
3. Matikan: **`stop-vnc.bat`**.

**Catatan:**

- Ada beberapa PC sumber VNC? Satu PC = satu sumber: isi `VNC_SOURCE`
  berbeda di masing-masing `config.env`.
- Semua port (5900 VNC, 6080 websocat) hanya listen di PC itu sendiri;
  satu-satunya jalan masuk dari luar adalah tunnel (wss, terenkripsi).
- Password view-only ikut tersimpan di config channel dan terbaca semua
  user R-Net (memang diperlukan browser penonton untuk konek) — karena
  itu **jangan pernah** menaruh password KONTROL di sana.
- Ganti password: klik kanan ikon TightVNC di tray → Configuration →
  ganti, lalu samakan `VNC_VIEW_PASSWORD` di `config.env`.
- Panduan teknis lengkap (termasuk cara manual tanpa installer):
  `docs/VNC-SOURCE-SETUP.md` di repo REIN.

---

## 9. Checklist Uji (sekali setelah pasang)

| # | Uji | Hasil yang benar |
|---|---|---|
| 1 | `start-scada.bat` → OBS Start Streaming | Video muncul di halaman R-Net dalam ±10 detik |
| 2 | Buka URL HLS di browser biasa tanpa password | **Gagal/error** — orang luar tidak bisa nonton |
| 3 | Pengaturan MQTT → Tes Koneksi | "BERHASIL" |
| 4 | (Kalau pakai bridge) publish tes: `mosquitto_pub -h 127.0.0.1 -u USER -P PASS -t rnet/tes/dev1/suhu -m "{\"value\": 75}"` | Nilai muncul di R-Net ≤ 1 menit |
| 5 | `stop-scada.bat` | Semua proses mati; R-Net menampilkan "stream terputus" |
| 6 | (Kalau pakai sumber VNC) `start-vnc.bat` → refresh R-Net | Layar PC sumber tampil di channel VNC; klik di panel TIDAK menggerakkan PC sumber |

---

## 10. Troubleshooting

### Video

| Gejala | Penyebab umum | Cara cek/atasi |
|---|---|---|
| Video hitam / "Stream terputus" | OBS tidak streaming | Di OBS harus terlihat tombol "Stop Streaming" (artinya sedang siaran) |
| "Menghubungkan…" tidak selesai | Tunnel mati / URL basi | Jalankan ulang `start-scada.bat`; mode manual: tempel URL BARU ke Kelola Stream |
| Video patah-patah | Keyframe Interval bukan 1 s, atau bitrate kegedean | Cek Settings OBS (bagian 3) |
| Password viewer ditolak | Salah isi Kelola Stream | User `rein-viewer` + password viewer (bukan publish) |

### Delay video 6–10 detik (target ~3 detik)

Delay total = delay **OBS/encoder** + delay **Cloudflare Tunnel**.
Cara tahu biang keroknya — bandingkan di PC server itu sendiri:

1. Di PC server buka `http://127.0.0.1:8888/scada/index.m3u8` dengan VLC
   (Open Network Stream). Ini **melewati Cloudflare** — murni OBS+MediaMTX.
2. Bandingkan dengan yang terlihat dari laptop lain (lewat internet).

- **Di PC server pun sudah lambat** → biangnya OBS: matikan B-frames /
  Look-ahead (bagian 3), delay turun drastis.
- **Di PC server cepat, via internet lambat** → tambahan delay dari
  Cloudflare Tunnel (batas bawaan tunnel gratis, tidak bisa ditekan
  lewat config). Terima ~4–6 detik, atau pindah ke relay VPS + WebRTC
  (`deploy/vps/PANDUAN-VPS-RELAY.md`) untuk sub-detik.
- LL-HLS tetap patah-patah lewat tunnel dan Anda pilih STABIL daripada
  cepat: di `mediamtx.yml` ganti `hlsVariant: lowLatency` →
  `hlsVariant: mpegts` (delay naik ~8–15 detik).

### MQTT

| Gejala | Penyebab umum | Cara cek/atasi |
|---|---|---|
| V-Box tidak bisa konek | Broker mati / beda jaringan / firewall | Pengaturan MQTT: status harus BERJALAN; ping IP server dari jaringan V-Box; port harus dibuka di firewall (Simpan Pengaturan membuatkannya) |
| "Connection refused: not authorised" | Username/password salah | Pengaturan MQTT → Tes Koneksi; kalau lupa password, isi password baru → Simpan |
| Broker gagal menyala | Port dipakai aplikasi lain | Pengaturan MQTT → Buka Log; ganti port lalu Simpan |
| Data tidak muncul di R-Net padahal broker OK | Bridge tidak jalan / topik tidak cocok | Jalankan `mqtt-bridge/start-bridge.bat`; topik di perangkat harus PERSIS sama dengan tag di R-Net |

### Sumber VNC

| Gejala | Penyebab umum | Cara cek/atasi |
|---|---|---|
| Channel VNC "Menghubungkan…" terus | Saklar belum jalan / URL basi | Jalankan ulang `start-vnc.bat`, refresh halaman R-Net |
| **"Sorry, loopback connections are not enabled"** | TightVNC menolak koneksi dari 127.0.0.1 (bawaannya begitu), padahal websocat konek dari situ | TightVNC → Configuration → centang **Allow loopback connections** (+ **Allow only loopback**), lalu restart TightVNC. Installer versi baru menyetel ini otomatis |
| "Server VNC minta password" | `VNC_VIEW_PASSWORD` kosong/beda dengan TightVNC | Samakan password view-only di config.env, jalankan ulang saklar |
| Lupa password VNC | — | Klik kanan ikon TightVNC di tray → Configuration → set ulang; lalu samakan `VNC_VIEW_PASSWORD` di config.env |
| Layar hitam | PC sumber sleep / monitor mati dengan mode tertentu | Matikan sleep (Settings → Power: Never); layar boleh mati, sesi Windows harus tetap login |
| Gambar tidak update | Browser cloud SCADA logout (token 24 jam) | Login ulang di PC sumber |

---

## 11. Uninstall Total

1. `stop-scada.bat` + `stop-vnc.bat` (dan tutup jendela Node-RED kalau ada).
2. Hapus folder `C:\rein-scada\`.
3. Mosquitto/OBS/Node.js/TightVNC dihapus lewat Settings → Apps seperti
   aplikasi biasa (`winget uninstall` juga bisa).
