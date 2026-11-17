# REIN

Aplikasi web internal PT Remula Inti Rekayasa untuk melacak project dari PO diterima sampai Selesai
(ditentukan manual oleh pengguna berizin). Hierarki: Project → Work Order → Logbook → Lampiran.

Sumber kebenaran: [`PRD-REIN.md`](PRD-REIN.md), [`BUILD-KICKOFF.md`](BUILD-KICKOFF.md),
[`design/rein-prototype.html`](design/rein-prototype.html), dan [`AGENTS.md`](AGENTS.md).

## Struktur

```text
apps/web            SvelteKit SPA (Svelte 5, adapter-static)
apps/server         Node 22 + Hono — API, auth, menyajikan hasil build SPA
packages/shared     Zod schema, enum, kunci & matriks izin, can()
packages/ui-tokens  CSS variables light/dark + warna kategori
docker-compose.yml  deployment produksi Coolify
infra/              Compose dev, init PostgreSQL, template environment
```

## Menjalankan di lokal

Prasyarat: Node ≥ 22.12, pnpm 10, Docker Desktop.

```bash
cp .env.example .env          # isi nilai yang diperlukan
pnpm infra:up                 # = docker compose -f infra/docker-compose.dev.yml --env-file .env up -d
pnpm install
pnpm db:migrate && pnpm db:seed
pnpm dev                      # web: http://localhost:5173 · API: http://localhost:3000
```

Komponen UI: buka `http://localhost:5173/dev/komponen`.

## Perintah

| Perintah            | Fungsi                                                 |
| ------------------- | ------------------------------------------------------ |
| `pnpm dev`          | Web (Vite) + server (`node --watch` + tsx)             |
| `pnpm build`        | Build SPA lalu server                                  |
| `pnpm test`         | Vitest semua paket (test DB butuh `DATABASE_URL_TEST`) |
| `pnpm lint`         | ESLint + Prettier                                      |
| `pnpm typecheck`    | `tsc` / `svelte-check`                                 |
| `pnpm check:bundle` | Cek budget JS awal ≤ 100 KB gzip, CSS ≤ 20 KB gzip     |
| `pnpm db:generate`  | Buat migrasi dari schema Drizzle                       |
| `pnpm db:migrate`   | Jalankan migrasi                                       |
| `pnpm db:seed`      | Seed role & izin default (PRD §2.4) dan 1 Admin (env)  |
| `pnpm gmail:token`  | Skrip satu kali: ambil refresh token `gmail.send`      |
| `pnpm infra:up`     | Postgres + OpenWA dev (butuh `.env`)                   |

Tanpa Google Cloud, dev memakai `MAIL_PROVIDER=null` (email ditulis ke log server, termasuk
tautan aktivasi/verifikasi) dan `STORAGE_DRIVER=local` (`.data/storage`).

## Produksi (Coolify)

Panduan lengkap: **[Self-host staff.remula.online](docs/SELFHOST-COOLIFY.md)**.
Deployment ini memakai database baru. Aplikasi lama disimpan untuk rollback.
Template environment: [infra/coolify.env.example](infra/coolify.env.example).

```bash
docker build -t rein .                          # image non-root, API + SPA dalam satu proses
# Isi environment produksi sebelum menjalankan Compose.
docker compose --env-file .env up -d
docker compose --env-file .env exec app node dist/seed-cli.js
```

Migrasi berjalan otomatis saat app start. Health check: `/healthz` (DB ping) dan `/readyz`.
Di Coolify: branch `main`, Base Directory `/`, Docker Compose Location `/docker-compose.yml`.
Lampiran dan foto memakai volume permanen `app-uploads` di server, bukan Google Cloud.
Email ditunda (`MAIL_PROVIDER=null`); Google/Gmail tidak perlu diisi. Domain diarahkan ke
service `app` port internal `3000`; PostgreSQL dan OpenWA tetap privat.

## Role dan akses

- **Admin → Pengguna → Akses & notifikasi**: atur kanal dan pengecualian izin khusus satu pengguna. Pilihan **Ikuti role** mewarisi izin role; **Tidak diizinkan** menolak izin untuk pengguna tersebut. Mengganti role tetap mempertahankan pengecualian pribadi sampai direset.
- Email dan WhatsApp pada undangan opsional. Salin tautan aktivasi untuk dibagikan langsung; pengguna menghubungkan kontak dan memilih kanal melalui **Profil → Kontak & notifikasi** atau halaman verifikasi. Pengiriman hanya ke kontak terverifikasi; email tetap menunggu layanan Gmail aktif.
- Role bawaan selain Admin dapat dihapus bila tidak dipakai pengguna, dan tidak dipulihkan otomatis saat startup/seed.

- Desktop: **Admin → Role & izin**. Mobile: **Profil → Admin → Role & izin**.
- Pilih role, tentukan cakupan izin, lalu **Simpan izin**. Izin membuat project bernama **Membuat project**.
- Admin bawaan tidak memiliki izin membuat project. Aktifkan izin tersebut untuk role yang bertugas mengelola project; lalu buka **Project → Buat project**.
- **Admin → Pengguna → Ubah role** untuk mengganti role pengguna lain. Role akun sendiri diubah oleh Admin lain agar akses administrasi tetap terjaga.
- Foto/logo dan banner bisa dipilih pada form **Buat project**, lalu diganti/dihapus melalui **detail project → Foto & banner**. Pengaturannya memakai izin **Edit info, foto/logo, banner & status project** (`project.edit`, cakupan semua atau project yang dikelola).
- `pnpm db:seed` menambah 13 role organisasi: empat role pimpinan mengikuti Manager, role lainnya mengikuti pelaksana. Role dan izin yang sudah ada tidak ditimpa. Finance dan Accounting tetap tanpa fitur keuangan.

## Secret

Secret hanya di `.env` atau Environment Variables Coolify (tidak di-commit).
Integrasi GCS bersifat opsional; jika diaktifkan kelak, key JSON disimpan di
`secrets/gcs-key.json` (di-ignore git). Lihat `.env.example` untuk daftar variabel.
