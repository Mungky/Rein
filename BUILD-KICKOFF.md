# REIN — Persiapan Pembangunan

> Pembaruan self-host 17 Nov 2026: ikuti PRD revisi 1.7 dan [panduan Coolify](docs/SELFHOST-COOLIFY.md).
> Lampiran memakai volume server, database baru, dan Gmail ditunda. Checklist Google Cloud di bawah
> adalah rencana awal, bukan prasyarat deployment saat ini. Compose produksi ada di root repository.

Dokumen ini berisi dua hal: (A) apa yang perlu Anda siapkan sebelum session build dimulai, dan (B) stack yang dipakai. Session build membaca `CLAUDE.md`, `PRD-REIN.md`, dan `design/rein-prototype.html` di folder ini.

---

## A. Checklist persiapan

### A1. WhatsApp (OpenWA)
- [ ] **Nomor baru** khusus REIN (SIM prabayar atau eSIM). Jangan pakai nomor pribadi atau nomor bisnis utama.
- [ ] Pasang WhatsApp (biasa atau Business) di HP cadangan dengan nomor itu. Isi nama profil **"REIN · Remula"** dan foto logo.
- [ ] **Pemanasan 1–2 minggu** sebelum go-live:
  - chat normal dua arah dengan 10–20 rekan kerja,
  - minta mereka **menyimpan nomor** dan **mengirim pesan duluan**,
  - jangan kirim pesan massal ke nomor yang belum pernah chat.
- [ ] Setelah server siap: hubungkan nomor ke OpenWA dengan **scan QR** di dashboard OpenWA. HP harus tetap hidup dan online sesekali agar sesi tidak putus.
- [ ] Jangan aktifkan passkey di akun WA nomor ini. Menurut README OpenWA, langkah passkey bisa memblokir proses linking.

> ⚠️ **Risiko yang perlu diterima.** OpenWA adalah gateway **tidak resmi**: memakai `whatsapp-web.js` atau `Baileys`, bukan WhatsApp Cloud API milik Meta. Nomornya tetap bisa dibatasi atau diblokir kapan saja. Karena itu REIN dirancang dengan dua pengaman:
> 1. **Email selalu jadi cadangan.** Notifikasi WA yang gagal dikirim ulang lewat email.
> 2. **Kanal WA bisa diganti tanpa mengubah logika aplikasi.** Kanal WA berada di balik adapter `WhatsAppProvider`. Jika nanti pindah ke Cloud API resmi, cukup ganti adapternya.

### A2. Google Cloud (login, email, storage, backup)
Di project Google Cloud Console yang sudah Anda punya:
- [ ] **Aktifkan API**: Gmail API, Cloud Storage. (Login Google tidak perlu API khusus.)
- [ ] **OAuth consent screen**: tipe *External*, isi nama "REIN", logo, email kontak, domain `remula.co.id`. Scope: `openid`, `email`, `profile`, dan `https://www.googleapis.com/auth/gmail.send`. Lalu **Publish app** (status *In production*).
  - Kenapa dipublish: pada status *Testing*, refresh token Gmail kedaluwarsa setiap 7 hari dan login dibatasi 100 test user.
  - Google mungkin menampilkan peringatan "unverified app" hanya saat akun pengirim memberi izin `gmail.send`. Itu wajar, karena hanya Anda yang melakukannya sekali.
- [ ] **OAuth Client ID** tipe *Web application*:
  - Authorized JavaScript origin: `https://rein.remula.co.id` (dan `http://localhost:5173` untuk dev)
  - Authorized redirect URI: `https://rein.remula.co.id/auth/google/callback` (dan `http://localhost:3000/auth/google/callback` untuk dev)
  - Simpan **Client ID** dan **Client Secret**.
- [ ] **Akun pengirim email**, mis. `notifikasi.rein@gmail.com` atau akun Workspace `notifikasi@remula.co.id`. Session build akan membuat skrip satu kali untuk mengambil **refresh token** `gmail.send` dari akun ini.
- [ ] **Bucket Cloud Storage** (region `asia-southeast2` Jakarta, *Uniform access*, *Public access prevention* ON):
  - `rein-attachments` — aktifkan **Object Versioning** dan soft delete 7 hari.
  - `rein-backup` — untuk dump database harian.
  - Nama bucket harus unik global; jika sudah dipakai orang lain, tambahkan akhiran (mis. `rein-attachments-remula`).
- [ ] **Service account** `rein-storage`, beri role **Storage Object Admin hanya di kedua bucket itu** (bukan di level project). Buat **key JSON** dan simpan aman. Key ini akan ditaruh di server sebagai secret, **jangan** dikirim lewat chat atau di-commit ke git.
- [ ] Opsional: aktifkan **billing alert** (mis. Rp100.000/bulan) agar biaya storage terpantau.

### A3. Server on-prem
- [ ] Spesifikasi minimum untuk REIN + OpenWA: **2 vCPU, 2 GB RAM kosong** (rekomendasi 4 GB), **40 GB disk**. Lampiran disimpan di Google Cloud Storage, jadi tidak perlu disk besar.
- [ ] Server dan HP karyawan harus bisa mengakses internet ke `*.googleapis.com` dan `accounts.google.com` (untuk login, email, dan membuka lampiran).
- [ ] Ubuntu 24.04 LTS, Docker, dan **Coolify** terpasang.
- [ ] **VPN WireGuard** (atau VPN kantor yang sudah ada) untuk akses dari HP lapangan.
- [ ] Domain internal, mis. `rein.remula.co.id` → IP privat server (DNS internal).
- [ ] Sertifikat HTTPS via **Let's Encrypt DNS-01**. Untuk ini perlu **API token DNS provider** domain `remula.co.id` (Cloudflare, dll.). HTTPS wajib, karena PWA dan service worker tidak jalan tanpa HTTPS.
- [ ] Backup database otomatis ke bucket `rein-backup`. NAS kantor opsional sebagai salinan kedua.

### A4. Repositori & laptop dev
- [x] Node 24, git, Docker, pnpm sudah terpasang di laptop ini.
- [ ] Repo **GitHub private** baru (mis. `remula/rein`). Session build akan `git init` di folder ini dan push ke repo tersebut.
- [ ] Jalankan `gh auth login` jika ingin session build bisa membuat PR.

### A5. Data awal (boleh menyusul, tapi sebaiknya ada sebelum UAT)
- [ ] Daftar karyawan dalam format CSV: `nama, username, email_google, nomor_wa, divisi`.
- [ ] Konfirmasi daftar role dan izin (PRD §2.4) dan jenis WO + kategori (PRD §4.2).
- [ ] 1–2 project nyata untuk pilot.

### A6. Keputusan yang perlu dijawab (dari PRD §14.2)
Paling tidak jawab ini sebelum M1 selesai:
1. Siapa yang boleh menandai project **Selesai**?
2. Format No RPO: baku (`RPO-YYYY-NNN`) atau bebas?
3. Produksi/QC memakai HP pribadi (BYOD) atau HP kantor?
4. Berapa lama data dan lampiran project Selesai disimpan?

---

## B. Stack yang direkomendasikan

Target: ringan di server bersama, ringan di HP dengan koneksi lambat, dan animasinya sama dengan prototype.

| Lapisan | Pilihan | Alasan |
|---|---|---|
| UI | **Svelte 5 + SvelteKit** (mode SPA, `adapter-static`) | Bundle sangat kecil (target JS awal ≤ 100 KB gzip). Animasi prototype tersedia **bawaan** tanpa library: `animate:flip` untuk kartu Kanban, `transition:fly/fade/scale` untuk modal/toast/sheet, `tweened` untuk count-up dan progres. |
| Styling | **CSS murni + CSS variables** dari token Figma (`--color-*`, `--c-eng` dst.) | Tanpa Tailwind atau UI kit. Light/dark cukup lewat `data-theme`. Efek ganti tema memakai View Transitions API, sama seperti prototype. |
| Chart | **SVG manual** (S-Curve, Timeline) | Tanpa library chart. Logika sudah ada di prototype. |
| API | **Node 22 + Hono** (REST + SSE) | Ringan (±60–120 MB), satu proses melayani API **dan** file SPA. |
| Database | **PostgreSQL 16** | Satu instance dipakai bersama: database `rein` dan database `openwa`. OpenWA mendukung Postgres via `DATABASE_TYPE`. |
| ORM | **Drizzle** + drizzle-kit | Tipe kuat, query S-Curve tetap SQL. |
| Job/antrean | **pg-boss** (antrean di Postgres) | Tanpa Redis. Dipakai untuk retry notifikasi, batching 15 menit, dan job harian 07:00. |
| Gambar | Kompresi **di klien** (canvas → WebP, sudah ada di prototype); klien juga membuat thumbnail 320 px. `sharp` di server hanya cadangan | Unggahan dari lapangan tetap kecil, server tidak terbebani. |
| Lampiran & foto | **Google Cloud Storage** (`@google-cloud/storage`), bucket privat Jakarta; maks **50 MB per file**; dibuka lewat Signed URL | Tidak memakan disk server, tahan lama, backup praktis. |
| Login | Email/username + password, PIN per perangkat, dan **Masuk dengan Google** (OIDC + PKCE) | Karyawan sudah punya akun Google. |
| Validasi | **Zod**, dipakai bersama frontend dan backend | Satu sumber skema. |
| PWA | Service worker (`@vite-pwa/sveltekit` atau tulis sendiri) + IndexedDB outbox | Mendukung offline dan sinkron ulang. |
| WA | **OpenWA** (container terpisah), engine **`baileys`** | Baileys ±30–80 MB per sesi; `whatsapp-web.js` butuh Chromium (±300–500 MB). |
| Email | **Gmail API** (`gmail.send`) dari akun pengirim khusus; SMTP hanya cadangan | Memakai project Google Cloud yang sudah ada. |
| Test | Vitest, Playwright (6 alur Prototype Figma), k6 | — |

### Container di server (3 service)
```text
rein-app   Node 22 (Hono + SPA statis + worker pg-boss)   ~150–250 MB
postgres   PostgreSQL 16 (db: rein, openwa)              ~250–400 MB
openwa     OpenWA, ENGINE_TYPE=baileys, tanpa Redis       ~150–250 MB
                                                  total ≈ 0,6–0,9 GB
```
- OpenWA **tidak diekspos** keluar jaringan Docker. Hanya `rein-app` yang memanggil `http://openwa:2785` dengan header `X-API-Key`.
- Dashboard OpenWA cukup dibuka lewat VPN saat scan QR.
- Webhook OpenWA → `rein-app` di jaringan internal, diverifikasi dengan HMAC `secret`.

### Cara REIN memakai OpenWA
- Kirim pesan: `POST /api/sessions/{sessionId}/messages/send-text` dengan `chatId` = `628xxxxxxxxxx@c.us` dan `text`.
- Gateway tidak resmi tidak punya tombol, jadi **tautan ditulis di teks**: `Buka WO: https://rein.remula.co.id/w/8F3K2`. Template pesan di PRD §6.3 dipakai sebagai teks biasa.
- Aktifkan `SEND_PACING_ENABLED=true`. Batas REIN tetap berlaku: maksimal 20 WA per user per hari, batching 15 menit, dan jam tenang.
- **Verifikasi nomor WA (revisi 16 November 2026):** bot mengirim OTP 6 digit ke nomor yang dimasukkan pengguna. Pengguna mengisi OTP di aplikasi; webhook pesan masuk tidak memverifikasi nomor. Berlaku 10 menit, jeda kirim ulang 60 detik, maksimal 5 kode per akun/nomor per hari dan 5 kode salah per tantangan. PIN setelahnya opsional; nama panggilan dan foto profil menyelesaikan onboarding. Email dihubungkan dari Profil setelah masuk.
- Status sesi: webhook `session.status` → jika terputus, notifikasi email ke Admin dan semua WA dialihkan ke email sampai tersambung lagi.

---

## C. Cara memulai session build

1. Buka session baru di folder `D:\006 Restard\Rein v2`.
2. Tempel isi file [PROMPT-SESI-BARU.md](PROMPT-SESI-BARU.md).
3. Setelah M0 selesai, lanjutkan dengan prompt `Lanjut M1 sesuai PRD §12`.
