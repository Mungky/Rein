# RUNBOOK KEGAGALAN R-Net — 5 Skenario Darurat

> **Untuk siapa dokumen ini:** siapa pun yang sedang jaga saat R-Net bermasalah,
> **tanpa perlu bisa pemrograman**. Ikuti langkahnya berurutan, salin-tempel
> perintahnya apa adanya. Kalau satu langkah gagal, lanjut ke langkah berikutnya
> — jangan panik, data historis aman di database dan arsip Google Drive.

---

## Isi dulu kotak ini (sekali saja, saat keadaan normal)

Simpan nilai-nilai ini di tempat yang bisa dibuka TANPA R-Net (misal dicetak,
atau di catatan HP):

| Apa | Nilai | Contoh |
|---|---|---|
| IP VPS | `..................` | `203.0.113.10` |
| User SSH VPS | `..................` | `root` atau `ubuntu` |
| Alamat dashboard Coolify | `..................` | `https://coolify.remula-inti.com` |
| Alamat web R-Net | `..................` | `https://rein.remula-inti.com` |
| Nama/lokasi PC site (bridge) | `..................` | "PC panel ruang server pabrik" |
| Nomor HP orang IT cadangan | `..................` | |

Cara membuka terminal di Windows: tekan tombol **Windows**, ketik
`powershell`, Enter. Perintah `ssh` diketik di situ.

---

## Tabel cepat: gejala → skenario

| Yang terlihat | Kemungkinan besar | Lompat ke |
|---|---|---|
| Web R-Net tidak bisa dibuka / tidak bisa login, **DAN** Telegram alarm mendadak sunyi total | VPS mati | [Skenario 1](#skenario-1--vps-matiunreachable) |
| Telegram bilang *"Bridge gagal konek ke broker site ..."*; angka sensor berhenti; web & video masih normal | Mosquitto mati | [Skenario 2](#skenario-2--broker-mosquitto-maticrash) |
| Web error di mana-mana, Telegram *"ERROR SERVER: HTTP 5xx"* bertubi-tubi, angka & riwayat kosong | Supabase tak terjangkau | [Skenario 3](#skenario-3--database-supabase-tak-terjangkau) |
| Panel video/layar hitam atau berputar terus; **angka sensor tetap jalan** | Tunnel Cloudflare putus | [Skenario 4](#skenario-4--cloudflare-tunnel--koneksi-site-terputus) |
| Telegram bilang *"Bridge MQTT OFFLINE — heartbeat terakhir ..."*; angka membeku; video dari site itu ikut mati | PC site mati | [Skenario 5](#skenario-5--pc-edge-bridge-rusakmati-total) |

---

## Skenario 1 — VPS mati/unreachable

VPS adalah rumah dari: **backend R-Net (login & semua data di web)**, **mesin
alarm**, **broker Mosquitto**, dan **relay video MediaMTX**. Kalau VPS mati,
semuanya mati sekaligus.

### Gejala
- Web R-Net tidak bisa dibuka, atau terbuka tapi login gagal / semua data error.
- Telegram alarm **sunyi total** — justru karena mesin pengirim alarmnya ikut
  mati, tidak ada pesan apa pun (ini gejala penting: sunyi ≠ aman).
- Semua video/stream mati.
- Angka sensor di lapangan sebenarnya masih dibaca V-Box, tapi tidak sampai ke
  database (brokernya mati).

### Cara memastikan
1. Buka PowerShell, ping VPS (ganti dengan IP dari kotak di atas):
   ```
   ping 203.0.113.10
   ```
   - Semua baris `Request timed out` → VPS benar-benar tidak terjangkau. Lanjut.
   - Ada balasan (`Reply from ...`) → VPS hidup, masalahnya bukan skenario ini;
     coba [Skenario 3](#skenario-3--database-supabase-tak-terjangkau) dulu.
2. Coba masuk SSH:
   ```
   ssh root@203.0.113.10
   ```
   Gagal terus (`Connection timed out`) → VPS mati/hang.

### Pemulihan
1. **Buka panel penyedia VPS** (tempat VPS disewa — DigitalOcean/Vultr/
   Contabo/dll.) lewat browser HP/laptop, login, cari VPS-nya.
2. Klik **Restart / Reboot** (kalau ada pilihan, pakai yang biasa dulu, bukan
   "force"). Tunggu 2–5 menit.
3. Setelah bisa ping lagi, masuk SSH lalu cek semua container jalan:
   ```
   ssh root@203.0.113.10
   docker ps
   ```
   Harus terlihat baris berisi `mosquitto`, `mediamtx`, dan backend R-Net.
   Semuanya `restart: unless-stopped`, jadi normalnya bangkit sendiri.
4. Kalau ada yang tidak muncul: buka **dashboard Coolify** di browser → cari
   aplikasi yang statusnya merah → klik **Restart**.
5. Uji: buka web R-Net, login, lihat angka sensor mulai bergerak lagi
   (butuh ± 1 menit setelah broker hidup).

### Kalau VPS tidak mau hidup sama sekali
Hubungi support penyedia VPS (menu Support/Ticket di panel mereka). Selama VPS
mati: **data historis tetap aman** di Supabase dan arsip Google Drive; yang
hilang hanyalah data sensor selama VPS padam.

**Perkiraan waktu pemulihan:** 5–15 menit (restart) · berjam-jam bila harus
lewat support penyedia.

---

## Skenario 2 — Broker Mosquitto mati/crash

Mosquitto = "kantor pos" tempat V-Box menitipkan angka sensor. Kalau mati,
angka berhenti mengalir, tapi web, login, riwayat lama, dan video tetap normal.

### Gejala
- Telegram: 🔴 *"Bridge gagal konek ke broker site '...' sejak ... menit lalu"*.
- Angka live di dashboard membeku/abu-abu (stale), grafik berhenti bergerak maju.
- Web R-Net dan video **masih normal** (bedanya dengan Skenario 1).

### Cara memastikan
1. SSH ke VPS:
   ```
   ssh root@203.0.113.10
   ```
2. Cek container Mosquitto:
   ```
   docker ps -a | grep -i mosquitto
   ```
   - Status `Up ...` → broker jalan; masalah mungkin di PC site
     ([Skenario 5](#skenario-5--pc-edge-bridge-rusakmati-total)) atau internet site.
   - Status `Exited ...` atau `Restarting` → broker mati/crash. Lanjut.
3. Lihat kenapa dia mati (baca 30 baris terakhir log):
   ```
   docker logs --tail 30 $(docker ps -aq --filter name=mosquitto)
   ```
   Pesan soal `certfile`/`keyfile` = masalah sertifikat TLS (catat, sampaikan ke IT).

### Pemulihan
1. Restart container:
   ```
   docker restart $(docker ps -aq --filter name=mosquitto)
   ```
   Atau lewat dashboard Coolify: cari resource **mosquitto** → **Restart**.
2. Tunggu ± 1 menit, lalu cek statusnya `Up`:
   ```
   docker ps | grep -i mosquitto
   ```
3. Uji dari dalam VPS (port lokal 1883 memang hanya bisa dari dalam VPS):
   ```
   docker exec $(docker ps -q --filter name=mosquitto) sh -c 'mosquitto_sub -h localhost -t "rnet/#" -C 1 -W 20 -u "$MQTT_USER" -P "$MQTT_PASS"'
   ```
   Kalau dalam ± 20 detik muncul satu angka → data sudah mengalir lagi.
4. Cek Telegram: harus muncul pesan 🟢 *"PULIH: Bridge gagal konek ..."*.

**Data yang hilang:** angka selama broker mati tidak tercatat (pesan MQTT tidak
disimpan broker). Riwayat lama aman.

**Perkiraan waktu pemulihan:** 5–10 menit.

---

## Skenario 3 — Database Supabase tak terjangkau

Supabase = tempat SEMUA data disimpan (akun, angka sensor, riwayat, alarm).
Supabase dikelola pihak Supabase sendiri (bukan di VPS kita).

### Gejala
- Web R-Net error hampir di semua halaman; login bisa gagal.
- Telegram: 🔴 *"ERROR SERVER: HTTP 500/503 pada ..."* bisa bertubi-tubi
  (dijatah 1 pesan per 5 menit).
- Angka live dan riwayat sama-sama kosong/error — padahal ping VPS normal.

### Cara memastikan
1. Buka halaman status resmi Supabase di browser:
   **https://status.supabase.com** — kalau ada insiden merah/kuning di region
   project kita, ya itu penyebabnya. Selesai memastikan; tinggal menunggu.
2. Kalau status Supabase hijau semua, cek dashboard project:
   **https://supabase.com/dashboard** → login → pilih project R-Net → lihat
   apakah ada peringatan (misal *project paused* — project gratis bisa
   dijeda otomatis kalau lama tidak aktif; klik **Restore/Resume**).

### Pemulihan
1. **Insiden di pihak Supabase:** tidak ada yang bisa kita perbaiki — tunggu.
   Pantau halaman statusnya. JANGAN restart-restart VPS/PC site; tidak ada
   gunanya dan menambah risiko.
2. **Project paused:** klik **Restore** di dashboard Supabase, tunggu sampai
   status project hijau (± 2–5 menit).
3. Setelah pulih, semuanya nyambung sendiri (backend, bridge, web) — tidak perlu
   restart apa pun.
4. **Kabar baik soal data:** bridge di PC site menyimpan angka yang belum
   terkirim ke file antrean lokal (`bridge_buffer.db`) dan mengirim-ulang
   otomatis begitu database pulih — data sensor selama gangguan **tidak
   hilang**, asalkan PC site tetap menyala.

**Perkiraan waktu pemulihan:** project paused ± 5 menit · insiden Supabase:
di luar kendali kita, biasanya < 1–2 jam (lihat halaman status).

---

## Skenario 4 — Cloudflare Tunnel / koneksi site terputus

Tunnel = jalan keluar video (stream layar/HMI) dan mirror VNC dari PC site ke
internet. **Data sensor TIDAK lewat tunnel** — jadi kalau hanya tunnel yang
putus, angka tetap jalan dan cuma video yang hilang.

### Gejala
- Panel video/layar di tab Monitor hitam, error, atau berputar terus.
- Angka sensor dan grafik **tetap normal** (pembeda utama dari Skenario 5).
- Tidak ada alarm Telegram khusus (kesehatan tunnel tidak dipantau otomatis).

### Cara memastikan
1. Di **PC site**, lihat apakah jendela `cloudflared` masih terbuka dan tidak
   penuh tulisan error merah (jendela itu dibuka `start.bat`).
2. Cek status Cloudflare: **https://www.cloudflarestatus.com** — insiden besar
   Cloudflare berarti tinggal menunggu.
3. Cek internet PC site: buka browser di PC site → coba buka `google.com`.
   Tidak bisa → masalahnya internet site (modem/ISP), bukan tunnel.

### Pemulihan (di PC site)
1. Tutup dulu layanan stream:
   - dobel-klik **`stop.bat`** di folder `deploy` → pilih paket **stream**
     (dan **mirror** kalau dipakai).
2. Nyalakan lagi:
   - dobel-klik **`start.bat`** → pilih paket yang sama.
   - Jendela-jendela (OBS/MediaMTX/cloudflared) terbuka lagi; biarkan terbuka.
3. Tunggu ± 1 menit, buka web R-Net → tab Monitor → video harus tampil lagi.
   Alamat stream **tidak berubah** (named tunnel = alamat permanen), jadi tidak
   perlu mengubah apa pun di Kelola Screen.
4. Kalau masih mati dan internet site normal: restart PC site, lalu ulangi
   langkah 2.
5. Kalau internetnya yang mati: restart modem/router site; kalau tetap mati,
   hubungi ISP site tersebut.

**Perkiraan waktu pemulihan:** 5–10 menit (restart layanan/PC) · mengikuti ISP
bila internet site yang putus.

---

## Skenario 5 — PC edge (bridge) rusak/mati total

PC site menjalankan **bridge** (kurir angka sensor → database) dan biasanya juga
stream video. Kalau PC ini mati: angka berhenti DAN video site itu mati.

### Gejala
- Telegram: 🔴 *"Bridge MQTT OFFLINE — heartbeat terakhir ... menit lalu.
  Cek PC site / proses bridge."*
- Angka live membeku (stale) di semua tag site itu; beberapa menit kemudian
  alarm "sensor bisu" bisa ikut muncul.
- Video/mirror dari site itu ikut hilang.

### Cara memastikan
1. Minta orang di lokasi melihat PC-nya: menyala atau mati? Lampu/monitornya?
2. Kalau PC menyala: apakah jendela hitam bridge (judulnya menyebut *bridge*)
   masih terbuka? Kalau tertutup, berarti prosesnya mati — cukup Pemulihan A.
3. Dari mana pun, cek kapan detak jantung terakhir bridge: buka web R-Net →
   tab **Data** → status bridge/site (kalau ada), atau lihat jam pada pesan
   Telegram-nya.

### Pemulihan A — PC hidup tapi bridge mati
1. Di PC site, buka folder `deploy` → dobel-klik **`start.bat`** → pilih paket
   **data** (plus **stream**/**mirror** kalau jendelanya juga tertutup).
2. Tunggu ± 1 menit. Telegram harus mengirim 🟢 *"PULIH: Bridge MQTT OFFLINE..."*.
3. Angka yang sempat tertahan di antrean lokal (`bridge_buffer.db`) terkirim
   otomatis — tidak perlu diapa-apakan.

### Pemulihan B — PC mati / rusak total
1. Nyalakan/ganti dengan PC Windows lain yang ada internet.
2. Salin folder `deploy` dari repo (atau dari backup) ke PC pengganti.
3. Dobel-klik **`install.bat`** → pilih paket **data** → saat ditanya, isi
   `DATABASE_URL` (alamat database — ada di catatan kredensial; kalau hilang:
   Supabase Dashboard → Project Settings → Database → Connection string,
   pooler port 6543).
4. Dobel-klik **`start.bat`** → paket **data**. Selesai — konfigurasi site/tag
   tidak perlu diisi ulang karena semuanya tersimpan di database, bukan di PC.
5. Untuk video: jalankan `install.bat` paket **stream**, isi `TUNNEL_TOKEN`
   (dari dashboard Cloudflare → Zero Trust → Tunnels) — lihat
   `deploy/docs/PANDUAN-TUNNEL.md`.

**Data yang hilang:** selama PC mati total, angka dari V-Box tidak ada yang
mencatat — periode itu bolong permanen. Begitu bridge hidup, pencatatan lanjut.

**Perkiraan waktu pemulihan:** A: ± 5 menit · B: 30–60 menit (PC pengganti).

---

## Setelah semuanya pulih (checklist 2 menit)

1. Buka web R-Net → angka live bergerak, grafik maju.
2. Telegram → pastikan pesan 🟢 PULIH sudah masuk (bukan cuma sunyi).
3. Tab Monitor → video tampil.
4. Kalau tadi sempat ada alarm sensor, buka daftar alarm dan **Ack** yang sudah
   ditangani, supaya riwayatnya rapi.
