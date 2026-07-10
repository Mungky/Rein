# LAPORAN AUDIT R-NET — Fase 2 (2026-07-10)

> Bahasa awam. Empat bidang: **Keamanan · Batas Kemampuan · Kerapian Kode ·
> Tampilan**. Tiap temuan diberi label: 🔴 harus ditindak · 🟡 diketahui &
> diterima dulu · ✅ sudah beres (termasuk yang diperbaiki hari ini).

---

## 1. KEAMANAN

### 🔴 Tindakan USER (tidak bisa saya kerjakan dari sini)
1. **Repo GitHub masih PUBLIC** (`github.com/Mungky/Rein`). Kode, panduan
   internal, dan arsitektur terbaca siapa pun. `.env` aman (tidak ikut), tapi
   tetap: **jadikan private sekarang** (Settings → Danger Zone → Change
   visibility) dan hapus file transkrip `.txt` lama bila masih ada.
2. **Cek `CORS_ORIGINS` di server produksi** — harus berisi persis
   `https://rein.remula-inti.com` (bukan kosong/`*`). Lihat `/opt/rein/.env`.
3. **HTTPS + firewall VPS** (dari laporan lama) — pastikan hanya port 80/443
   terbuka; backend sudah bind 127.0.0.1 ✅.

### 🟡 Diketahui & diterima (dengan alasan)
- **Password viewer stream terkirim ke semua akun yang login** (pemutar video
  membutuhkannya). Risiko: karyawan membagikan link+password → orang luar bisa
  menonton stream. Mitigasi murah: ganti password viewer berkala lewat
  installer; URL tunnel juga berganti tiap restart. Perbaikan sejati (token
  per-sesi) masuk Fase 3.
- **Belum ada CSP** (Content-Security-Policy) di frontend — perlindungan
  lapis-dua terhadap XSS. Ditunda karena rawan merusak Next.js bila asal
  pasang; dijadwalkan setelah infrastruktur stabil.
- **Endpoint data R-Net tanpa rate-limit khusus** — semua sudah wajib login +
  login dibatasi 20/menit, jadi risikonya kecil.
- Sertifikat pooler Supabase tidak diverifikasi (praktik standar koneksi
  pooled Supabase; jalur tetap terenkripsi).

### ✅ Sudah aman (termasuk hari ini)
- Semua 37 endpoint R-Net dicek: **semuanya berpagar izin** (view/manage).
- **Header keamanan dipasang hari ini** di frontend (X-Frame-Options
  SAMEORIGIN, nosniff, Referrer-Policy, Permissions-Policy) dan backend
  (DENY/no-referrer/nosniff) — menutup clickjacking & MIME-sniffing.
- RLS aktif di 32 tabel; pooler 6543 beres; password admin kuat; login
  dibatasi; open-redirect ditutup; URL web channel wajib http(s) (javascript:
  ditolak dua sisi); iframe di-sandbox tanpa popup/fullscreen; `.env` &
  `config.env` tidak pernah masuk Git (diverifikasi tiap commit).

---

## 2. BATAS KEMAMPUAN (angka jujur)

**Prinsip: yang menentukan bukan server R-Net, tapi (a) upload internet PC
pemancar dan (b) kekuatan komputer PENONTON.**

| Komponen | Batas praktis | Penjelasan |
|---|---|---|
| Video per halaman | **≤ 6 stream berbeda** | 1 stream = 1 decode di PC penonton; crop GRATIS (9 crop dari 1 mosaic = tetap 1 decode). PC ruang monitor sanggup 6–10 decode 1080p |
| Web embed per halaman | **≤ 4–6** | 1 embed ≈ 1 tab browser (150–300 MB RAM) |
| Panel data (grafik/tabel) | longgar (≤ 24/halaman) | ringan; realtime cuma 1 koneksi per penonton |
| **Upload PC pemancar** | **= jumlah penonton × bitrate** | Tunnel gratis TIDAK meng-cache: 10 penonton × 2.5 Mbps = 25 Mbps upload. INI leher botol utamanya |
| Penonton API bersamaan | puluhan, aman | backend 2 worker; koneksi DB 10/15 terpakai maksimal |
| Data historian | 90 hari otomatis dibersihkan | 100 tag/menit ≈ 4,3 juta baris/bulan — masih enteng |
| 137 layar | ✅ lewat halaman + rotasi | BUKAN 137 sekaligus — tak ada produk mana pun yang begitu |

**Resep operasional:** set bitrate OBS **2000–2500 Kbps**; mosaic-kan
kamera/HMI sebanyak mungkin (crop gratis); dan untuk penonton ramai,
**Fase 3 wajib**: MediaMTX pusat di VPS — site meng-upload SEKALI ke VPS,
VPS yang melayani semua penonton (upload site tidak lagi dikali penonton).

---

## 3. KERAPIAN KODE

**Vonis: bukan kapal pecah — modular dan teruji, dengan utang yang
terlokalisasi dan terdaftar.**

- ✅ Tes otomatis: backend **53 lulus**, frontend **33 lulus**, build produksi
  bersih, TypeScript 0 error.
- ✅ **Kode mati dibuang hari ini**: sistem mosaic lama (wall-panel,
  channel-combobox, channels.ts), stub streamChat, helper tak terpakai —
  ±700 baris hilang. Lint **0 warning**.
- 🟡 **17 error lint tersisa** — SEMUA satu pola lama ("setState dalam
  effect") di modul Library/Admin/Workspace (bukan R-Net), berjalan normal
  tapi tidak ideal. Rencana: diperbaiki bertahap setiap modulnya disentuh,
  bukan diborong (borongan berisiko merusak yang sudah jalan).
- 🟡 `deploy/scada` punya 2 panduan streaming yang tumpang tindih — rapikan
  saat Fase 3 menulis panduan VPS.

---

## 4. TAMPILAN

- ✅ Hari ini: dropdown white-on-white diperbaiki di AKARNYA (tema gelap kini
  memberi tahu browser via `color-scheme` — semua kontrol bawaan ikut gelap).
- ✅ Sebelumnya: combobox channel, layar orbit RePhot, kanvas OBS-style,
  tombol chrome konsisten.
- 🟡 Sisa saran (nanti, bukan darurat): seragamkan gaya menu/dialog, skeleton
  loading, empty-state ilustrasi.

---

## KESIMPULAN & URUTAN BERIKUTNYA

Sistem **layak dipakai tim internal sekarang** dengan resep operasional di
atas. Sebelum dibuka lebih luas (klien / puluhan penonton):

1. **USER hari ini:** repo → private; cek CORS_ORIGINS; firewall VPS.
2. **Fase 3 (berikutnya):** MediaMTX pusat di VPS + domain tetap → leher
   botol upload hilang, URL tak berganti-ganti, siap puluhan penonton.
3. Setelah itu: token stream per-sesi + CSP + cicil 17 lint error.

*Diaudit & diperbaiki 2026-07-10. Perbaikan hari ini ada di commit audit
Fase 2 (lihat git log).*
