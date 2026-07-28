# Modul 03 — Admin

Satu halaman (`/admin`) dengan lima tab. Semua endpoint dijaga
`require_role(AppRole.admin)` — **bukan** `require_permission` (lihat K-1).

## Peta layer

| Tab | Database | Backend | API Route | Frontend |
|---|---|---|---|---|
| Pengguna | `profiles` + Supabase `auth.users` | `_supabase_admin_request` | `/api/admin/users*` | `features/admin/users-tab.tsx` |
| Nomor Urut | `document_sequences` | — | `/api/library/sequences*` | `features/admin/sequences-tab.tsx` |
| Jenis File | `file_types` | `invalidate_file_types_cache` | `/api/admin/file-types*` | `features/admin/file-types-tab.tsx` |
| Izin | `role_permissions`, `folder_permissions` | — | `/api/admin/permissions`, `/api/library/admin/folder-permissions` | `features/admin/permissions-tab.tsx` |
| R-Net | `scada_settings` | `rnet_settings.py` | `/api/scada/settings` | `features/admin/rnet-tab.tsx` |

Panel Temp perpustakaan (`/api/library/admin/*`) juga admin-only tapi tinggal
di halaman `/dcc`, bukan `/admin` — lihat [Modul 01](01-document-manager.md).

---

## Fitur 1 — Manajemen pengguna

### Alur pembuatan user

```
Admin isi { username, password, full_name, role }
   │
   ▼ POST /api/admin/users
1. Cek username sudah ada di profiles?           → 409
2. email = "<username>@rein.internal"
3. Supabase Admin API: POST /auth/v1/admin/users
      ├─ 200/201        → pakai user baru
      ├─ 400/409/422    → ADOPSI user yang sudah ada
      │                   (GET daftar user, cocokkan email,
      │                    lalu PUT password baru)
      └─ selain itu     → 502
4. INSERT profiles (id = auth user id, initials dihitung)
      └─ gagal → DELETE Supabase user (best-effort) supaya tak jadi yatim
5. ← 201 ProfileResponse
```

### Layer 1 — Database

`profiles` (lihat [Modul 00](00-fondasi.md)). Password **tidak** ada di sini —
hanya di `auth.users` milik Supabase.

### Layer 2 — Backend

`backend/app/routers/admin.py` memegang helper Supabase Admin API sendiri
(bukan lewat service terpisah):

| Helper | Fungsi |
|---|---|
| `_supabase_admin_request(method, path, json_body)` | pembungkus httpx; 503 kalau `SUPABASE_SERVICE_ROLE_KEY` kosong |
| `_create_supabase_user(email, password)` | buat atau adopsi |
| `_update_supabase_password(user_id, password)` | reset password |
| `_delete_supabase_user(user_id)` | cleanup best-effort, menelan exception |
| `_username_to_email(username)` | `<username>@rein.internal` |

`SUPABASE_SERVICE_ROLE_KEY` adalah kunci paling berbahaya di sistem (bypass
RLS penuh). Hanya dipakai di modul ini dan di `db/seed.py`.

### Layer 3 — API Route

| Method | Path | Perlindungan tambahan |
|---|---|---|
| GET | `/api/admin/users` | — |
| POST | `/api/admin/users` | validasi username (regex), cek duplikat, rollback Supabase |
| PATCH | `/api/admin/users/{id}/role` | **admin tidak bisa menurunkan role dirinya sendiri** |
| PATCH | `/api/admin/users/{id}/status` | **admin tidak bisa menonaktifkan dirinya sendiri** |
| PATCH | `/api/admin/users/{id}/name` | initials dihitung ulang |
| POST | `/api/admin/users/{id}/reset-password` | 204 No Content |

Dua penjaga anti-lockout itu (role & status diri sendiri) adalah detail yang
benar dan sering dilupakan sistem lain.

> **Tidak ada endpoint hapus user.** Hanya nonaktifkan. Konsisten dengan
> `is_active` di `get_current_profile`.

### Layer 4 — Frontend

`features/admin/users-tab.tsx` (473 baris). Memakai `fetch` mentah ke
`${API_URL}/api/admin/users*`, bukan `ApiClient`.

---

## Fitur 2 — Matriks izin role

### Layer 3 — API Route

| Method | Path | Perilaku |
|---|---|---|
| GET | `/api/admin/permissions` | `{permissions, all_permissions, labels}` |
| PUT | `/api/admin/permissions` | **replace penuh**, bukan delta |

`PUT` memvalidasi setiap kunci terhadap `ALL_PERMISSIONS` (400 kalau tak
dikenal), lalu hapus semua baris dan tulis ulang. Setelah wipe, **set penuh
admin ditambahkan kembali secara paksa** — sistem tidak bisa mengunci dirinya
sendiri dari UI.

### Layer 4 — Frontend

`features/admin/permissions-tab.tsx` (408 baris) — grid role × permission,
plus editor izin folder (`folder_permissions`, 9 kolom × role × departemen).

> Perhatikan dua matriks yang mudah tertukar:
> **`role_permissions`** (apa yang bisa dilakukan role di aplikasi) dan
> **`folder_permissions`** (apa yang bisa dilakukan role di rak dokumen
> tertentu). Keduanya diedit di tab yang sama.

---

## Fitur 3 — Jenis file

### Layer 1 — Database

`file_types`: `code` (String(8)) PK **immutable**, `label`, `description`,
`is_active`, `sort_order`. Tidak pernah hard-delete.

Alasan `code` immutable: nomor arsip yang sudah terbit memuat kode itu
(`DRW-0041-...`). Mengubahnya akan memutus hubungan dengan file yang sudah ada
di Drive.

### Layer 3 — API Route

| Method | Path | Catatan |
|---|---|---|
| GET | `/api/admin/file-types` | admin lihat aktif + nonaktif |
| POST | `/api/admin/file-types` | 409 kalau `code` sudah dipakai |
| PATCH | `/api/admin/file-types/{code}` | `code` tidak bisa diubah |

Ketiganya memanggil `invalidate_file_types_cache()` supaya deteksi metadata
langsung memakai daftar baru.

Endpoint publik pendampingnya: `GET /api/library/file-types` (semua user login,
hanya `is_active`).

---

## Fitur 4 — Nomor urut dokumen

`document_sequences` (`doc_type` PK, `current_number`).

| Method | Path |
|---|---|
| GET | `/api/library/sequences` |
| PATCH | `/api/library/sequences/{doc_type}` |

Dipakai untuk menyelaraskan penghitung dengan nomor arsip yang sudah terlanjur
ada di Drive sebelum sistem dipakai.

---

## Fitur 5 — Pengaturan R-Net

`scada_settings` (satu baris). Tujuh field:
`level_fastest_s`, `level_fast_s`, `level_slow_s`, `level_slowest_s`,
`ring_window_h`, `store_months`, `reset_warn_days`.

| Method | Path | Izin |
|---|---|---|
| GET | `/api/scada/settings` | `scada:view` |
| PATCH | `/api/scada/settings` | `scada:view` + `scada:manage` |

Perubahan dicatat ke `scada_audit_log` (`TARGET_SETTINGS`).

> Perubahan di sini mempengaruhi **bridge** juga, tapi bridge hanya me-refresh
> konfigurasi tiap `CONFIG_REFRESH_S = 30` detik — jadi ada jeda sampai
> setengah menit sebelum interval baru berlaku di lapangan.

---

## Seeding (`db/seed.py`, 473 baris)

Dijalankan manual, bukan bagian dari runtime.

1. `seed_admin()` — buat/selaraskan akun admin dari `ADMIN_USERNAME`,
   `ADMIN_PASSWORD`, `ADMIN_FULL_NAME`. Termasuk `_sync_supabase_admin_email()`
   yang memperbaiki email Supabase kalau username admin berubah.
2. `DEFAULT_ROLE_PERMISSIONS` → `role_permissions`.
3. `seed_clients_and_projects()` — data klien & proyek awal.

Skrip pendamping: `db/scripts/seed_library_folders.py` dan `_v2.py` untuk
struktur rak departemen.

---

## Utang & catatan modul ini

| # | Hal | Dampak |
|---|---|---|
| **K-1** | Seluruh modul pakai `require_role(admin)` sementara matriks menawarkan `admin:manage_users` dan `admin:manage_file_types` | Izin yang dicentang admin tidak berpengaruh apa pun |
| **B-4** | `DEFAULT_ROLE_PERMISSIONS` hanya memetakan 11 dari 15 role | `engineer_civil`, `procurement`, `safety_man`, `warehouse_manager` di-seed tanpa izin apa pun |
| — | Regex username diduplikasi frontend + backend | Bisa menyimpang |
| — | `users-tab.tsx` pakai `fetch` mentah, bukan `ApiClient` | Dua gaya HTTP client di satu aplikasi |
| — | `permissions-tab.tsx:117` melanggar `set-state-in-effect` | Bagian dari 17 error lint |
| — | Tidak ada endpoint hapus user | Disengaja — tapi belum didokumentasikan sebagai kebijakan |
| — | `ADMIN_PASSWORD=admin123` di `.env.example` | Wajar untuk contoh, tapi pastikan tidak terbawa ke produksi |
