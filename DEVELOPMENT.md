# REIN — Panduan Pengembangan Lokal

> **Aturan emas:** kode di-test lokal dulu. Push ke GitHub hanya di **window maintenance 12–4 sore**, karena push = auto-deploy ke karyawan (Vercel + Coolify).

---

## TL;DR — Daily flow

```bash
# 1. Sync dulu kalau habis pulang/lain hari
cd "D:\006 Restard\Rein v1"
git pull origin main

# 2. Jalankan dev server (frontend + backend bareng)
npm run dev
# → frontend: http://localhost:3000
# → backend:  http://localhost:8000

# 3. Edit kode di VS Code / Cursor / editor pilihan

# 4. Lihat hasilnya di browser: http://localhost:3000
#    Hot-reload otomatis (frontend) + auto-restart (backend)

# 5. Sebelum push → cek dulu (lihat bagian "Sebelum push")
```

---

## Prerequisites — cek satu kali

Komputer Anda **sudah punya semuanya**, ini cuma verifikasi:

```bash
python --version   # Harus 3.11 atau lebih baru (Anda punya 3.14.2 ✓)
node --version     # Harus 18+ (Anda punya v24 ✓)
bun --version      # Untuk install frontend dependencies (Anda punya 1.3 ✓)
git --version      # ✓
```

Kalau salah satu hilang, install dari:
- Python: https://www.python.org/downloads/
- Node: https://nodejs.org/ (versi LTS)
- Bun: `npm install -g bun` atau `iwr bun.sh/install.ps1 -useb | iex` di PowerShell

---

## Setup awal — sekali saja per komputer

> Anda sudah punya semua ini di komputer sekarang. Bagian ini cuma kalau Anda pindah laptop atau install ulang.

### 1. Clone repo

```bash
git clone https://github.com/Mungky/Rein.git "D:\006 Restard\Rein v1"
cd "D:\006 Restard\Rein v1"
```

### 2. Install dependencies

```bash
# Frontend (sekali, atau kalau ada update package.json)
cd frontend
bun install
cd ..

# Backend (sekali, atau kalau ada update requirements.txt)
pip install -r backend/requirements.txt
```

### 3. Copy file rahasia (`.env` + Google credentials)

File berikut **tidak ada di GitHub** (gitignored, sengaja):

- `.env` → di root repo
- `backend/credentials/credentials.json` → OAuth client
- `backend/credentials/token.json` → token Google Anda

Copy dari komputer lama via flashdisk, atau download ulang dari:
- Supabase Dashboard → Settings → API (untuk SUPABASE_*)
- Google Cloud Console → Credentials (untuk credentials.json)
- Untuk `token.json` baru: jalankan `python backend/auth_google.py` (kalau ada) atau follow OAuth flow

---

## Workflow harian — saat mau ngembangin fitur

### Step 1 — Sync latest dari GitHub

```bash
cd "D:\006 Restard\Rein v1"
git status              # Pastikan working tree bersih
git pull origin main    # Ambil perubahan terbaru
```

### Step 2 — Jalankan dev server

**Cara mudah** (frontend + backend bareng di satu terminal):
```bash
npm run dev
```

**Atau dua terminal terpisah** (kalau mau lihat log terpisah):
```bash
# Terminal 1 — backend
cd "D:\006 Restard\Rein v1\backend"
uvicorn app.main:app --reload --port 8000

# Terminal 2 — frontend
cd "D:\006 Restard\Rein v1\frontend"
bun run dev
```

**Tunggu sampai muncul:**
- Backend: `INFO:     Uvicorn running on http://0.0.0.0:8000`
- Frontend: `▲ Next.js 16.x.x  Local: http://localhost:3000`

### Step 3 — Buka browser

http://localhost:3000

Login pakai admin / `G@nteng02` (dari `.env`). Ini **DB produksi yang sama** — jadi user Anda sudah ada, dokumen Anda sudah ada, dst.

### Step 4 — Edit kode

- Frontend: edit file di `frontend/src/...` → browser auto-refresh ~1 detik
- Backend: edit file di `backend/app/...` → uvicorn auto-restart ~2 detik
- Edit `db/models/` ATAU `db/alembic/`: butuh `npm run migrate:up` (lihat di bawah)

### Step 5 — Test fungsionalnya

Buka browser, klik-klik fitur yang baru diubah. Coba:
- Happy path (skenario normal)
- Edge cases (input kosong, file besar, role berbeda)
- Mobile view: F12 → ikon HP → pilih iPhone/Android

---

## ⚠️ Catatan PENTING — shared production data

Karena `.env` lokal Anda pakai **Supabase produksi + Drive produksi**, ini artinya:

| Hal | Status |
|---|---|
| File yang Anda upload di localhost:3000 | **MASUK ke Drive produksi & DB produksi** |
| User yang Anda buat di localhost | **Beneran ada** di sistem produksi |
| Perubahan permission yang Anda lakukan | **Berlaku ke semua karyawan** seketika |
| Migrasi DB (`alembic upgrade head`) | **Mengubah skema produksi** |

**Untuk testing aman:**
- Upload file dengan prefix `TEST-` atau `DIAG-` supaya gampang dibersihin
- Pakai folder uji yang sudah disiapkan (atau buat folder "Sandbox" sekali)
- **Jangan** edit role/permission karyawan beneran untuk eksperimen
- **Jangan** apply migrasi DB destruktif (DROP, RENAME) di luar maintenance window

**Cara lebih aman ke depan (kalau mau):** bikin Supabase project kedua khusus dev. Tapi itu effort besar — kalau sekarang masih solo testing, hati-hati aja sudah cukup.

---

## Sebelum push — checklist

Setelah test manual oke, jalankan ini **sebelum** commit:

```bash
# 1. Frontend type-check (catch typo TypeScript)
cd "D:\006 Restard\Rein v1\frontend"
bunx tsc --noEmit
# Harus exit code 0 (kalau ada error, perbaiki dulu)

# 2. Frontend build (catch error yang cuma muncul di production build)
bun run build
# Harus selesai tanpa error

# 3. Backend syntax check
cd ..
python -c "import ast; ast.parse(open('backend/app/routers/library.py').read()); print('OK')"
# Ulangi untuk file backend lain yang Anda ubah

# 4. Diff review — lihat semua yang berubah
git diff             # Yang belum di-stage
git status           # Daftar file yang berubah

# 5. Test berjalan? Login, upload, klik fitur sekali lagi via localhost
```

Kalau semuanya hijau, **stop di sini**. Kode tetap di lokal sampai hari rilis. Tidak perlu commit, tidak perlu push.

**Opsional — commit lokal untuk backup** (tidak di-push):
```bash
git add <file-yang-mau-di-commit>
git commit -m "wip: deskripsi singkat"
# Commit ini cuma ada di komputer Anda; aman.
```

---

## Hari rilis — window maintenance 12–4 sore

Pas masuk jam 12 di hari rilis (mingguan):

### 1. Final check

```bash
cd "D:\006 Restard\Rein v1"
git status                    # Konfirmasi file yang akan di-rilis
git diff --cached            # Lihat diff yang sudah staged
```

### 2. Commit (kalau belum)

```bash
git add <files>
git commit -m "feat: ringkas perubahan"
# atau "fix:" untuk bug fix
# atau "chore:" untuk perubahan internal
```

### 3. Push ke main → trigger auto-deploy

```bash
git push origin main
```

Tunggu:
- **Vercel** (frontend): https://vercel.com/dashboard → cek build log, ~1-2 menit
- **Coolify** (backend): dashboard Coolify → cek deploy log, ~2-3 menit

### 4. Smoke test produksi

Buka https://rein.remula-inti.com:
- Login normal
- Upload satu file kecil
- Cek halaman utama (DCC)
- Buka di HP juga

### 5. Bikin tag versi baru (opsional, untuk milestone)

```bash
# Patch fix (v1.0.0 → v1.0.1)
git tag -a v1.0.1 -m "v1.0.1 — bug fixes
- Fix X
- Fix Y"
git push origin v1.0.1

# Minor (ada fitur baru: v1.0.x → v1.1.0)
git tag -a v1.1.0 -m "v1.1.0 — new features"
git push origin v1.1.0
```

Lalu buka https://github.com/Mungky/Rein/releases/new → pilih tag → Publish Release.

### 6. Migrasi DB (kalau ada)

Kalau perubahan code Anda touch file di `db/alembic/versions/`, jalankan migrasi di Coolify:

1. Coolify dashboard → REIN backend → **Terminal**
2. Jalankan:
   ```bash
   cd /app && python -m alembic -c db/alembic.ini upgrade head
   ```
3. Lihat output untuk konfirmasi sukses

---

## Hot-fix darurat — di luar maintenance window

Kalau ada bug parah (security, data loss, login tidak jalan, file ilang), boleh push kapan saja **tapi**:

1. Bilang ke saya "ini hot-fix" supaya saya tahu untuk langsung commit + push
2. Kasih tau karyawan dulu (via WA grup): "Sebentar ada perbaikan singkat"
3. Push, tunggu deploy selesai
4. Konfirmasi fix bekerja

---

## Troubleshooting

### "Port 3000 already in use"
```bash
# Cari proses yang pakai port
netstat -ano | findstr :3000
# Bunuh proses ID-nya (PID di kolom terakhir)
taskkill /PID <pid> /F
```

### Backend tidak start: "ModuleNotFoundError"
```bash
pip install -r backend/requirements.txt
```

### Frontend tidak start: error tentang next
```bash
cd frontend
bun install
```

### Browser nampilkan halaman lama
- Hard refresh: `Ctrl+Shift+R`
- Atau buka DevTools (F12) → Network tab → centang "Disable cache"

### "Cannot connect to backend" di browser
- Pastikan backend jalan di port 8000 (cek terminal backend)
- Pastikan `NEXT_PUBLIC_API_URL=http://localhost:8000` di `.env`
- Restart frontend setelah ubah `.env`

### Token Google expired
```bash
# Token di backend/credentials/token.json kadang expired
# Cara refresh: jalankan backend, akan auto-refresh kalau refresh_token valid
# Kalau gagal, lakukan OAuth flow ulang
```

### Mau reset perubahan lokal yang belum di-commit
```bash
# Hati-hati! Ini hapus semua perubahan yang belum di-commit
git stash         # Lebih aman — simpan dulu, bisa di-restore
# atau
git restore .     # Hapus permanen perubahan yang belum di-stage
```

---

## Cheat sheet — perintah penting

| Perintah | Kapan dipakai |
|---|---|
| `npm run dev` | Jalankan frontend + backend lokal |
| `git pull origin main` | Ambil perubahan terbaru dari GitHub |
| `git status` | Lihat file apa saja yang berubah |
| `git diff` | Lihat detail perubahan baris |
| `bunx tsc --noEmit` (di frontend/) | Cek TypeScript error |
| `bun run build` (di frontend/) | Build untuk production (catch error) |
| `git add <file>` | Stage file untuk commit |
| `git commit -m "..."` | Buat commit lokal |
| `git push origin main` | **HANYA SAAT RILIS** — push ke GitHub |
| `git stash` | Simpan perubahan sementara |
| `git stash pop` | Kembalikan perubahan yang di-stash |

---

## Kontak

Kalau bingung atau ada error yang nggak masuk akal, screenshot terminal + browser, lalu chat saya (Claude). Saya bisa lihat log dan bantuin debug.

Selamat ngoding! 🛠️
