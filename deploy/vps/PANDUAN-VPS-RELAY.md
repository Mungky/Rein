# Panduan Relay Pusat di VPS (Fase 3) — Coolify

> **Tujuan:** site meng-upload siaran **sekali** ke VPS; VPS yang melayani
> semua penonton, dengan **alamat permanen** (`stream.remula-inti.com`).
> Tidak ada lagi tunnel, tidak ada URL ganti-ganti, tidak ada start-scada di
> site — **PC site cukup menjalankan OBS**.
>
> Cocok untuk VPS yang sudah menjalankan Coolify (mis. Hostinger KVM 2).
> MediaMTX sangat ringan (tanpa transcode): ±1–3% CPU per stream.

---

## 0. Yang disiapkan

- Akses DNS domain `remula-inti.com` (Cloudflare/registrar).
- Akses Coolify di VPS.
- Kuota bandwidth VPS: pantau bulan pertama (lihat §8).

## 1. DNS — alamat permanen

Buat **A record**: `stream` → IP VPS.

> Kalau DNS di Cloudflare: set **DNS-only (awan abu-abu)**, bukan proxy —
> supaya delay rendah dan RTMP/WebRTC jalan. Proxy oranye bisa dicoba nanti
> kalau bandwidth mepet (hanya untuk HLS).

## 2. Firewall VPS (panel Hostinger)

Port yang harus terbuka: **80, 443** (sudah, untuk Coolify), tambah
**1935/TCP** (RTMP dari site) dan **1883/TCP** (MQTT dari V-Box).
Selain itu tutup.

## 3. Pasang relay di Coolify (±5 menit)

1. Coolify → **+ New → Docker Compose (empty)**.
2. Paste seluruh isi **`deploy/vps/docker-compose.yml`**.
3. Di editor compose, ganti semua **`GANTI_...`** dengan password kuat
   (viewer + satu per site). **CATAT** — viewer dipakai di R-Net, site
   dipakai di OBS.
4. Tab **Environment Variables**: tambah `MQTT_PASS` (dan `MQTT_USER` bila
   tidak mau default `vbox`).
5. Service **mediamtx** → **Domains**: `https://stream.remula-inti.com`,
   port **8888**. (Coolify/Traefik otomatis mengurus sertifikat HTTPS.)
6. **Deploy**. Cek log: `[HLS] listener opened on :8888` berarti hidup.

> Catatan: compose ini memakai `configs.content` (butuh Docker Compose
> v2.23+ — Coolify baru pasti bisa). Kalau deploy menolak `content`,
> update Coolify/Docker dulu.

## 4. Bridge historian (MQTT → database) di Coolify

1. Coolify → **+ New → Resource dari Git repo** (repo REIN, sudah private —
   hubungkan lewat GitHub App Coolify).
2. Build pack: **Dockerfile**, path: `deploy/scada/mqtt-bridge/Dockerfile`,
   base directory: `deploy/scada/mqtt-bridge`.
3. Environment: `DATABASE_URL` = connection string Supabase **pooler 6543**
   (sama seperti backend).
4. Tanpa domain/port. Deploy.

Bridge membaca daftar broker dari tabel Site (diatur di R-Net → Data →
Kelola Site) — lihat §7.

## 5. Sisi SITE — cukup OBS

Di tiap PC site (contoh site "server"):

- OBS → Settings → Stream:
  - Service: **Custom**
  - Server: `rtmp://stream.remula-inti.com:1935`
  - Stream key: `server?user=site-server&pass=<password site itu>`
- Settings → Output:
  - **Bitrate: 1500–2500 Kbps** (HMI/mosaic statis: 1500 cukup & hemat kuota)
  - **Keyframe Interval: 1 s** (WAJIB — sinkron dengan segment HLS)
  - x264: tune `zerolatency`, B-frames 0 (atau NVENC Ultra Low Latency)
- Start Streaming. Selesai — tidak ada software lain di site.

> Site baru? Tambah 1 blok user `site-...` + 1 baris `paths:` di compose
> (Coolify → edit → redeploy), lalu setel OBS site itu.

> Kamera RTSP tanpa OBS: tambahkan path `source: rtsp://...` +
> `sourceOnDemand: yes` (VPS menarik kamera hanya saat ditonton).

## 6. Daftarkan di R-Net (sekali, permanen)

R-Net → **Channel → Sumber Stream (HLS)** → Tambah:

- Nama: bebas (mis. `Server`)
- URL HLS: `https://stream.remula-inti.com/server/index.m3u8`
- User/Password (read): `rein-viewer` / password viewer

Lalu buat channel (crop bebas dari mosaic) seperti biasa. **URL ini tidak
akan pernah berubah** — start-scada/STREAM_NAME tidak diperlukan lagi untuk
stream yang lewat VPS. (Sistem tunnel lama di `deploy/scada/` tetap ada
sebagai cadangan/darurat.)

## 7. V-Box / MQTT

- R-Net → Data → **Kelola Site**: Host `stream.remula-inti.com`, Port
  `1883`, User/Pass = `MQTT_USER`/`MQTT_PASS`.
- V-Net (Wecon): arahkan publish MQTT ke alamat yang sama.
- Data mengalir: V-Box → mosquitto (VPS) → bridge → historian → tab Data.

> Port 1883 tanpa enkripsi. Password tetap wajib, tapi untuk jangka panjang
> upgrade ke TLS 8883 (Fase berikutnya) atau batasi firewall ke IP site.

## 8. Pantau bandwidth (bulan pertama)

Panel Hostinger → grafik bandwidth. Kasar: **8 TB/bulan ≈ rata-rata
24 Mbps nonstop**. Rumus: `(jumlah stream × bitrate) + (penonton aktif ×
bitrate yang ditonton)`, dikali jam pemakaian.

Kalau tren menuju lewat kuota, urutan obatnya: turunkan bitrate → siaran jam
kerja saja → `sourceOnDemand` untuk kamera → upgrade plan / Cloudflare proxy.

## 9. Tes penerimaan

1. OBS site → Start Streaming → buka
   `https://stream.remula-inti.com/server/index.m3u8` via R-Net (bukan
   browser langsung — butuh Basic auth).
2. Restart container mediamtx → URL **tidak berubah**, player R-Net
   menyambung ulang sendiri.
3. Dua penonton menonton bersamaan → upload site tetap ±1× bitrate (cek
   task manager PC site).
4. V-Box publish → angka muncul di tab Data.

## 10. Rollback

Ada masalah? Sistem lama masih utuh: jalankan `start-scada.bat` di site
(tunnel + auto-update URL) dan stream kembali lewat jalur lama, tanpa
menyentuh VPS.
