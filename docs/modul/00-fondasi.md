# Modul 00 — Fondasi: Auth, Profil, Matriks Izin, App Shell

Modul ini bukan fitur yang dilihat pengguna, tapi **setiap** modul lain
bergantung padanya. Perbaikan di sini berdampak ke seluruh aplikasi.

## Peta layer

| Fitur | Database | Backend | API Route | Frontend |
|---|---|---|---|---|
| Login username | *(Supabase `auth.users`)* | — | — | `lib/auth/username.ts`, `app/(auth)/login/page.tsx` |
| Verifikasi token | — | `app/dependencies.py` | semua endpoint | `lib/supabase/client.ts`, `middleware.ts` |
| Profil pengguna | `profiles` | `dependencies.get_current_profile` | `GET /api/auth/me`, `POST /api/auth/session` | `hooks/use-auth.tsx` |
| Matriks izin | `role_permissions` | `dependencies._load_permissions` | `GET /api/permissions/` | `providers/permissions-provider.tsx` |
| Penjaga halaman | — | `require_permission`, `require_role` | — | `guards/page-guard.tsx`, `guards/locked-feature.tsx` |
| Shell aplikasi | — | — | — | `app/(app)/layout.tsx`, `components/layout/*` |
| Presence online | — | *(Supabase Realtime)* | — | `providers/presence-provider.tsx` |
| Rate limit | — | `app/limiter.py` | dekorator `@limiter.limit` | — |
| Error tracking | — | `main.py` (Sentry + middleware 5xx) | — | — |

---

## Fitur 1 — Login dengan username (bukan email)

### Alur end-to-end

```
User ketik "budi" + password
   │
   ▼
login/page.tsx  →  usernameToEmail("budi") = "budi@rein.internal"
   │
   ▼
supabase.auth.signInWithPassword({ email, password })      [Supabase Auth]
   │  set cookie sesi
   ▼
middleware.ts  →  supabase.auth.getUser()  (verifikasi nyata, bukan cuma baca cookie)
   │
   ▼
use-auth.tsx  →  GET /api/auth/me  (Bearer access_token)
   │
   ▼
backend dependencies.py  →  verifikasi JWT lokal  →  SELECT profiles WHERE id = sub
   │
   ▼
UserProfile { id, username, full_name, initials, role, is_active }
```

### Layer 1 — Database

Tidak ada tabel milik REIN untuk kredensial. Password hidup di
`auth.users` milik Supabase. Yang dimiliki REIN:

**`profiles`** — `db/models/profile.py`

| Kolom | Tipe | Catatan |
|---|---|---|
| `id` | UUID PK | **FK ke `auth.users.id`** (migrasi `a6c135352c84`) |
| `username` | String, unik | identitas kanonik yang dilihat pengguna |
| `full_name` | String(255) | |
| `initials` | String(10) | dihitung saat pembuatan user |
| `avatar_url` | Text, null | |
| `role` | enum `app_role` | 15 nilai, lihat `AppRole` |
| `is_active` | bool, default true | false = ditolak di `get_current_profile` |
| `created_at` / `updated_at` | timestamptz | dari `TimestampMixin` |

Enum `app_role` **dimiliki tabel `profiles`**; `role_permissions` memakainya
ulang dengan `create_type=False` supaya `create_all` di tes tidak mencoba
membuatnya dua kali.

### Layer 2 — Backend

`backend/app/dependencies.py` — rantai dependency berlapis:

```
security (HTTPBearer, auto_error=False)
   └─ verify_supabase_token   → payload dict {id, email, role}
        └─ get_current_user   → dict yang sama
             └─ get_current_profile → Profile (dari DB)
                  ├─ require_role(*roles)        → Profile
                  └─ require_permission(*perms)  → Profile
```

**Verifikasi token** memilih kunci berdasarkan header JWT:

- `alg` = ES256/384/512 → ambil JWKS dari
  `{supabase_url}/auth/v1/.well-known/jwks.json`, cari `kid`.
  Cache TTL 1 jam. Kalau `kid` tidak ketemu → **satu** refresh paksa sebelum
  menolak (menangani rotasi kunci tanpa restart). Kalau refresh gagal dan cache
  lama ada → sajikan cache lama (lebih baik kunci agak basi daripada semua
  request 401 saat Supabase cegukan).
- selain itu → `SUPABASE_JWT_SECRET` (HS256).

`jwt.decode(..., audience="authenticated")`. **Tidak** memverifikasi `issuer`
(temuan K-6).

**`get_current_profile`** menambahkan dua penolakan di atas token valid:
`404` kalau baris `profiles` tidak ada, `403` kalau `is_active = false`
("Akun ini sudah dinonaktifkan oleh administrator").

**`_load_permissions(db, role)`** — untuk `AppRole.admin` mengembalikan
`ALL_PERMISSIONS` tanpa query (anti-lockout). Selain itu `SELECT permission
FROM role_permissions WHERE role = ?`.

> **Catatan performa:** `require_permission` memicu satu query per request.
> Tidak ada cache. Halaman R-Net yang memanggil belasan endpoint sekaligus
> membayar belasan query matriks. Kandidat cache TTL pendek.

### Layer 3 — API Route

`backend/app/routers/auth.py`

| Method | Path | Penjaga | Kembalian |
|---|---|---|---|
| GET | `/api/auth/me` | `get_current_profile` | `{id, username, full_name, initials, avatar_url, role, is_active}` |
| POST | `/api/auth/session` | `get_current_profile` | sama; dipakai untuk validasi sesi |

`backend/app/routers/permissions.py`

| Method | Path | Penjaga | Kembalian |
|---|---|---|---|
| GET | `/api/permissions/` | `get_current_profile` (siapa pun yang login) | `{permissions: {role: [key]}, all_permissions: [...], labels: {...}}` |

Baris admin di respons **selalu ditimpa** dengan `ALL_PERMISSIONS`, supaya
permission baru yang ditambahkan setelah seed tetap sampai ke sidebar admin.

### Layer 4 — Frontend

**`lib/auth/username.ts`** — pemetaan username ↔ email sintetis.
Regex `^[a-z0-9](?:[a-z0-9._-]{0,30}[a-z0-9])?$` **diduplikasi** persis di
backend (`admin.py:USERNAME_RE`). Domain `rein.internal`.

**`middleware.ts`** — jalan di edge sebelum halaman dirender.
Memakai `getUser()` (bukan `getSession()`) supaya token kedaluwarsa
benar-benar terdeteksi, bukan dipercaya dari cookie. Prefiks terlindungi:
`/dashboard`, `/dcc`, `/approvals`, `/admin`, `/workspace`.

> `/r-net` dan `/m/*` **tidak** ada di daftar itu. `/r-net` tetap aman karena
> `PageGuard` di sisi klien + `require_permission` di backend. `/m/*` (Work
> Order mobile) tidak punya `PageGuard` sama sekali — hanya backend yang
> menjaganya. Dalam kedua kasus, pengunjung belum login melihat kerangka
> halaman dulu, bukan redirect langsung.

**`hooks/use-auth.tsx`** — sumber tunggal `user` + `profile`. Menangani
"Masalah G" (sesi basi bikin app nyangkut di spinner): kalau `/api/auth/me`
balas 401/403, sesi dianggap kedaluwarsa → `signOut()` → guard melempar ke
login. Error jaringan atau 5xx **tidak** dianggap kedaluwarsa.

**`app/(auth)/callback/route.ts`** — menukar `code` OAuth jadi sesi.
Parameter `next` divalidasi harus relatif (`startsWith("/")` dan bukan `"//"`)
untuk menutup open-redirect.

---

## Fitur 2 — Matriks izin berbasis database

### Alur

```
Admin centang kotak di /admin → tab Izin
   │  PUT /api/admin/permissions  (matriks penuh, bukan delta)
   ▼
role_permissions: DELETE semua → INSERT ulang → admin di-force full set
   │
   ▼
Frontend lain: GET /api/permissions/  → PermissionsProvider (context)
   │
   ├─ Sidebar: sembunyikan menu tanpa izin
   ├─ PageGuard: tampilkan "Akses Ditolak" alih-alih konten
   └─ Komponen: useCan(role, perm) untuk tombol
```

### Layer 1 — Database

**`role_permissions`** — satu baris = satu pasangan (role, permission).

| Kolom | Tipe |
|---|---|
| `id` | int PK autoincrement |
| `role` | enum `app_role`, index |
| `permission` | String(64), index |

`UNIQUE (role, permission)`. Migrasi `d8f4a1b2c905`.

### Layer 2 — Backend

`db/models/role_permission.py` memegang tiga konstanta:

- **`ALL_PERMISSIONS`** — 22 kunci, sumber kebenaran.
- **`PERMISSION_LABELS`** — label bahasa Indonesia untuk UI.
- **`DEFAULT_ROLE_PERMISSIONS`** — seed awal per role.

Daftar 22 kunci:

| Grup | Kunci |
|---|---|
| Dashboard | `dashboard:view` |
| DCC | `dcc:view`, `dcc:upload`, `dcc:search`, `dcc:approve`, `dcc:manage_access`, `dcc:manage_clients`, `dcc:delete`, `dcc:chat` |
| Admin | `admin:manage_users`, `admin:manage_file_types` |
| Workspace | `workspace:view`, `workspace:manage`, `workspace:complete_task`, `workspace:create_wo`, `workspace:execute_wo`, `workspace:review_wo`, `workspace:close_project` |
| R-Net | `scada:view`, `scada:edit_layout`, `scada:manage`, `scada:ack` |

**Penegakan nyata per kunci** (hasil hitung kemunculan di kode):

| Kunci | Ditegakkan backend? | Dipakai frontend? |
|---|:---:|:---:|
| `dcc:view/upload/search/approve/manage_access/manage_clients/chat` | ✅ | ✅ |
| `dashboard:view` | ✅ (router dorman) | ✅ |
| `workspace:view/manage/complete_task/execute_wo/review_wo` | ✅ | ✅ |
| `scada:view/edit_layout/manage/ack` | ✅ | ✅ |
| **`dcc:delete`** | ❌ **0 kemunculan** | ✅ |
| **`admin:manage_users`** | ❌ **0** (dipakai `require_role` sbg gantinya) | ✅ |
| **`admin:manage_file_types`** | ❌ **0** | ✅ |
| **`workspace:create_wo`** | ❌ **0** | ✅ |
| **`workspace:close_project`** | ❌ **0** | ✅ |

Lima kunci terakhir adalah **izin hantu** — bisa dicentang, mengubah tampilan
UI, tapi backend mengabaikannya (temuan K-1).

**Paritas frontend↔backend** dijaga `backend/tests/test_frontend_parity.py` dan
`test_permission_matrix.py`: union `Permission` di `roles.ts` harus cocok dengan
`ALL_PERMISSIONS`. Ini alasan kelima kunci hantu itu lolos — tesnya mengecek
*keberadaan* kunci, bukan *penegakan*-nya.

### Layer 3 — API Route

Baca: `GET /api/permissions/` (semua user login).
Tulis: `GET`/`PUT /api/admin/permissions` (admin saja) — lihat
[Modul 03](03-admin.md).

### Layer 4 — Frontend

**`providers/permissions-provider.tsx`** — memuat matriks sekali,
menyediakan `usePermissions()` (state penuh + `refresh()`) dan
`useCan(role, permission)` (boolean).

Tiga state yang dibedakan: belum termuat / gagal termuat / termuat.
`PageGuard` menampilkan pesan **berbeda** untuk "gagal memuat izin"
(dengan tombol Coba Lagi) versus "akses ditolak" — supaya masalah jaringan
tidak disalahartikan sebagai pencabutan hak. Ini detail yang benar.

**`components/guards/page-guard.tsx`** — pembungkus setiap halaman:

```tsx
<PageGuard permission="scada:view"><ScadaView /></PageGuard>
```

**`components/guards/locked-feature.tsx`** + **`lib/feature-flags.ts`** —
mekanisme terpisah dari izin: `FEATURES = { dashboard: false, workspace: false }`.
Modul terkunci menampilkan layar "segera hadir" dan item sidebar kelabu,
tanpa menghapus kode.

---

## Fitur 3 — App shell (layout, sidebar, topbar, mobile)

### Layer 4 — Frontend (modul ini murni frontend)

```
app/layout.tsx                    ThemeProvider, font, metadata global
 └─ app/(app)/layout.tsx          PresenceProvider + shell
      ├─ components/layout/topbar.tsx
      ├─ components/layout/sidebar.tsx          (desktop, bisa dilipat)
      ├─ components/layout/sidebar-drawer.tsx   (mobile, overlay)
      ├─ components/layout/mobile-nav.tsx       (bottom nav)
      └─ {children}
```

Pemetaan pathname → screen id ada di `getScreen()` dalam layout, dan
pemetaan balik screen id → route di `handleSetScreen`. **Dua peta terpisah
yang harus konsisten manual.** `handleSetScreen` masih memuat rute yang belum
ada: `crm`, `projects`, `finance`, `hr`.

Item navigasi di `sidebar.tsx`:

| id | Label | Gating |
|---|---|---|
| `dashboard` | Dashboard | `isLocked("dashboard")` → kelabu |
| `workspace` | Workspace | `workspace:view` + `isLocked("workspace")` |
| `dcc` | Document Manager | **tanpa gating** — landing page default |
| `scada` | R-Net | `scada:view` |
| `admin` | Admin | `admin:manage_users` ← izin hantu (K-1) |
| `settings` | Pengaturan | `locked: true` permanen |

**`providers/presence-provider.tsx`** — semua user login bergabung ke satu
channel Supabase Realtime `rein-presence`. Presence adalah broadcast murni:
tidak menulis DB, tidak memakai slot pooler. Beberapa tab dari satu user
digabung jadi satu baris + `connections: n`.

> Docstring-nya menyebut pembacanya `features/admin/activity-tab.tsx` —
> berkas itu **tidak ada**. Presence dikumpulkan tapi tidak ditampilkan
> di mana pun.

---

## Utang & catatan modul ini

| # | Hal | Dampak |
|---|---|---|
| K-1 | 5 izin dideklarasikan tapi tidak ditegakkan backend | Admin mengira sudah memberi/mencabut akses padahal tidak |
| K-6 | JWT tanpa cek `issuer` | Pengerasan murah yang belum diambil |
| — | `require_permission` query DB tiap request, tanpa cache | Belasan query redundan per pemuatan halaman R-Net |
| — | Regex username diduplikasi frontend + backend | Bisa menyimpang diam-diam |
| — | `/r-net` tidak masuk `isProtectedPath` di middleware | Flash halaman sebelum redirect |
| — | Presence dikumpulkan, tidak ditampilkan | Dead feature; komentar merujuk berkas tak ada |
| — | Dua `cn()` (`lib/utils.ts` + `lib/utils/cn.ts`) | Kebingungan import |
| B-6 | 3 provider global melanggar `set-state-in-effect` | Cascading render menyentuh semua halaman |
