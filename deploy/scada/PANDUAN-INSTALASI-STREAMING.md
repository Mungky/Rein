# Panduan Instalasi Streaming R-Net (MediaMTX + Cloudflare Tunnel)

> Untuk memasang pemancar video R-Net di **komputer mana pun** dari nol:
> instalasi → konfigurasi → rutinitas tiap komputer nyala → daftarkan stream di R-Net.
> Ditulis untuk orang non-teknis. Waktu pemasangan pertama: ±30 menit.

---

## ⚠️ Baca ini dulu — pilih panduan yang benar

| Situasi Anda | Pakai panduan | Kenapa |
|---|---|---|
| **PC server 24/7** (OBS jalan terus, ditonton dari mana saja) | **[PANDUAN-SERVER-SCADA.md](./PANDUAN-SERVER-SCADA.md)** | Alamat stream **TETAP selamanya** (Named Tunnel). Isi Kelola Stream **sekali**, tidak pernah disentuh lagi. Semua jalan sendiri setelah restart. **Tanpa codebase.** |
| **Laptop / komputer biasa** (nyala hanya saat showcase/tes) | Panduan ini (di bawah) | Gratis, tanpa domain. Konsekuensinya: alamat **ganti tiap dinyalakan**, jadi ada langkah salin-tempel URL. |

**Untuk server, JANGAN pakai panduan ini** — panduan ini sengaja pakai
"Quick Tunnel" yang alamatnya acak/berubah. Server harus pakai "Named Tunnel"
di PANDUAN-SERVER-SCADA supaya alamatnya permanen dan tidak ada salin-tempel
maupun ketergantungan ke kode REIN.

Beda keduanya:

| | Quick Tunnel (panduan ini) | Named Tunnel (server) |
|---|---|---|
| Alamat | `xxxx.trycloudflare.com` — berubah tiap nyala | `scada-stream.domain-anda.com` — tetap |
| Kelola Stream di R-Net | isi ulang tiap boot | isi **sekali**, selesai |
| Butuh domain di Cloudflare | Tidak | Ya (sekali setup) |
| Ketergantungan codebase | Tidak (salin-tempel manual) | Tidak (alamat tetap) |

## Gambaran besar (apa yang sedang kita rakit)

```
OBS (rekam layar/kamera)
  → MediaMTX (pemancar, di komputer yang sama)
    → Cloudflare Tunnel (kabel aman ke internet, tanpa buka port router)
      → halaman R-Net di https://rein.remula-inti.com/r-net
```

Hanya **2 program** yang berjalan: `mediamtx.exe` dan `cloudflared.exe`.
Keduanya cuma file .exe biasa — tidak ada installer, tidak menyentuh registry,
uninstall = hapus foldernya.

---

## BAGIAN 1 — Instalasi (sekali saja per komputer)

> **⚡ Jalan pintas (disarankan):** salin folder `deploy/scada/` ke komputer itu,
> lalu jalankan sekali:
> ```
> powershell -NoProfile -ExecutionPolicy Bypass -File install.ps1
> ```
> Installer mengunduh MediaMTX + cloudflared dari sumber resmi, membuat
> `mediamtx.yml` + `config.env` (menanyakan password & kredensial), dan memasang
> saklar start/stop — semua otomatis, tanpa Python. Langkah 1.1–1.4 di bawah
> hanya untuk yang ingin melakukannya manual.

### 1.1 Siapkan folder

Buat folder ini:

```
C:\rein-scada\
├── mediamtx\
└── cloudflared\
```

### 1.2 Unduh MediaMTX

1. Buka https://github.com/bluenviron/mediamtx/releases
2. Unduh file `mediamtx_vX.X.X_windows_amd64.zip` (versi terbaru)
3. Ekstrak → salin `mediamtx.exe` ke `C:\rein-scada\mediamtx\`
4. Salin file `mediamtx.yml` dari folder repo ini (`deploy/scada/mediamtx.yml`)
   ke `C:\rein-scada\mediamtx\mediamtx.yml`
5. Buka `mediamtx.yml` dengan Notepad, ganti semua nilai `GANTI_*`:
   - `GANTI_DOMAIN_REIN` → `https://rein.remula-inti.com`
   - `GANTI_PASSWORD_PUBLISH` → password bebas untuk OBS (catat!)
   - `GANTI_PASSWORD_VIEWER` → password bebas untuk penonton (catat!)

   ⚠️ Pakai password yang kuat dan BERBEDA di tiap komputer. Password contoh
   `*-lokal-123` hanya untuk tes di laptop pribadi.

### 1.3 Unduh cloudflared

1. Buka https://github.com/cloudflare/cloudflared/releases
2. Unduh `cloudflared-windows-amd64.exe`
3. Ganti namanya jadi `cloudflared.exe`, taruh di `C:\rein-scada\cloudflared\`

Tidak perlu akun Cloudflare untuk mode "Quick Tunnel" (dipakai panduan ini).

### 1.4 Buat dua tombol saklar

Buat 2 file berikut di `C:\rein-scada\` dengan Notepad
(**Save As → All Files**, bukan .txt):

**`start-scada.bat`**
```bat
@echo off
echo Menyalakan pemancar R-Net...

start "" /min C:\rein-scada\mediamtx\mediamtx.exe

cd /d C:\rein-scada\cloudflared
del tunnel.log 2>nul
start "" /min cmd /c "cloudflared.exe tunnel --url http://127.0.0.1:8888 2> tunnel.log"

echo Menunggu alamat tunnel (maks 30 detik)...
timeout /t 15 /nobreak >nul
findstr /r "https://.*trycloudflare.com" tunnel.log
echo.
echo ==================================================================
echo  SALIN alamat https://....trycloudflare.com di atas, lalu tempel
echo  ke R-Net: halaman R-Net - tombol "Kelola Stream" - kolom URL HLS:
echo     https://ALAMAT-TADI.trycloudflare.com/scada/index.m3u8
echo  (kalau alamat belum muncul, buka tunnel.log dan cari sendiri)
echo ==================================================================
pause
```

**`stop-scada.bat`**
```bat
@echo off
taskkill /IM mediamtx.exe /F >nul 2>&1
taskkill /IM cloudflared.exe /F >nul 2>&1
echo [OK] Pemancar R-Net dimatikan. (OBS ditutup sendiri.)
pause
```

### 1.5 Pasang & setel OBS

1. Unduh OBS dari https://obsproject.com → install biasa
2. Settings → **Stream**:
   | Kolom | Isi |
   |---|---|
   | Service | Custom |
   | Server | `rtmp://127.0.0.1:1935` |
   | Stream Key | `scada?user=obs&pass=PASSWORD_PUBLISH_ANDA` |
3. Settings → **Output** → mode Advanced → Streaming:
   - Encoder: x264 (atau NVENC kalau ada GPU NVIDIA)
   - Rate Control: CBR, Bitrate: 4000–6000 Kbps
   - **Keyframe Interval: 1 s** ← WAJIB, kalau bukan 1 detik stream tersendat
4. Susun scene: tangkap layar/jendela SCADA yang mau disiarkan.

---

## BAGIAN 2 — Rutinitas tiap komputer dinyalakan

Quick Tunnel memberi **alamat baru setiap kali dinyalakan** — itulah kenapa ada
langkah "tempel URL". Urutannya selalu sama:

1. **Dobel-klik `C:\rein-scada\start-scada.bat`**
2. Tunggu sampai alamat `https://xxxx.trycloudflare.com` muncul → **salin**
3. Buka R-Net → tombol **Kelola Stream** → edit stream → kolom **URL HLS** →
   tempel: `https://xxxx.trycloudflare.com/scada/index.m3u8` → Simpan
4. Buka **OBS** → **Start Streaming**
5. Cek hasil: buka `https://rein.remula-inti.com/r-net` → video tampil ±5 detik

**Mematikan** (setelah selesai): Stop Streaming di OBS → dobel-klik `stop-scada.bat`.

> **Varian otomatis (tanpa salin-tempel):** kalau `config.env` sudah diisi
> (SUPABASE_URL + service key), `start-scada.bat` akan meng-update alamat stream
> di database **sendiri** setiap kali dinyalakan — langkah 2–3 di atas dilewati.
> Ini murni PowerShell (tanpa Python, tanpa repo REIN); paling gampang dipasang
> lewat `install.ps1`. Kalau `config.env` dikosongkan, script cukup menampilkan
> alamat tunnel untuk ditempel manual.

> **Komputer server 24/7 (tanpa langkah manual sama sekali):** pakai
> `PANDUAN-SERVER-SCADA.md` di folder ini — di sana MediaMTX + cloudflared
> dipasang sebagai service (NSSM) dengan **named tunnel** yang alamatnya TETAP,
> sehingga URL tidak pernah berubah dan semuanya hidup sendiri setelah restart.
> Itu konfigurasi yang benar untuk PC server sungguhan; saklar manual di
> panduan ini untuk laptop/komputer biasa.

---

## BAGIAN 3 — Setup stream di R-Net

Sekali per sumber video (butuh izin **Kelola Stream R-Net** / `scada:manage`):

1. Buka `https://rein.remula-inti.com/r-net` → tombol **Kelola Stream** → Tambah Stream
2. Isi:
   | Kolom | Isi |
   |---|---|
   | Nama | Bebas, mis. "SCADA Plant 1" |
   | URL HLS | `https://ALAMAT-TUNNEL.trycloudflare.com/scada/index.m3u8` |
   | User (read) | `rein-viewer` |
   | Password (read) | password viewer yang Anda catat di langkah 1.2 |
3. Simpan → masuk mode **Atur Layout** → **Tambah Panel** → Video Stream → pilih
   stream tadi → Simpan.

Siapa yang bisa menonton diatur admin lewat matrix izin (kunci **Lihat R-Net**).
Tanpa login REIN + izin itu, alamat stream menolak semua orang (401).

### Lebih dari satu komputer pemancar?

Tiap komputer = 1 pemancar = 1 entri stream di Kelola Stream. Path `scada` di
`mediamtx.yml` boleh sama karena alamat tunnelnya berbeda. Panel video di
R-Net bisa menampilkan semuanya berdampingan dalam satu layout.

---

## BAGIAN 4 — Cek kesehatan & masalah umum

| Gejala | Penyebab paling sering | Obat |
|---|---|---|
| R-Net: "Stream terputus — menyambung ulang…" | OBS belum Start Streaming, atau URL HLS di Kelola Stream masih alamat tunnel lama | Start Streaming; atau ulangi Bagian 2 langkah 2–3 |
| OBS: "Failed to connect to server" | MediaMTX belum jalan | Jalankan `start-scada.bat`; cek Task Manager ada `mediamtx.exe` |
| OBS connect tapi langsung putus | Stream Key salah (user/pass publish tidak cocok dengan mediamtx.yml) | Samakan password di Stream Key dan `mediamtx.yml` |
| Video jalan tapi patah-patah | Keyframe Interval di OBS bukan 1 s, atau upload internet kurang | Set 1 s; turunkan bitrate ke 2500–4000 |
| Alamat tunnel tidak muncul di start-scada | Internet mati / firewall memblokir cloudflared | Cek koneksi; buka `cloudflared\tunnel.log` |
| Latensi > 15 detik | Fallback `hlsVariant: mpegts` sedang aktif, atau tab lama tidak di-refresh | Pastikan `hlsVariant: lowLatency`; refresh halaman |
| Semua benar tapi video kosong + error 401 di Console browser | User/password viewer di Kelola Stream tidak cocok dengan `mediamtx.yml` | Samakan `rein-viewer` + passwordnya di kedua sisi |

**Uji cepat tanpa OBS** (memastikan pemancar sehat): setelah start-scada,
buka `http://127.0.0.1:8888/scada/index.m3u8` di browser komputer itu —
harus minta user/password (401), BUKAN "can't be reached". Kalau minta
password = MediaMTX sehat; masalah ada di langkah lain.

## Uninstall total

`stop-scada.bat` → hapus folder `C:\rein-scada` → uninstall OBS dari
Settings Windows. Selesai, tidak ada jejak lain.
