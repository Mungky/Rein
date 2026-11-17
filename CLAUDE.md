# REIN — instruksi untuk agent

Aplikasi web internal PT Remula Inti Rekayasa untuk melacak project dari PO diterima sampai Selesai (punch list habis, serah terima, BAST). Hierarki: Project → Work Order (WO) → Logbook → Lampiran.

## Sumber kebenaran (baca sebelum menulis kode)
1. `PRD-REIN.md` — requirement (FR/NFR), model data, izin, notifikasi, S-Curve, milestone. Jika ada konflik, PRD menang.
2. `BUILD-KICKOFF.md` — stack final, topologi container, integrasi OpenWA.
3. `design/rein-prototype.html` — prototype interaktif. **Acuan visual dan animasi**: token warna light/dark, ikon SVG, komponen, durasi/easing, logika S-Curve, kompresi foto di klien. Tiru perilakunya, jangan disalin mentah.
4. Figma "REIN — UI/UX": https://www.figma.com/design/m6TD7AHjnmgljGiPNT00f7 — frame `D/xx` (desktop 1440), `M/xx` (mobile 390), halaman Dark dan Prototype.

## Aturan produk yang tidak boleh dilanggar
- **Tidak ada fitur keuangan.** Tidak ada invoice, nominal, harga, atau status pembayaran. Kolom bernama `*price*|*amount*|*nominal*|*invoice*|*payment*` dilarang.
- Project **tidak punya tahapan**. Status hanya `active | on_hold | done` (Berjalan/Ditunda/Selesai). Proses paralel = **6 kategori jenis WO** berwarna: Engineering, Pengadaan, Produksi, QC & Testing, Pengiriman & Serah Terima, Umum.
- Warna minim: netral + aksen biru. Merah hanya untuk Urgent, terlambat, dan Butuh bantuan. Hijau hanya untuk Selesai. Warna kategori hanya sebagai titik/garis/bar (PRD §9.9).
- Izin selalu dicek di server (`can(user, permission, resource)`). Setiap baris matriks PRD §2.4 wajib punya unit test.
- Teks UI dalam Bahasa Indonesia. Istilah teknis (Kanban, Timeline, S-Curve, Logbook, PIN, OTP) tetap Inggris.

## Stack (jangan diganti tanpa persetujuan user)
- Monorepo **pnpm**: `apps/web` (Svelte 5 + SvelteKit SPA, `adapter-static`), `apps/server` (Node 22 + Hono, menyajikan API + SPA), `packages/shared` (Zod, enum, izin), `packages/ui-tokens` (CSS variables dari prototype/Figma).
- PostgreSQL 16 + Drizzle; pg-boss untuk job; SSE untuk realtime.
- **Google Cloud**: lampiran & foto di **GCS** (`StorageDriver`: `GcsDriver` default, `LocalDriver` untuk dev/test), dibuka lewat Signed URL yang dibulatkan per hari; email via **Gmail API** (`MailProvider`: `GmailApiProvider`, `SmtpProvider` cadangan, `NullProvider` dev); **Login dengan Google** (OIDC + PKCE, hanya akun terdaftar). Batas lampiran **50 MB per file**.
- Kompresi foto + thumbnail dibuat di klien; `sharp` di server hanya cadangan.
- Tanpa Tailwind, UI kit, library chart, Redux, atau moment. Animasi memakai bawaan Svelte (`animate:flip`, `transition:*`, `tweened`) dan CSS. Hormati `prefers-reduced-motion`.
- WhatsApp lewat **OpenWA** (engine `baileys`) di balik interface `WhatsAppProvider`; implementasi `OpenWAProvider` + `NullProvider` (dev/test). Email adalah fallback wajib.

## Budget performa (cek di CI)
JS awal ≤ 100 KB gzip, CSS ≤ 20 KB, TTI Slow 4G ≤ 3,5 s, API p95 daftar ≤ 300 ms. Lihat PRD §9.1.

## Cara kerja
- Ikuti milestone PRD §12 berurutan (M0 → M1 → M2 → M3). Buat rencana singkat per milestone, kerjakan bertahap, commit kecil dengan pesan Conventional Commits.
- Setiap fitur selesai jika: AC terpenuhi + test, tampilan cocok dengan frame Figma di 390 px & 1440 px, izin dicek di server, event audit tercatat.
- Secret hanya di `.env` (tidak di-commit). Sediakan `.env.example`.
- Dev lokal: `docker compose -f infra/docker-compose.dev.yml up` untuk postgres + openwa; app dijalankan dengan `pnpm dev`.
- OpenWA tidak boleh diekspos ke publik. Panggil `http://openwa:2785` dengan header `X-API-Key`; webhook diverifikasi HMAC.
