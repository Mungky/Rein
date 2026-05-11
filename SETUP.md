# REIN — Panduan Deploy Production

## Arsitektur

```
Browser → domain.com        → Vercel  (Next.js frontend)
Browser → api.domain.com/*  → Coolify di VPS (FastAPI backend)
```

---

## Persiapan Sebelum Deploy

### 1. Pastikan sudah push ke GitHub
```bash
git add .
git commit -m "ready for deploy"
git push origin main
```

### 2. Siapkan Google Token untuk cloud
Token Google tidak bisa berupa file di server. Jalankan di lokal:
```bash
cat backend/credentials/token.json
```
Copy seluruh isi JSON-nya — akan dipakai sebagai env var `GOOGLE_TOKEN_JSON`.

---

## Deploy Backend — Coolify di VPS

### Step 1 — Buat aplikasi baru di Coolify

1. Buka Coolify dashboard → **New Resource** → **Application**
2. Pilih **GitHub** → pilih repo **Rein**
3. Build pack: pilih **Dockerfile** (bukan Nixpacks)
4. Dockerfile location: `/Dockerfile` (sudah ada di root repo)
5. Port: `8000`

### Step 2 — Set domain di Coolify

1. Di tab **Domains**: isi `api.domain.com` (ganti dengan domain kamu)
2. Aktifkan **HTTPS** (Coolify otomatis pakai Let's Encrypt)

### Step 3 — Set Environment Variables di Coolify

Masuk tab **Environment Variables**, tambahkan satu per satu:

```env
NEXT_PUBLIC_SUPABASE_URL=https://xxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_ROLE_KEY=eyJ...
SUPABASE_JWT_SECRET=...
DATABASE_URL=postgresql+asyncpg://postgres.REF:PASS@aws-0-region.pooler.supabase.com:6543/postgres

CORS_ORIGINS=https://domain.com

GOOGLE_TOKEN_JSON={"token":"...","refresh_token":"...","token_uri":"..."}
GOOGLE_DRIVE_ROOT_FOLDER_ID=1rsATPU5-JkOvNXqolzej0BgUFXAb4VHh
GOOGLE_SHEETS_SPREADSHEET_ID=1oZjkzGInjL6a5LxfmD8a8DydpHOb-yeXWom2TfGsBlk
GOOGLE_SHEETS_PUBLIC_SPREADSHEET_ID=1gBr1lbQNRo-HpFD7evJNL88nbvu8ecyhiFMTmCrMehc

OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_MODEL=glm-5.1:cloud
OLLAMA_API_KEY=

ADMIN_USERNAME=admin
ADMIN_PASSWORD=ganti_ini
ADMIN_FULL_NAME=Administrator

API_SECRET_KEY=ganti_dengan_string_random_panjang
```

> **GOOGLE_TOKEN_JSON**: isi dengan seluruh isi `token.json` dalam satu baris.
> Di terminal lokal: `cat backend/credentials/token.json | tr -d '\n'`

### Step 4 — Deploy

Klik **Deploy** di Coolify. Tunggu build selesai (~2-3 menit).

Cek di browser: `https://api.domain.com/api/health`
Harus return: `{"status":"ok","version":"0.1.0"}`

### Step 5 — Jalankan Database Migration

Di Coolify → tab **Terminal** (atau **Execute Command**):
```bash
cd /app && python -m alembic -c db/alembic.ini upgrade head
```

Atau jika tidak ada fitur terminal, masuk ke VPS via SSH:
```bash
ssh ubuntu@VPS_IP
docker ps   # cari container REIN
docker exec -it CONTAINER_ID bash
cd /app && python -m alembic -c db/alembic.ini upgrade head
```

---

## Deploy Frontend — Vercel

### Step 1 — Import project

1. Buka [vercel.com](https://vercel.com) → **New Project** → Import dari GitHub repo **Rein**
2. **Root Directory**: `frontend`
3. Framework: Next.js (otomatis terdeteksi)

### Step 2 — Set Environment Variables di Vercel

| Key | Value |
|-----|-------|
| `NEXT_PUBLIC_SUPABASE_URL` | `https://xxx.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `eyJ...` |
| `NEXT_PUBLIC_API_URL` | `https://api.domain.com` ← URL backend dari Coolify |

> Tidak perlu `BACKEND_URL` karena kita pakai subdomain terpisah, bukan rewrite.

### Step 3 — Deploy & set domain

1. Klik **Deploy**
2. Setelah selesai: **Settings → Domains** → tambahkan `domain.com`

---

## Supabase — Tambahkan Domain Production

1. Supabase dashboard → **Authentication → URL Configuration**
2. **Site URL**: `https://domain.com`
3. **Redirect URLs**: tambahkan `https://domain.com/**`

---

## Update Setelah Ada Perubahan Kode

```bash
git add .
git commit -m "update: ..."
git push origin main
```

- **Vercel** → otomatis redeploy frontend
- **Coolify** → otomatis redeploy backend (jika auto-deploy aktif)

Untuk jalankan migration baru:
```bash
docker exec -it CONTAINER_ID bash
cd /app && python -m alembic -c db/alembic.ini upgrade head
```

---

## Troubleshooting

### Backend tidak bisa start
```bash
# Lihat logs di Coolify → Logs tab
# Atau dari VPS:
docker logs CONTAINER_ID --tail 100
```

### Google token error
```bash
# Di lokal, refresh token:
bun run dev:backend   # jalankan sebentar lalu stop
# Update env var GOOGLE_TOKEN_JSON di Coolify dengan isi token.json baru:
cat backend/credentials/token.json | tr -d '\n'
# Paste ke Coolify → Environment Variables → GOOGLE_TOKEN_JSON → Redeploy
```

### CORS error di browser
- Pastikan `CORS_ORIGINS` di Coolify = `https://domain.com` (tanpa trailing slash)
- Redeploy setelah update env var

### Migration gagal
```bash
# Cek DATABASE_URL sudah benar (pakai port 6543 untuk Supabase pooler)
# Cek Supabase → Settings → Database → Connection string
```
