# REIN

Aplikasi web internal PT Remula Inti Rekayasa untuk melacak project dari PO diterima sampai Selesai
(punch list habis, serah terima, BAST). Hierarki: Project → Work Order → Logbook → Lampiran.

Sumber kebenaran: [`PRD-REIN.md`](PRD-REIN.md), [`BUILD-KICKOFF.md`](BUILD-KICKOFF.md),
[`design/rein-prototype.html`](design/rein-prototype.html), dan [`CLAUDE.md`](CLAUDE.md).

## Struktur

```text
apps/web            SvelteKit SPA (Svelte 5, adapter-static)
apps/server         Node 22 + Hono — API, auth, menyajikan hasil build SPA
packages/shared     Zod schema, enum, kunci & matriks izin, can()
packages/ui-tokens  CSS variables light/dark + warna kategori
infra/              docker-compose (dev & produksi)
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

```bash
docker build -t rein .                          # image non-root, API + SPA dalam satu proses
docker compose -f infra/docker-compose.yml up -d # app + postgres 16 + OpenWA (tanpa port publik)
```

Migrasi berjalan otomatis saat app start. Health check: `/healthz` (DB ping) dan `/readyz`.
Isi semua variabel `${…}` di Coolify; letakkan key GCS di `secrets/gcs-key.json` di server.

## Secret

Secret hanya di `.env` (tidak di-commit). Key JSON service account GCS disimpan di
`secrets/gcs-key.json` (di-ignore git). Lihat `.env.example` untuk daftar variabel.
