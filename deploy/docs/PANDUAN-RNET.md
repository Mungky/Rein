# Panduan Server R-Net — Satu Panduan untuk Semuanya

> Panduan tunggal untuk menyiapkan **PC site R-Net** dari nol: siaran layar
> (OBS → MediaMTX → Cloudflare Tunnel), spion layar (TightVNC), data sensor
> (V-Box → broker MQTT di VPS → bridge), sampai troubleshooting.
> Ditulis untuk orang non-teknis.

---

## 0. Ringkasnya

Satu folder, **lima tombol**, satu file kredensial:

| Tombol | Fungsi |
|---|---|
| `install.bat` | Pasang. Dijalankan **sekali** per PC. |
| `start.bat` | Nyalakan layanan. |
| `stop.bat` | Matikan layanan. |
| `kredensial.bat` | Perbaiki isian yang salah ketik. |
| `uninstall.bat` | Copot dari PC ini. |

Semua kredensial ada di **satu** file: `C:\rein-scada\config.env` (RAHASIA,
jangan dikirim ke siapa pun).

Prinsip penting: **tidak ada yang autostart**. Semua hidup-mati lewat tombol.

---

## 1. Gambaran Besar — Tiga Jalur

Tiga jalur yang berdiri sendiri (boleh pasang salah satu saja):

```
JALUR VIDEO / STREAM (channel "Video Screen"):
┌───────┐   ┌──────────┐   ┌──────────────┐   ┌────────────────┐
│  OBS  │──▶│ MediaMTX │──▶│  Cloudflare  │──▶│ R-Net di       │
│(kamera│   │(pemancar)│   │  Tunnel      │   │ browser mana   │
│studio)│   │          │   │ (kabel aman) │   │ pun (TV-nya)   │
└───────┘   └──────────┘   └──────────────┘   └────────────────┘

JALUR SPION LAYAR / MIRROR (channel "VNC (Layar PC)"):
┌──────────────────┐   ┌──────────┐   ┌──────────────┐   ┌───────┐
│ PC dedicated:    │──▶│ TightVNC │──▶│  websocat +  │──▶│ R-Net │
│ browser membuka  │   │(view-only│   │  Cloudflare  │   │(tajam,│
│ cloud SCADA      │   │ mirror)  │   │  Tunnel      │   │ live) │
└──────────────────┘   └──────────┘   └──────────────┘   └───────┘

JALUR DATA SENSOR (panel Grafik/Gauge/Tabel):
┌────────┐   ┌─────────┐   ┌────────────┐   ┌──────────┐   ┌───────┐
│ Sensor │──▶│ V-Box / │──▶│ Broker MQTT│──▶│ Jembatan │──▶│ R-Net │
│ / PLC  │   │ V-Net   │   │  DI VPS    │   │ (bridge) │   │       │
│        │   │         │   │(kantor pos)│   │          │   │       │
└────────┘   └─────────┘   └────────────┘   └──────────┘   └───────┘
```

| Komponen | Fungsi | Dipasang di PC site? |
|---|---|---|
| **MediaMTX + cloudflared** | Menerima video OBS, menyiarkannya ke internet tanpa buka port router | Ya (paket stream) |
| **OBS Studio** | Menggabungkan layar V-Net/SCADA jadi satu tampilan siaran | Ya (paket stream) |
| **TightVNC + websocat** | Memantulkan layar PC ke channel R-Net, view-only, tanpa OBS | Ya (paket mirror) |
| **Broker MQTT (Mosquitto)** | Menampung data sensor dari V-Box | **Tidak — ada di VPS** |
| **Jembatan (bridge)** | Menyalin data dari broker ke database R-Net | Ya (paket data) |
| **Node-RED** | Opsional — olah alur data (mis. baca Modbus/PLC → publish MQTT) | Ya (paket data) |

> **Kenapa broker di VPS?** Supaya V-Box di lokasi mana pun bisa mengirim ke
> alamat yang sama, kapan pun — jarak dan jaringan lokal bukan lagi masalah.
> Tetap **satu** broker: V-Box dan Node-RED memakai broker yang sama,
> dibedakan **topik** (`vbox/...` vs `rnet/...`), bukan dua broker.

---

## 2. Sebelum Pasang: Buat Tunnel (kalau pakai stream/mirror)

Stream dan mirror **wajib** lewat named tunnel Cloudflare. Buat dulu di
dashboard — ±5 menit, sekali per PC. Langkahnya di
[PANDUAN-TUNNEL.md](./PANDUAN-TUNNEL.md).

Yang harus kamu bawa ke depan PC saat memasang:

- **TUNNEL_TOKEN** (teks panjang `eyJ...`)
- **STREAM_HOSTNAME**, mis. `stream-pabrik1.remula-inti.com`
- **MIRROR_HOSTNAME**, mis. `mirror-pabrik1.remula-inti.com`

Tanpa ini stream/mirror hidup di PC tapi **tidak akan muncul di R-Net**.

---

## 3. Instalasi (sekali per PC, ±10–30 menit)

1. Salin folder `deploy` ke PC target (flashdisk).
2. **Dobel-klik `install.bat`.** Tidak perlu mengetik perintah apa pun.
3. Pilih paket yang mau dipasang:

   ```
   [1] STREAM  - siaran layar/HMI (MediaMTX + tunnel + OBS)
   [2] MIRROR  - spion layar PC ini (TightVNC + websocat)
   [3] DATA    - data sensor (Node-RED + bridge; broker di VPS)
   [A] Semua
   ```

   Boleh gabung, mis. ketik `1,2`. Semua komponen diunduh **versi terbaru**
   dari sumber resmi (GitHub resmi / winget); cloudflared diverifikasi tanda
   tangan digitalnya.

4. Jawab pertanyaan installer:

   | Ditanya | Isi |
   |---|---|
   | `TUNNEL_TOKEN` | token dari bagian 2 |
   | `STREAM_HOSTNAME` / `MIRROR_HOSTNAME` | hostname dari bagian 2 (tanpa `https://`) |
   | Password **publish** & **viewer** MediaMTX | Enter = dibuatkan otomatis. **CATAT keduanya.** |
   | Password VNC **KONTROL** & **VIEW-ONLY** | maks 8 karakter, Enter = dibuatkan. **CATAT keduanya.** |
   | `DATABASE_URL` | alamat database R-Net untuk bridge |
   | `MQTT_HOST` / `MQTT_PORT` / `MQTT_USERNAME` | alamat broker VPS — catatan untuk menyetel Node-RED |

5. Di akhir, installer mencetak kotak **"ISI DI R-NET > Kelola Screen"**
   berisi alamat lengkap yang tinggal disalin. Jangan ditutup sebelum disalin
   — `start.bat` mencetak ulang alamat yang sama kapan saja.

Installer aman dijalankan ulang kapan pun (update komponen, tambah paket,
melengkapi hostname yang belum diisi) — password dan config lama **tidak
pernah ditimpa**.

### Salah ketik? Pakai `kredensial.bat`

Justru karena installer tidak pernah menimpa nilai yang sudah terisi, salah
ketik **tidak bisa dibetulkan dari `install.bat`**. Dobel-klik
**`kredensial.bat`**: muncul daftar semua isian beserta nilainya (yang rahasia
disamarkan), pilih nomornya, ketik nilai baru.

```
  [1] TUNNEL_TOKEN        <terisi, 218 karakter>
  [2] STREAM_HOSTNAME     stream-pabrik1.remula-inti.com
  [3] MIRROR_HOSTNAME     Server-Remula   <-- TIDAK SAH: tidak ada titiknya ...
  [4] STREAM_PATH         scada
  [5] DATABASE_URL        <terisi, 111 karakter>
  ...
  [M] Password MediaMTX (publish + viewer)
  [V] Password VNC (kontrol + view-only)
  [Q] Selesai
```

Isian yang bentuknya salah ditandai sendiri, jadi ketahuan tanpa harus diperiksa
satu-satu. Yang perlu diingat:

- Token dan hostname **diperiksa bentuknya** — nilai ngawur ditolak di tempat.
- `DATABASE_URL` **tidak bisa diperiksa** (salah ketik password terlihat sama
  saja dengan yang benar) — dicek hanya harus diawali `postgresql://`. Kalau
  bridge tetap gagal, cocokkan lagi dengan Supabase.
- Mengganti **password VNC** memperbarui registry TightVNC **dan** `config.env`
  sekaligus, supaya keduanya tidak pernah berbeda. Password baru tetap harus
  diisikan lagi di R-Net > Kelola Screen.
- Setelah mengubah apa pun: `stop.bat` lalu `start.bat`.

### Isi folder `C:\rein-scada\` setelah pasang

| File | Fungsi |
|---|---|
| `start.bat` / `stop.bat` | Saklar ON / OFF (menu paket) |
| `uninstall.bat` | Copot dari PC ini |
| `config.env` | **Semua** kredensial PC ini (RAHASIA) |
| `mediamtx\`, `cloudflared\`, `websocat\`, `data\` | Program + config masing-masing |

---

## 4. Daftarkan di R-Net (sekali saja, manual)

PC site **tidak pernah menulis ke database R-Net** — jadi langkah ini memang
dikerjakan tangan, sekali seumur hidup (alamatnya permanen).

Login R-Net sebagai admin → halaman **R-Net** → tab **Channel** →
**Kelola Screen** → Tambah Sumber.

**Untuk STREAM:**

| Kolom | Isi |
|---|---|
| Jenis | Stream |
| Nama | bebas, mis. `Line Server` |
| URL HLS | `https://<STREAM_HOSTNAME>/scada/index.m3u8` |
| User (read) | `rein-viewer` |
| Password (read) | password **viewer** dari installer (bukan publish) |

**Untuk MIRROR:**

| Kolom | Isi |
|---|---|
| Jenis | VNC (Layar PC) |
| Nama | bebas, mis. `Server-Remula` |
| Alamat | `https://<MIRROR_HOSTNAME>` — R-Net mengubahnya jadi `wss://` sendiri |
| Password | password **VIEW-ONLY** VNC (JANGAN yang kontrol) |

Lalu buat **Channel Baru** → jenis **Video Screen** → pilih sumber tadi (boleh
di-crop), dan taruh channel itu di layout tab Monitor.

---

## 5. Setting OBS (sekali saja, kalau pakai stream)

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

## 6. Rutinitas Tiap PC Dinyalakan

1. (Mirror) Buka browser ke cloud SCADA, **login**, atur tampilannya — token
   cloud SCADA yang kedaluwarsa 24 jam tetap urusan PC ini.
2. Dobel-klik **`C:\rein-scada\start.bat`** → pilih paket (Enter = semua).
   - Jendela mencetak `Named tunnel tersambung ke Cloudflare` dan alamat
     stream/mirror-nya.
   - Di bawahnya ada daftar status `[HIDUP]/[mati]` tiap layanan.
3. (Stream) Buka **OBS** → **Start Streaming**.
4. Selesai kerja: **`stop.bat`** (OBS ditutup sendiri).

Karena alamatnya permanen, **tidak ada yang perlu disalin ulang ke R-Net**.
Halaman R-Net yang sudah terbuka cukup di-refresh sekali.

---

## 7. Data Sensor MQTT

Broker ada di **VPS**. Yang dikerjakan di PC site hanya bridge (+ Node-RED
kalau perlu olah data).

**Sekali saja — daftarkan broker di R-Net:**
**R-Net → Data → Kelola Site** → isi host / port / username / password broker
VPS. Dari sinilah bridge tahu harus mendengar ke mana; bridge **tidak**
membaca alamat broker dari `config.env`.

Yang diisi di **V-Net / V-Box** (menu MQTT perangkat):

| Kolom di V-Net | Isi |
|---|---|
| Broker/Host | alamat broker VPS |
| Port | 1883 (atau yang diset di VPS) |
| Username / Password | akun broker VPS |
| Topik | bebas tapi konsisten, mis. `rnet/site1/boiler1/suhu` |
| Payload | `{"value": 72.5}` atau angka polos `72.5` |

**Node-RED** (opsional): `start.bat data` → buka **http://127.0.0.1:1880**.
Node **mqtt out** diarahkan ke **broker VPS**, bukan `127.0.0.1`. Alamatnya
dicatat di `config.env` bagian `MQTT_HOST`. Detail:
[PANDUAN-NODE-RED.md](./PANDUAN-NODE-RED.md).

---

## 8. Checklist Uji (sekali setelah pasang)

| # | Uji | Hasil yang benar |
|---|---|---|
| 1 | `start.bat` | Tercetak "Named tunnel tersambung ke Cloudflare" |
| 2 | (Stream) OBS Start Streaming | Video muncul di R-Net dalam ±10 detik |
| 3 | Buka URL HLS di browser biasa tanpa password | **Gagal/error** — orang luar tidak bisa nonton |
| 4 | (Mirror) refresh R-Net | Layar PC tampil; klik di panel **tidak** menggerakkan PC sumber |
| 5 | (Data) publish tes ke broker VPS topik `rnet/tes/dev1/suhu` isi `{"value": 75}` | Nilai muncul di R-Net ≤ 1 menit |
| 6 | `stop.bat` | Semua proses mati; R-Net menampilkan "stream terputus" |

---

## 9. Troubleshooting

### Stream / mirror tidak muncul di R-Net

Periksa berurutan — hampir selalu berhenti di salah satu dari empat ini:

| # | Periksa | Cara |
|---|---|---|
| 1 | `TUNNEL_TOKEN` terisi | Buka `config.env`. Kalau barisnya `TUNNEL_TOKEN=` saja, tunnel tidak pernah jalan — `start.bat` juga memperingatkannya. Jalankan `install.bat` lagi untuk mengisi. |
| 2 | Tunnel tersambung | `start.bat` harus mencetak "Named tunnel tersambung". Kalau ditolak = token salah/kedaluwarsa. Log: `cloudflared\tunnel.log`. |
| 3 | Layanan lokal hidup | Daftar status di akhir `start.bat`: mirror butuh **TightVNC + websocat**; stream butuh **MediaMTX**. |
| 4 | Alamat di R-Net sama persis | Kelola Screen harus berisi hostname dari bagian 2. |

### Video

| Gejala | Penyebab umum | Cara cek/atasi |
|---|---|---|
| Video hitam / "Stream terputus" | OBS tidak streaming | Di OBS harus terlihat tombol "Stop Streaming" |
| Video patah-patah | Keyframe Interval bukan 1 s, atau bitrate kegedean | Cek Settings OBS (bagian 5) |
| Password viewer ditolak | Salah isi Kelola Screen | User `rein-viewer` + password **viewer** (bukan publish) |
| Video tidak jalan padahal tunnel sehat | Domain R-Net tidak cocok dengan `hlsAllowOrigins` | Buka `mediamtx\mediamtx.yml`, pastikan barisnya memuat domain R-Net yang dipakai |

### Delay video 6–10 detik (target ~3 detik)

Delay total = delay **OBS/encoder** + delay **Cloudflare Tunnel**.
Cara tahu biang keroknya — bandingkan di PC server itu sendiri:

1. Di PC server buka `http://127.0.0.1:8888/scada/index.m3u8` dengan VLC
   (Open Network Stream). Ini **melewati Cloudflare** — murni OBS+MediaMTX.
2. Bandingkan dengan yang terlihat dari laptop lain (lewat internet).

- **Di PC server pun sudah lambat** → biangnya OBS: matikan B-frames /
  Look-ahead (bagian 5), delay turun drastis.
- **Di PC server cepat, via internet lambat** → tambahan delay dari
  Cloudflare Tunnel (batas bawaan tunnel gratis, tidak bisa ditekan lewat
  config). Terima ~4–6 detik.
- LL-HLS tetap patah-patah dan kamu pilih STABIL daripada cepat: di
  `mediamtx.yml` ganti `hlsVariant: lowLatency` → `hlsVariant: mpegts`
  (delay naik ~8–15 detik).

### Mirror / VNC

| Gejala | Penyebab umum | Cara cek/atasi |
|---|---|---|
| Channel VNC "Menghubungkan…" terus | Tunnel/websocat belum jalan | Jalankan `start.bat mirror`, lihat daftar status, refresh R-Net |
| **`WebSocket ... failed` + `code: 1006`**, atau buka hostname di browser dapat **502 Bad Gateway** | Service Type di dashboard Cloudflare diset **HTTPS**, padahal websocat bicara HTTP polos | Dashboard → Public Hostname mirror → **Type: HTTP**, URL `localhost:6080`. Alamat di R-Net **tetap** `https://` |
| "Alamat sumber VNC memakai http://" | Alamat di Kelola Screen diawali `http://`; browser memblokir `ws://` dari halaman https | Ganti jadi `https://` di Kelola Screen. Ini **tidak** ada hubungannya dengan setelan Type di tunnel |
| **"Sorry, loopback connections are not enabled"** | TightVNC menolak koneksi dari 127.0.0.1, padahal websocat konek dari situ | TightVNC → Configuration → centang **Allow loopback connections**, restart TightVNC. Installer menyetel ini otomatis |
| **"Server is not configured properly"** | Password mendarat di hive registry yang salah. TightVNC menyimpannya di dua tempat: mode **aplikasi** baca `HKCU`, mode **service** baca `HKLM`. Password yang diset lewat GUI "Service Mode Configuration" hanya masuk HKLM — kalau lalu dijalankan mode aplikasi, server mewajibkan password yang tidak dilihatnya | `kredensial.bat` → **[S] Perbaiki hive TightVNC** (menyalin password yang ada ke semua hive, tanpa ketik ulang), lalu `stop.bat` + `start.bat`. `start.bat` juga memperingatkan kondisi ini sebelum terjadi |
| "Server VNC minta password" | `VNC_VIEW_PASSWORD` kosong/beda dengan TightVNC | Samakan di `config.env` dan di R-Net > Kelola Screen |
| Layar hitam | PC sumber sleep | Settings → Power → Never; layar boleh mati, sesi Windows harus tetap login |
| Gambar tidak update | Browser cloud SCADA logout (token 24 jam) | Login ulang di PC sumber |

### Data / MQTT

| Gejala | Penyebab umum | Cara cek/atasi |
|---|---|---|
| V-Box tidak bisa konek | Alamat/akun broker VPS salah, atau VPS tidak terjangkau | Cek host/port/akun di perangkat; pastikan VPS hidup |
| "Connection refused: not authorised" | Username/password broker salah | Samakan dengan akun di VPS dan di R-Net > Kelola Site |
| Data tidak muncul padahal broker OK | Bridge tidak jalan / topik tidak cocok | `start.bat data`; topik di perangkat harus PERSIS sama dengan tag di R-Net |
| Bridge langsung mati | `DATABASE_URL` kosong/salah | Isi di `config.env` (Supabase transaction pooler, port 6543) |

---

## 10. Uninstall Total

Dobel-klik **`uninstall.bat`** → ketik `HAPUS`. Skrip mematikan semua layanan,
menawarkan melepas TightVNC, lalu menanyakan apakah folder + `config.env` ikut
dihapus.

OBS / Node.js / Python **tidak** dihapus otomatis (sering dipakai hal lain) —
lepas manual lewat Settings → Apps kalau memang mau.

### Catatan keamanan

- Semua port (1935 RTMP, 8888 HLS, 5900 VNC, 6080 websocat) hanya listen di
  PC itu sendiri. Satu-satunya jalan masuk dari luar adalah tunnel
  (terenkripsi).
- Password **view-only** VNC ikut tersimpan di config channel dan terbaca
  semua user R-Net (memang diperlukan browser penonton untuk konek) — karena
  itu **jangan pernah** menaruh password KONTROL di sana.
- `config.env` berisi token tunnel dan alamat database. Jangan dikirim lewat
  chat/email, jangan ikut disalin ke flashdisk yang beredar.
