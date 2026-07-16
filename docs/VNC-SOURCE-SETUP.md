# Sumber VNC untuk R-Net — Setup PC Dedicated (View-Only)

Panduan menyiapkan 1 PC dedicated yang layarnya (misalnya browser yang membuka
cloud SCADA) ditampilkan di R-Net sebagai channel jenis **"VNC (Layar PC)"**.

## Arsitektur

```
┌─ PC Dedicated (nyala 24/7, no sleep) ─────────────┐
│  Browser membuka cloud SCADA (login manual)       │
│  TightVNC Server (view-only) ── 127.0.0.1:5900    │
│  websocat ── ws 127.0.0.1:6080 → 5900             │
│  cloudflared Quick Tunnel ── xxx.trycloudflare.com│
└───────────────────────────────────────────────────┘
                     │  wss:// (TLS oleh Cloudflare)
                     ▼
      Browser viewer (R-Net) — noVNC RFB client,
      view-only dipaksa, auto-reconnect
```

Penting dipahami: **browser viewer konek langsung ke PC VNC** (lewat tunnel),
bukan lewat backend REIN. Backend hanya menyimpan konfigurasi channel.

## Cara cepat — installer (disarankan)

Semua langkah di bawah sudah diotomasi oleh installer universal R-Net:

1. Salin folder `deploy/scada/` ke PC dedicated, jalankan:

   ```powershell
   powershell -NoProfile -ExecutionPolicy Bypass -File install.ps1
   ```

   Pilih komponen **5** (Sumber VNC). Installer akan:
   - memasang **TightVNC** (winget resmi) dan **menonaktifkan service-nya**
     — dijalankan sebagai aplikasi biasa lewat saklar, konsisten dengan
     prinsip "tidak ada yang hidup diam-diam";
   - menyetel **dua password** (KONTROL untuk maintenance Anda, VIEW-ONLY
     untuk R-Net; maks 8 karakter — batas protokol VNC klasik);
   - mengunduh **websocat** (jembatan WebSocket, 1 file exe dari GitHub
     resmi, SHA-256 dicetak — pengganti websockify tanpa Python) dan
     **cloudflared** (verifikasi tanda tangan digital);
   - mengisi `VNC_CHANNEL` + `VNC_VIEW_PASSWORD` di `config.env`.

2. Di R-Net → **Channel** → Channel Baru → jenis **VNC (Layar PC)** dengan
   nomor = `VNC_CHANNEL`. Alamat/password akan diisi otomatis oleh saklar.

3. Rutinitas tiap PC dinyalakan: buka browser cloud SCADA + login, lalu
   dobel-klik **`start-vnc.bat`** — TightVNC + websocat + Quick Tunnel
   hidup, dan alamat (+password view-only) channel ter-update otomatis di
   database (pola yang sama dengan `start-scada.bat` untuk stream video).
   URL Quick Tunnel memang berubah tiap start — tidak masalah, karena
   saklar yang menuliskannya. Matikan dengan `stop-vnc.bat`.

Panduan operator lengkap: `deploy/scada/PANDUAN-RNET.md` bagian 8.

---

## Cara manual (tanpa installer)

Untuk yang mau menyiapkan sendiri, atau sumbernya bukan Windows.

### 1. VNC Server (Windows) — WAJIB view-only

Pakai **TightVNC Server** (gratis, ringan):

1. Install TightVNC. Service boleh di-skip/dinonaktifkan — jalankan manual
   (`tvnserver.exe -run`) sesuai kebiasaan saklar manual.
2. Buka **TightVNC Server → Configuration**:
   - **Primary password**: untuk maintenance Anda — JANGAN dipakai R-Net.
   - **View-only password**: aktifkan dan set password — password INI yang
     diisi ke channel R-Net. Klien yang login dengan password view-only
     tidak bisa menggerakkan mouse/keyboard, ditegakkan DI SERVER.
   - (Opsional, lebih ketat) Tab Access Control → "Block remote input events"
     untuk menolak input dari SEMUA klien (termasuk Anda sendiri).
3. Uji dari PC lain di LAN dengan VNC viewer biasa: pastikan bisa lihat tapi
   tidak bisa klik.

> Alternatif: UltraVNC (`[admin] DisableInput=1` / ViewOnly password) atau
> x11vnc `-viewonly` kalau sumbernya Linux.

### 2. Jembatan WebSocket — websocat atau websockify

noVNC bicara WebSocket; VNC server bicara TCP biasa. Dua pilihan setara:

**websocat** (1 file exe, tanpa Python — yang dipakai installer):

```powershell
websocat.exe --binary ws-l:127.0.0.1:6080 tcp:127.0.0.1:5900
```

**websockify** (referensi resmi noVNC, butuh Python):

```powershell
pip install websockify
websockify 6080 localhost:5900
```

Tidak perlu serve file noVNC apa pun — R-Net sudah membawa client
noVNC-nya sendiri.

### 3. Expose lewat Cloudflare Tunnel (TLS/wss)

R-Net diakses lewat HTTPS, jadi koneksi VNC harus `wss://` (TLS).

**Quick Tunnel** (tanpa akun/domain — URL berubah tiap start):

```powershell
cloudflared tunnel --url http://127.0.0.1:6080
```

**Named tunnel** (URL tetap, butuh domain di Cloudflare) — subdomain baru di
tunnel cloudflared yang sudah dipakai MediaMTX, di `config.yml`:

```yaml
ingress:
  - hostname: vnc-scada.domain-kamu.com
    service: http://localhost:6080
  # ... rule lain ...
  - service: http_status:404
```

Lalu tambahkan DNS route: `cloudflared tunnel route dns <tunnel> vnc-scada.domain-kamu.com`.
Cloudflare meneruskan upgrade WebSocket secara default — tidak ada setting
khusus. TLS ke viewer ditangani Cloudflare.

### 4. Tambah channel di R-Net

Halaman **R-Net → Channel → Channel Baru**:

- **Jenis Sumber**: `VNC (Layar PC)`
- **Alamat noVNC / websockify**: `https://xxx.trycloudflare.com` atau
  `https://vnc-scada.domain-kamu.com`
  (otomatis dinormalisasi jadi `wss://`; alamat LAN `http://192.168.x.x:6080`
  juga bisa untuk uji lokal selama REIN-nya juga dibuka via http)
- **Password VNC**: password **view-only** dari langkah 1
- **Resolusi Layar**: samakan dengan resolusi monitor PC sumber (mis. FHD)

Channel ini lalu ditaruh di layout Monitor seperti channel lain. Mau berapa
pun sumber VNC: satu PC = satu channel (atau beberapa channel ke PC yang sama).

## Perilaku di sisi R-Net (yang sudah ditegakkan kode)

- Koneksi **selalu view-only** (`viewOnly` RFB + `pointer-events: none`) —
  tombol "Interact" milik channel web tidak berlaku untuk channel VNC.
- **Auto-reconnect** dengan backoff (2 dtk → maks 30 dtk) kalau koneksi putus
  (PC restart, tunnel kedip, dsb) — wall pulih sendiri.
- Password tersimpan di config channel supaya wall auto-connect 24/7.

## Catatan keamanan

- Flag view-only di sisi klien (R-Net) itu kesopanan, bukan pagar. Pagar yang
  sesungguhnya adalah **konfigurasi view-only di VNC server** (password
  view-only TightVNC yang diset installer / langkah 1) — jangan pernah
  menaruh password kontrol di channel R-Net.
- Password VNC di config channel **terbaca oleh semua user REIN yang punya
  `scada:view`** (browser mereka memang butuh password itu untuk konek).
  Karena itu wajib password khusus view-only, bukan password kontrol/admin.
- Jangan expose port 5900 langsung ke internet; websocat/websockify (6080)
  dan TightVNC (5900) cukup listen di 127.0.0.1 — satu-satunya pintu masuk
  adalah tunnel (wss, TLS).
- Token cloud SCADA yang expired 24 jam tetap urusan PC sumber (login manual
  di browser PC itu) — R-Net hanya memantulkan layarnya.
