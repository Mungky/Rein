Kita mulai membangun REIN. Baca dulu, berurutan: `CLAUDE.md`, `PRD-REIN.md` (terutama revisi 1.1–1.4 di bagian atas, §2.4, §4, §5, §7, §9, §10, §12), `BUILD-KICKOFF.md`, lalu buka `design/rein-prototype.html` sebagai acuan tampilan dan animasi. Figma: https://www.figma.com/design/m6TD7AHjnmgljGiPNT00f7.

Tugas sesi ini: **Milestone M0 — Fondasi** (PRD §12). Buat rencana singkat dulu dan tunjukkan ke saya. Setelah saya setujui, kerjakan bertahap dan commit tiap langkah (Conventional Commits).

Lingkup M0:
1. **Repo**: `git init` di folder ini, `.gitignore` (node_modules, .env*, *.json key, build), README singkat. Remote GitHub akan saya berikan; jangan push sebelum saya kirim URL-nya.
2. **Monorepo pnpm**:
   - `apps/web`: Svelte 5 + SvelteKit SPA (`adapter-static`)
   - `apps/server`: Node 22 + Hono, menyajikan API + hasil build SPA
   - `packages/shared`: Zod schema, enum status/kategori, kunci izin
   - `packages/ui-tokens`: CSS variables light/dark + 6 warna kategori dari prototype
   - TypeScript strict, ESLint + Prettier, Vitest.
3. **Infra dev** `infra/docker-compose.dev.yml`:
   - `postgres:16` dengan dua database: `rein` dan `openwa`
   - `openwa` (https://github.com/rmyndharis/OpenWA) dengan `ENGINE_TYPE=baileys`, `DATABASE_TYPE=postgres`, `SEND_PACING_ENABLED=true`, tanpa Redis, port 2785 hanya untuk localhost
   - Cek README OpenWA terbaru untuk nama image/env var yang tepat; jangan menebak.
   - Lalu `.env.example` lengkap sesuai PRD §11.2 langkah 6.
4. **Database**: Drizzle + migrasi awal untuk `users`, `user_contacts`, `verification_codes`, `devices`, `sessions`, `roles`, `role_permissions`, `audit_logs` (PRD §4.2), plus seed role & izin default (PRD §2.4) dan 1 user Admin.
5. **Komponen UI dasar** sesuai Figma/prototype:
   - Komponen: Button, Input, Status Badge (ikon SVG animasi), Flag Badge, Tag (titik warna kategori), Avatar, Kbd, Checkbox, Toggle, Progress, Toast, Modal/Bottom Sheet, Sidebar, Bottom Nav, Mobile App Bar, Command Palette (shell).
   - Tema light/dark dengan efek reveal View Transitions.
   - Halaman `/dev/komponen` untuk melihat semuanya di 390 px dan 1440 px.
6. **Auth tahap 1**:
   - Login email/username + password (argon2id, rate limit, lockout), sesi cookie HttpOnly
   - Undangan user oleh Admin + aktivasi + verifikasi email
   - **Masuk dengan Google** (OIDC + PKCE, hanya akun terdaftar, FR-006)
   - Kirim email lewat `MailProvider` (`GmailApiProvider` + `NullProvider` untuk dev), template email sederhana
   - Buat skrip satu kali `pnpm gmail:token` untuk mengambil refresh token `gmail.send` dari akun pengirim.
7. **Izin**: fungsi `can(user, permission, resource)` di server + **unit test untuk setiap baris matriks PRD §2.4**.
8. **StorageDriver**:
   - Interface + `LocalDriver` (dev) + `GcsDriver` (bucket privat, Signed URL V4 yang dibulatkan per hari)
   - Endpoint upload dengan batas **50 MB per file** dan validasi magic bytes
   - Upload foto profil 256×256 WebP (dikompres di klien) sebagai uji pertama.
9. **CI** (GitHub Actions): lint, typecheck, test, build, cek ukuran bundle JS awal ≤ 100 KB gzip.

Aturan:
- **Secret**: jangan minta saya menempel Client Secret, refresh token, API key, atau key JSON di chat. Siapkan `.env.example` dan beri tahu nama variabelnya; saya isi sendiri di `.env` lokal. Key JSON service account saya taruh di `secrets/gcs-key.json` (masuk `.gitignore`).
- Jangan menambah fitur di luar PRD. Jika PRD ambigu, catat sebagai asumsi lalu lanjutkan, atau tanya bila berdampak besar.
- Akhir M0: tunjukkan cara menjalankan (`docker compose … up`, `pnpm dev`), hasil test, ukuran bundle, dan daftar yang belum selesai.
