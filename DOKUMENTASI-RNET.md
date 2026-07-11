# R-Net — Dokumentasi Produk & Teknis

> **R-Net** adalah modul *cloud monitoring* di dalam REIN (aplikasi internal
> Remula Inti Rekayasa): satu dinding monitor yang bisa menampilkan **apa
> saja** — HMI SCADA, kamera, halaman web, grafik sensor, tabel data, alarm —
> dari **banyak site sekaligus**, diakses dari browser mana pun (ruang
> kontrol, laptop kantor, HP direksi).
>
> Analogi termudah: **aplikasi CCTV/NVR, tapi "kameranya" bukan cuma kamera**
> — bisa layar HMI, angka sensor live, grafik tren, sampai website.

---

## 1. Kenapa R-Net Ada (masalah yang dijawab)

Remula memakai HMI **Wecon** + cloud **V-Net**. V-Net cukup untuk cek satu
device dari HP, tapi punya lubang besar untuk operasi sungguhan:

| Lubang di ekosistem Wecon/V-Net | Jawaban R-Net |
|---|---|
| Tidak ada mode dinding: melihat BANYAK device/line sekaligus | Halaman kanvas berisi banyak channel, fullscreen di TV ruang monitor |
| Data historian lemah (grafik & riwayat terbatas) | Historian sendiri via MQTT: tren, kalibrasi, export Excel |
| Alarm management minim | Alarm ambang per-tag + panel alarm (akan diperdalam) |
| Kamera via EZVIZ delay ±30 detik | Jalur streaming sendiri (OBS/RTSP → MediaMTX), delay 3–5 dtk |
| Satu akun = satu orang menonton dengan caranya sendiri | Layout terpusat: admin menerbitkan halaman "bawaan" untuk semua user |

Posisi produk (jujur): **R-Net = "remote eyes & report"** — supervisi dan
pelaporan multi-site yang murah. R-Net **bukan** SCADA kontrol
produksi-kritis bersertifikat (lihat §7).

---

## 2. Arsitektur & Tech Stack

```
  SITE (pabrik/line)                    CLOUD                        PENONTON
┌────────────────────┐   ┌──────────────────────────────┐   ┌──────────────────┐
│ OBS (mosaic HMI/   │   │ Vercel   : frontend Next.js  │   │ Browser:         │
│ kamera) → MediaMTX │──▶│ VPS      : backend FastAPI   │──▶│ ruang monitor TV │
│ lokal → Cloudflare │   │ Supabase : Postgres + Auth   │   │ laptop kantor    │
│ Tunnel (HLS)       │   │            + Realtime        │   │ HP direksi       │
│ V-Box → MQTT ──────┼──▶│ Mosquitto + bridge → DB      │   │                  │
└────────────────────┘   └──────────────────────────────┘   └──────────────────┘
```

| Lapisan | Teknologi | Catatan |
|---|---|---|
| Frontend | **Next.js 16 (React 19, TypeScript)**, Tailwind, Zustand | Deploy di Vercel; PWA-style, tema terang/gelap |
| Pemutar video | **hls.js** (LL-HLS) + **WebRTC/WHEP** opsional | Fallback otomatis WebRTC→HLS; decoder di-share (pool) |
| Backend | **FastAPI (Python)**, SQLAlchemy async, Pydantic | 37 endpoint R-Net, semua berpagar izin role |
| Database | **Supabase Postgres** (transaction pooler, RLS 32 tabel), Alembic | Realtime untuk nilai sensor live & presence |
| Streaming | **OBS → MediaMTX → Cloudflare Tunnel** (mode utama) | Alternatif: relay terpusat VPS (`deploy/vps/`, Coolify) — RTMP/SRT/WebRTC |
| Data sensor | **MQTT (Mosquitto)** → bridge Python → historian | Tag + scaling + retensi 90 hari |
| Autentikasi | Supabase Auth (username + role) + matriks izin di DB | `scada:view / edit_layout / manage` |

**Prinsip desain yang dipegang:**
- **Channel = monitor fisik.** Tiap channel punya resolusi tetap; di mana pun
  ditampilkan hanya di-skala utuh, tidak pernah gepeng (ala source OBS).
- **Halaman = kanvas resolusi tetap** (default 1920×1080) — layout tidak
  pernah bergeser karena zoom browser atau beda perangkat.
- **Satu decode dibagi bersama.** 9 crop dari 1 stream mosaic = 1 unduhan +
  1 decode, bukan 9.
- **Tidak pernah kotak hitam bisu.** Setiap kegagalan tampil sebagai layar
  bermerek (Maintenance/Standby) lengkap dengan penyebabnya.

---

## 3. Konsep Inti (kamus 1 menit)

- **Channel** — satu "layar" bernomor + nickname (mis. `CH 3 · Volume Tank
  Lombok`). Isinya salah satu: potongan video stream, halaman web, grafik,
  tabel, angka/status, bar, alarm, atau daftar pengguna online. Didefinisikan
  sekali di tab **Channel**, dipakai di halaman mana pun.
- **Halaman (page)** — susunan channel di kanvas tetap; tiap user bisa punya
  banyak halaman; fullscreen bisa pindah halaman (panah/angka) + gilir
  otomatis.
- **Sumber Stream** — stream HLS (MediaMTX). Satu stream boleh berisi mosaic
  banyak kamera/HMI → dipotong-potong jadi banyak channel (crop manual).
- **Site & Tag** — koneksi broker MQTT dan besaran sensor yang direkam
  historian.
- **Bawaan Admin** — halaman yang diterbitkan admin; otomatis muncul
  (read-only) di daftar halaman SEMUA user; bisa multi-halaman.

---

## 4. Detail Fitur

### Tab Monitor
- Kanvas OBS-style: drag bebas + garis bantu snap (tepi/tengah/panel lain),
  resize kunci-aspek, input X/Y/W/H presisi, "Susun Cepat" (1 / 2×2 / 3×3 /
  4×4 / 1 besar+2), resolusi kanvas per halaman (720p–4K).
- Tambah panel = pilih channel dari daftar (cari nomor/nama).
- **Fullscreen ala ruang kontrol**: remote bawah-tengah (dots, panah,
  angka 1-9), **auto-rotate** halaman (10/15/30/60 dtk), tombol keluar.
- **Maximize per-channel** (ala CCTV): satu channel memenuhi layar, Esc
  kembali.
- Web embed: **keep-alive** (pindah halaman/tab TIDAK me-reload — susunan di
  situs yang di-embed tidak berantakan), tombol **Interact** (default
  click-through), reload per panel, skala tajam (CSS zoom).
- Video: auto-reconnect tanpa henti, watchdog macet, badge ping ms (hijau
  <70), badge **RT** saat jalur WebRTC aktif.
- Mobile: daftar bertumpuk urut posisi layout, aspek mengikuti layar channel.

### Tab Channel (ala OBS: daftar | preview | sources)
- Registry channel bernomor + nickname + jenis + **Resolusi Layar**
  (HD/FHD/2K/4K/custom).
- **Preview live** di kanvas layar channel; form edit di bawahnya —
  **WYSIWYG** (setiap ketikan langsung terlihat).
- **Crop editor visual**: gambar kotak di atas video live (geser/resize),
  tombol "Bagi 2×2/3×3/4×4" lalu klik kotaknya, input piksel; resolusi
  sumber terdeteksi otomatis → 1 stream mosaic jadi N channel independen.
- Panel **Sources**: semua stream & URL, tipe, dan "dipakai di CH berapa".
- Web channel: URL + zoom + geser kiri/atas (buang navbar situs) — fullscreen
  milik situs hanya mengisi panelnya.

### Tab Data (historian MQTT)
- **Site** = broker MQTT (host/port/akun). **Tag** = satu besaran sensor
  (topic → label + satuan).
- **Scaling/kalibrasi tersimpan**: `nilai = mentah × skala + offset`
  (4-20 mA, ADC, dsb.) dengan preview live.
- Workbench ala Excel: sheet, kolom rumus aman (dievaluasi di browser),
  kolom metadata, **export Excel**.
- Panel visual: grafik tren (rentang 1 jam–30 hari), tabel ringkasan,
  angka/status dengan ambang waspada/kritis, bar perbandingan, panel alarm.
- Retensi otomatis 90 hari; nilai live via Supabase Realtime.

### Lintas fitur
- **Bawaan admin multi-halaman**, fork-on-edit (user tak bisa merusak master).
- **Panel Aktivitas**: siapa sedang membuka REIN + sudah berapa lama
  (Realtime Presence, tanpa beban DB).
- Layar **Maintenance/Standby** bermerek (logo RePhot + jam) dengan baris
  penyebab error.
- Matriks izin per-role (lihat/atur layout/kelola sumber) yang bisa diubah
  admin dari UI.

---

## 5. Keamanan (ringkasan audit Fase 2 — detail di `LAPORAN-AUDIT-RNET.md`)

- Semua endpoint wajib login + izin role; RLS aktif di 32 tabel; login
  dibatasi 20/menit; header keamanan di frontend & backend; URL embed wajib
  http(s); iframe di-sandbox; repo private; rahasia tidak pernah masuk Git.
- Diketahui & diterima sementara: kredensial viewer stream terkirim ke semua
  akun login (kebutuhan pemutar; mitigasi rotasi berkala; rencana token
  per-sesi), belum ada CSP.

## 6. Batas Kemampuan (angka jujur)

- Per halaman: **±6 stream berbeda** + **±4–6 web embed** (batasnya komputer
  penonton, bukan server). Crop tidak menambah beban.
- 137 layar dicapai lewat **banyak halaman + auto-rotate**, bukan 137
  sekaligus — sama seperti produk komersial mana pun.
- Mode tunnel (utama): tiap penonton menarik stream dari PC site → jumlah
  penonton dibatasi upload site. Mode relay VPS (opsional, `deploy/vps/`)
  memindahkan beban itu ke server.
- Delay video: LL-HLS 3–5 dtk; WebRTC <1 dtk (tersedia di mode relay VPS).

---

## 7. Perbandingan Jujur dengan SCADA / IIoT di Pasaran

| | **R-Net** | **V-Net (Wecon)** | **Ignition** | **AVEVA / Topkapi** | **Grafana / ThingsBoard** | **VMS CCTV (Milestone dkk.)** |
|---|---|---|---|---|---|---|
| Peran | Dinding monitoring multi-site (video+web+data) | Cloud bawaan HMI Wecon | Platform SCADA modern penuh | SCADA enterprise klasik | Dashboard data/IIoT | Dinding kamera |
| Dinding campuran (HMI+kamera+data) | ✅ inti produk | ❌ | ⚠️ bisa, dirakit | ⚠️ bisa, dirakit | ❌ video lemah | ❌ kamera saja |
| Alarm/event/history kelas industri | ⚠️ dasar (roadmap) | ⚠️ lemah | ✅ | ✅ | ⚠️ alarm dasar | ❌ |
| Kontrol proses (tulis ke PLC) | ❌ by design | ⚠️ terbatas | ✅ | ✅ | ❌ | ❌ |
| Sertifikasi + vendor support + SLA | ❌ | ⚠️ | ✅ | ✅ | ⚠️ | ✅ |
| Biaya lisensi | **±0** | gratis-terbatas | $$ (unlimited tag per server) | $$$$ (per tag/klien) | 0–$$ | $$$ |
| Kustom sesuai kebutuhan Remula | ✅ penuh (kode sendiri) | ❌ | ⚠️ scripting | ⚠️ mahal | ⚠️ | ❌ |

**Cara membacanya:**
- Untuk **supervisi multi-site yang murah dan bisa dibuka dari mana saja**,
  R-Net mengisi celah yang justru lemah di semua kolom lain — itulah
  alasannya dibuat.
- Untuk **SCADA produksi-kritis klien besar** (alarm bersertifikat, event
  journal audit, redundansi, tender): gunakan platform komersial di sisi
  pabrik — **Ignition** adalah pembanding harga/nilai terbaik sebelum
  AVEVA/Topkapi — dan R-Net tetap bisa duduk di atasnya sebagai lapisan
  pandang lintas-site.
- Keputusan produksi selalu dari **HMI lokal (delay nol)**; layar jarak jauh
  — di produk mana pun — adalah supervisi.

---

## 8. Status & Arah

- Status: dipakai internal; audit keamanan & batas kemampuan terdokumentasi;
  86 tes otomatis hijau.
- Arah berikutnya (lihat `ROADMAP-RNET.md`): pendalaman jalur data
  (sampling per-detik/saat-berubah, alarm dengan acknowledge, event log)
  dengan UX sesederhana Video Wall; token stream per-sesi; percobaan WebRTC
  di mode relay.

*Dokumen ini hidup — perbarui setiap fitur besar mendarat. Terakhir:
2026-07-11.*
