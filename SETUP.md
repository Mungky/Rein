# REIN — Panduan Deploy Production

## Arsitektur

```
Browser → domain.com          → Vercel (Next.js frontend)
Browser → domain.com/api/*    → Vercel rewrite → VPS:8000 (FastAPI backend)
```

---

## Langkah 1 — Push ke GitHub

```bash
git init        # jika belum
git add .
git commit -m "initial"
git remote add origin https://github.com/USERNAME/REPO.git
git push -u origin main
```

---

## Langkah 2 — Deploy Frontend ke Vercel

1. Buka [vercel.com](https://vercel.com) → New Project → Import dari GitHub
2. Set **Root Directory**: `frontend`
3. Set **Environment Variables** di Vercel dashboard:

| Key | Value |
|-----|-------|
| `NEXT_PUBLIC_SUPABASE_URL` | `https://xxx.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `eyJ...` |
| `NEXT_PUBLIC_API_URL` | `https://domain.com` ← domain kamu |
| `BACKEND_URL` | `http://VPS_IP:8000` ← IP VPS, port 8000 |

4. Deploy → Vercel akan otomatis build
5. Buka **Settings → Domains** → tambahkan domain kamu

> `BACKEND_URL` adalah server-side only (tidak ada `NEXT_PUBLIC_`), jadi tidak terekspos ke browser.

---

## Langkah 3 — Setup VPS

### 3a. SSH ke VPS

```bash
ssh ubuntu@VPS_IP
```

### 3b. Jalankan setup script

```bash
# Di VPS:
curl -o setup.sh https://raw.githubusercontent.com/USERNAME/REPO/main/deploy/setup-vps.sh
# ATAU setelah git clone:
bash /opt/rein/deploy/setup-vps.sh
```

Script ini otomatis:
- Install Python 3.11 + dependencies
- Clone repo ke `/opt/rein`
- Setup virtual environment
- Run database migrations
- Install systemd service (`rein-backend`)

### 3c. Edit `.env` di VPS

```bash
nano /opt/rein/.env
```

Nilai penting untuk production:

```env
# Supabase
NEXT_PUBLIC_SUPABASE_URL=https://xxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJ...
SUPABASE_JWT_SECRET=...
DATABASE_URL=postgresql+asyncpg://postgres.REF:PASS@aws-0-region.pooler.supabase.com:6543/postgres

# CORS — izinkan domain frontend
CORS_ORIGINS=https://domain.com

# Google Drive & Sheets (ID sudah diset, tidak perlu ganti)
GOOGLE_DRIVE_ROOT_FOLDER_ID=1rsATPU5-JkOvNXqolzej0BgUFXAb4VHh
GOOGLE_SHEETS_SPREADSHEET_ID=1oZjkzGInjL6a5LxfmD8a8DydpHOb-yeXWom2TfGsBlk
GOOGLE_SHEETS_PUBLIC_SPREADSHEET_ID=1gBr1lbQNRo-HpFD7evJNL88nbvu8ecyhiFMTmCrMehc

# Ollama (jika di VPS yang sama)
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_MODEL=glm-5.1:cloud
```

### 3d. Upload Google credentials ke VPS

Di komputer lokal (yang sudah pernah menjalankan OAuth):

```bash
# Upload credentials.json dan token.json ke VPS
scp backend/credentials/credentials.json ubuntu@VPS_IP:/opt/rein/backend/credentials/
scp backend/credentials/token.json ubuntu@VPS_IP:/opt/rein/backend/credentials/
```

### 3e. Buka port 8000 di firewall

```bash
sudo ufw allow 8000
sudo ufw status
```

### 3f. Cek backend berjalan

```bash
sudo systemctl status rein-backend
curl http://localhost:8000/api/health
```

---

## Langkah 4 — Supabase: Allow domain production

1. Buka Supabase dashboard → **Authentication → URL Configuration**
2. Tambahkan di **Site URL**: `https://domain.com`
3. Tambahkan di **Redirect URLs**: `https://domain.com/**`

---

## Update Backend (deploy ulang)

```bash
ssh ubuntu@VPS_IP
cd /opt/rein
git pull
venv/bin/pip install -r backend/requirements.txt   # jika ada package baru
PYTHONPATH=/opt/rein venv/bin/python -m alembic -c db/alembic.ini upgrade head  # jika ada migrasi baru
sudo systemctl restart rein-backend
```

---

## Logs & Troubleshooting

```bash
# Backend logs realtime
sudo journalctl -u rein-backend -f

# Restart backend
sudo systemctl restart rein-backend

# Cek backend health
curl http://localhost:8000/api/health
```

### Error: Google token expired / invalid
```bash
# Hapus token lama, generate ulang di lokal, lalu upload lagi
rm /opt/rein/backend/credentials/token.json
# Jalankan backend sekali di lokal untuk OAuth flow
# Lalu upload token.json baru ke VPS
```

### Error: CORS blocked
- Cek `CORS_ORIGINS` di `.env` sudah berisi domain Vercel
- Restart: `sudo systemctl restart rein-backend`
