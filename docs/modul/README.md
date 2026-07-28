# Dokumentasi Modul REIN — per Fitur, per Layer

Setiap modul dipecah ke **empat layer** dengan urutan yang sama, dari bawah ke atas:

| # | Layer | Isi | Lokasi kode |
|---|---|---|---|
| 1 | **Database** | Tabel, kolom, indeks, constraint, migrasi | `db/models/`, `db/alembic/versions/` |
| 2 | **Backend** | Logika bisnis, service eksternal, worker latar, helper izin | `backend/app/services/`, `backend/app/dependencies.py` |
| 3 | **API Route** | Endpoint HTTP, penjaga izin, validasi, bentuk request/response | `backend/app/routers/`, `backend/app/schemas/` |
| 4 | **Frontend** | Halaman, komponen, state, pemanggil API | `frontend/src/app/`, `frontend/src/features/`, `frontend/src/lib/api/` |

## Daftar modul

| Berkas | Modul | Status |
|---|---|---|
| [00-fondasi.md](00-fondasi.md) | Auth, Profil, Matriks Izin, App Shell | **Aktif** — dipakai semua modul |
| [01-document-manager.md](01-document-manager.md) | Perpustakaan Digital (DCC) | **Aktif** — modul utama v1.0.0 |
| [02-r-net.md](02-r-net.md) | Cloud SCADA Remula | **Aktif** — modul paling matang |
| [03-admin.md](03-admin.md) | Pengguna, Izin, Jenis File, Sequence, R-Net settings | **Aktif** |
| [04-workspace.md](04-workspace.md) | Proyek, Phase, Task, Work Order | **Terkunci** feature-flag, API hidup |
| [05-modul-dorman.md](05-modul-dorman.md) | DCC lama, Approval, Access, Klien/Proyek, NimBus, Queue, Dashboard, Log DCC | **Dorman** — kode ada, tidak terpanggil |

## Cara membaca

Setiap modul memakai tiga bagian tetap:

- **Peta layer** — tabel ringkas: fitur × layer × berkas.
- **Per fitur** — untuk tiap fitur: alur end-to-end, lalu detail tiap layer.
- **Utang & catatan** — bug diketahui, dead code, keputusan yang belum
  ditetapkan. Nomor temuan (`K-1`, `B-3`, dst.) merujuk ke
  [`../AUDIT-CODEBASE-2026-07-25.md`](../AUDIT-CODEBASE-2026-07-25.md).

## Konvensi lintas modul

**Basis URL.** Semua endpoint backend berprefiks `/api`. Frontend membaca
`NEXT_PUBLIC_API_URL`; di dev itu `http://localhost:8000` (langsung ke
backend), di produksi domain yang di-rewrite Vercel.

**Autentikasi.** Setiap request membawa `Authorization: Bearer <supabase JWT>`.
Backend memverifikasi **lokal** (HS256 lewat `SUPABASE_JWT_SECRET`, atau ES256
lewat JWKS ber-cache) — tidak ada round-trip ke Supabase Auth per request.

**Otorisasi.** Dua mekanisme hidup berdampingan (lihat temuan K-1):

| Dependency | Sumber kebenaran | Dipakai di |
|---|---|---|
| `require_permission("x:y", ...)` | tabel `role_permissions` (bisa diedit admin) | DCC, R-Net, Workspace |
| `require_role(AppRole.admin)` | kolom `profiles.role` | seluruh `admin.py`, sebagian `library/` |
| `_has_folder_perm(...)` | tabel `folder_permissions` (per folder × role) | Document Manager |

Admin selalu lolos semua tiga (`_load_permissions` mengembalikan
`ALL_PERMISSIONS` untuk role admin — anti-lockout).

**Sesi database.** `Depends(get_db)` menghasilkan `AsyncSession` yang
**commit otomatis saat handler selesai tanpa exception**, rollback saat error.
Jadi handler tidak perlu `await db.commit()` di akhir — kecuali kalau perlu
commit *di tengah* (mis. sebelum panggilan lambat ke Drive).

**Rate limit.** `slowapi`, dikunci per-user-ID dari klaim JWT (fallback IP).
`READ_LIMIT = 600/menit`, `WRITE_LIMIT = 120/menit`. Endpoint upload/propose
punya batas lebih ketat sendiri.

**Row Level Security.** Semua tabel `public` wajib RLS aktif (mode deny-all
tanpa policy) supaya PostgREST Supabase tidak bisa dipakai memutar backend.
Backend terhubung sebagai pemilik tabel sehingga bypass RLS.
`backend/tests/test_rls.py` memvalidasi ini dinamis dari katalog Postgres —
tabel baru yang lupa RLS akan memerahkan CI.
