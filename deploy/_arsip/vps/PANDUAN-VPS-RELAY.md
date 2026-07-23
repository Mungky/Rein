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
**1935/TCP** (RTMP dari site), **8883/TCP** (MQTT+TLS dari V-Box/site),
**8189/UDP** (media WebRTC — delay <1 detik), dan **8890/UDP** (SRT —
jalur kirim anti-jaringan-goyang, lihat §11). Selain itu tutup.

> **1883 JANGAN dibuka.** Compose memetakan 1883 hanya ke `127.0.0.1` VPS
> (plaintext untuk debug lokal); jalur publik satu-satunya adalah **8883
> dengan TLS** (setup sertifikat di §7a).

## 3. Pasang relay di Coolify (±5 menit)

> ⚠️ **Pilih tipe "Docker Compose Empty" — JANGAN "Dockerfile".**
> File ini adalah docker-compose (mulai dengan `services:`); kalau ditempel
> ke tipe Dockerfile akan gagal dengan error
> `unknown instruction: services:`. Tipe "Dockerfile" baru dipakai nanti di
> §4 untuk bridge — itu pun lewat pilihan repository, bukan paste.

1. Coolify → **+ New → Docker Compose Empty**.
2. Paste seluruh isi **`deploy/vps/docker-compose.yml`**.
3. Di editor compose, ganti semua **`GANTI_...`** dengan password kuat
   (viewer + satu per site). **CATAT** — viewer dipakai di R-Net, site
   dipakai di OBS.
4. Tab **Environment Variables**: tambah `MQTT_PASS` (dan `MQTT_USER` bila
   tidak mau default `vbox`).
5. Service **mediamtx** → kolom **Domains**: isi
   `https://stream.remula-inti.com:8888` — angka `:8888` di belakang
   memberi tahu Coolify port container yang dipetakan ke domain.
   (Coolify/Traefik otomatis mengurus sertifikat HTTPS.)
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
  **`8883`**, User/Pass = `MQTT_USER`/`MQTT_PASS`. (Bridge otomatis memakai
  TLS saat port site = 8883 — tidak ada setelan tambahan.)
- V-Net (Wecon): arahkan publish MQTT ke alamat yang sama, port 8883,
  centang SSL/TLS di setelan V-Box.
- Data mengalir: V-Box → mosquitto (VPS, TLS) → bridge → historian → tab Data.

## 7a. Sertifikat TLS untuk MQTT (certbot / Let's Encrypt)

Coolify/Traefik hanya mengurus HTTPS untuk domain web — MQTT adalah TCP
mentah, jadi mosquitto perlu sertifikatnya sendiri. Karena port 80/443 sudah
dipakai Traefik dan DNS ada di Cloudflare, pakai **tantangan DNS-01**:

```bash
# 1. Pasang certbot + plugin Cloudflare (sekali)
apt install certbot python3-certbot-dns-cloudflare

# 2. Token API Cloudflare (Zone:DNS:Edit untuk remula-inti.com)
install -m 600 /dev/null /root/.secrets/cloudflare.ini
echo "dns_cloudflare_api_token = ISI_TOKEN_CLOUDFLARE" > /root/.secrets/cloudflare.ini

# 3. Deploy-hook: salin sertifikat ke folder yang di-mount mosquitto.
#    (JANGAN mount /etc/letsencrypt langsung — privkey hanya terbaca root;
#    user mosquitto di container ber-uid 1883.)
cat > /etc/letsencrypt/renewal-hooks/deploy/mosquitto.sh <<'EOF'
#!/bin/sh
mkdir -p /data/mosquitto-certs
cp /etc/letsencrypt/live/stream.remula-inti.com/fullchain.pem /data/mosquitto-certs/
cp /etc/letsencrypt/live/stream.remula-inti.com/privkey.pem   /data/mosquitto-certs/
chown -R 1883:1883 /data/mosquitto-certs
chmod 640 /data/mosquitto-certs/privkey.pem
docker restart $(docker ps -q --filter ancestor=eclipse-mosquitto:2) 2>/dev/null || true
EOF
chmod +x /etc/letsencrypt/renewal-hooks/deploy/mosquitto.sh

# 4. Terbitkan sertifikat (deploy-hook ikut terpanggil; renew otomatis
#    lewat timer systemd bawaan certbot)
certbot certonly --dns-cloudflare \
  --dns-cloudflare-credentials /root/.secrets/cloudflare.ini \
  -d stream.remula-inti.com
```

Lalu redeploy resource mosquitto di Coolify (compose sudah membuka 8883 dan
me-mount `/data/mosquitto-certs`).

**Tes penerimaan TLS:**

```bash
# DARI LUAR VPS (laptop/PC site) — 1883 HARUS gagal (refused/timeout):
mosquitto_sub -h stream.remula-inti.com -p 1883 -t 'rnet/#' -u vbox -P PASS
#   → "Connection refused" ✔

# 8883 dengan TLS HARUS jalan:
mosquitto_sub -h stream.remula-inti.com -p 8883 -t 'rnet/#' -u vbox -P PASS --capath /etc/ssl/certs
#   (Windows: mosquitto_sub ... -p 8883 --tls-use-os-certs)

# Cek sertifikat tersaji benar:
openssl s_client -connect stream.remula-inti.com:8883 -servername stream.remula-inti.com </dev/null
#   → "Verify return code: 0 (ok)" dan issuer Let's Encrypt ✔

# DARI DALAM VPS — plaintext lokal masih bisa (debug):
mosquitto_sub -h 127.0.0.1 -p 1883 -t 'rnet/#' -u vbox -P PASS
```

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

## 10. WebRTC — delay <1 detik (opsional, setelah HLS stabil)

HLS punya jeda bawaan ±4 detik. WebRTC (teknologi video call) menurunkannya
ke bawah 1 detik. Pemutar R-Net **mencoba WebRTC dulu lalu otomatis balik ke
HLS** bila jaringan penonton memblokirnya — jadi mengaktifkan ini tidak
pernah memperburuk apa pun.

1. **DNS**: tambah A record `webrtc` → IP VPS (DNS-only juga).
2. **Firewall**: pastikan **8189/UDP** terbuka (§2).
3. **Coolify**: compose versi terbaru sudah `webrtc: yes`. Di service
   mediamtx → **Domains**, tambahkan domain kedua:
   `https://webrtc.remula-inti.com:8889`
   (dipisah koma dari domain stream yang sudah ada). Redeploy.
4. **R-Net → Channel → Sumber Stream** → Ubah stream → isi kolom
   **URL WebRTC**: `https://webrtc.remula-inti.com/server/whep`
   (ganti `server` dengan nama path stream itu).
5. Buka Monitor: panel video menampilkan badge **RT** hijau = jalur
   real-time aktif. Tidak muncul / balik ke angka ms = penonton itu jatuh ke
   HLS (biasanya jaringan kantor memblokir UDP — bukan kerusakan).

> Catatan: WebRTC memakai bandwidth per penonton yang sama dengan HLS.
> Kalau kuota menipis, cukup kosongkan kolom URL WebRTC → semua kembali HLS.

## 11. Stream putus-nyambung / kualitas turun di OBS?

**Konteks penting:** di sistem lama (start-scada lokal), OBS mengirim ke
MediaMTX di PC yang sama — tidak lewat internet, jadi selalu stabil.
Sekarang jalur kirim melewati internet site; kalau site pakai **WiFi**,
micro-drop WiFi membuat RTMP tersendat → OBS menurunkan bitrate (kualitas
terlihat turun — itu fitur "Dynamically change bitrate" bekerja) atau putus.

Urutan penanganan:
1. **Kabelkan (LAN) PC pemancar** — obat paling ampuh; WiFi adalah penyebab
   #1 kirim tidak stabil.
2. **Stream Key** OBS terisi benar (`server?user=site-server&pass=...` —
   bukan kosong).
3. Log mediamtx di Coolify saat OBS connect: `authentication failed` =
   password salah; `path not configured` = nama path salah; dua IP
   bergantian = dua OBS rebutan path yang sama (matikan pemancar lama!).
4. Dropped frames OBS naik = upload keteteran → bitrate 1500 CBR.
5. Jaringan site memang labil / tetap WiFi → ganti jalur kirim ke **SRT**
   (anti-jaringan-goyang, kualitas tidak diturunkan):
   - Firewall VPS: port **8890/UDP** terbuka (§2).
   - OBS → Server:
     `srt://stream.remula-inti.com:8890?streamid=publish:server:site-server:PASSWORD&latency=500000`
   - Stream Key: **dikosongkan**. Password sebaiknya huruf+angka saja.
   - `latency=500000` = penyangga 0,5 dtk untuk koreksi paket hilang.

## 12. Rollback

Ada masalah? Sistem lama masih utuh: jalankan `start-scada.bat` di site
(tunnel + auto-update URL) dan stream kembali lewat jalur lama, tanpa
menyentuh VPS.
