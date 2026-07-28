# Modul 04 — Workspace (Proyek, Phase, Task / Work Order)

> **Status: terkunci di frontend, hidup di backend.**
> `lib/feature-flags.ts` menyetel `workspace: false`, jadi `/workspace` dan
> `/dashboard` menampilkan layar "segera hadir". Tapi **31 endpoint
> `/api/workspace/*` tetap ter-mount dan berfungsi penuh**, dan halaman
> mobile `/m/wo` **tidak** melewati feature flag.

## Peta layer

| Fitur | Database | Backend | API Route | Frontend |
|---|---|---|---|---|
| Template proyek | `project_templates`, `phase_templates`, `task_templates` | — | `/templates*` | `create-project-modal.tsx` |
| Proyek | `workspace_projects` | `_project_progress` | `/projects*` | `shared/project-list.tsx` |
| Phase | `workspace_phases` | `_task_progress` | `/projects/{id}/phases`, `/phases/{id}` | `kanban/kanban-column.tsx` |
| Task / Work Order | `workspace_tasks` | `_enrich_task` | `/phases/{id}/tasks`, `/tasks/{id}*` | `kanban/kanban-card.tsx`, `shared/wo-form-modal.tsx` |
| Siklus WO | `workspace_tasks` + `task_completions` | `_can` | `/tasks/{id}/start\|submit-report\|review` | `shared/wo-detail-drawer.tsx`, `app/m/wo/*` |
| Foto laporan | *(Supabase Storage `workspace-photos`)* | — | *(langsung ke Storage)* | `lib/api/workspace-storage.ts` |
| Timeline / Gantt | semua di atas | — | `/timeline` | `calendar/calendar-view.tsx` |
| Ringkasan | semua di atas | — | `/summary` | `app/(app)/dashboard/page.tsx` |

---

## Layer 1 — Database

### Tabel blueprint (cetakan)

| Tabel | Isi |
|---|---|
| `project_templates` | `name` (unik), `description` |
| `phase_templates` | `template_id` FK CASCADE, `name`, `order`, `estimated_days` |
| `task_templates` | `phase_template_id` FK CASCADE, `name`, `estimated_days`, `default_role`, `order` |

`default_role` menyimpan slug role (mis. `engineer_mechanical`) sebagai
String(64) **tanpa FK ke enum** — jadi tidak divalidasi.

### Tabel proyek nyata

**`workspace_projects`**

| Kolom | Catatan |
|---|---|
| `name`, `client_name`, `description` | |
| `rpo_number` | Text, null. Unik-saat-tidak-null lewat partial index. **Diisi manual** — penomoran otomatis ditunda |
| `template_id` | FK `SET NULL` |
| `start_date`, `deadline` | Date |
| `status` | enum `project_status`: `planning` / `active` / `on_hold` / `completed` |
| `manager_id` | FK profiles `SET NULL` |

**`workspace_phases`** — `project_id` FK CASCADE, `name`, `order`,
`start_date`, `deadline`, `status` (`pending`/`active`/`completed`).

**`workspace_tasks`** — Task biasa yang diperluas jadi Work Order:

| Kelompok | Kolom |
|---|---|
| Dasar | `phase_id` FK CASCADE, `name`, `order`, `notes`, `deadline` |
| Work Order | `description` (lingkup), `location` (lokasi fisik), `estimated_days` |
| Penugasan | `assigned_to` FK profiles `SET NULL` |
| Status | enum `task_status`: `todo` / `in_progress` / `pending_review` / `done` / `overdue` |
| Siklus | `started_at`, `reviewed_at`, `reviewed_by`, `review_notes` |

**`task_completions`**

| Kolom | Catatan |
|---|---|
| `task_id` FK CASCADE, `submitted_by` FK CASCADE | |
| `photo_url` | **legacy** — satu foto, dipertahankan untuk record lama |
| `photos_before`, `photos_after` | JSONB array URL, default `[]` |
| `notes`, `completed_at` | |

Migrasi: `g9h1i2j3k4l5` (tabel dasar) → `n8o9p0q1r2s3` (RPO + detail WO).

---

## Layer 2 — Backend

`backend/app/routers/workspace.py` (1071 baris) — router sekaligus tempat
logika bisnis; **tidak ada** service terpisah untuk modul ini.

### Helper visibilitas

`_visible_project_ids(db, profile)` → daftar UUID, atau `None` = semua.

Seorang pengguna melihat sebuah proyek kalau: dia manajernya, **atau** dia
punya minimal satu task di dalamnya. Admin selalu `None` (tanpa filter).

Implementasinya tiga query berurutan (manager → phase dari task → project dari
phase). Bisa jadi satu query dengan `UNION`, tapi jumlah proyek kecil.

### Helper progres

- `_task_progress(db, phase_id)` — rasio task `done` di sebuah phase.
- `_project_progress(db, project_id)` — rata-rata progres phase.
- `_enrich_task(db, task)` — menempelkan nama assignee dan status turunan.

### Helper izin

`_can(db, profile, permission)` — pembungkus `_load_permissions`. Dipakai
untuk pengecekan **di dalam** handler yang penjaga dependency-nya lebih longgar
(mis. handler dijaga `workspace:view` tapi di dalamnya mengecek
`workspace:execute_wo`).

Pola ini disengaja: assignee sebuah WO boleh mengeksekusi WO-nya sendiri
**tanpa** perlu izin `workspace:execute_wo` global.

---

## Layer 3 — API Route

31 endpoint, semua berprefiks `/api/workspace`.

### Template

| Method | Path | Izin |
|---|---|---|
| GET | `/templates` | `workspace:view` |
| GET | `/templates/{id}` | `workspace:view` |
| POST | `/templates` | `workspace:manage` |

### Proyek & phase

| Method | Path | Izin |
|---|---|---|
| GET | `/projects` | `workspace:view` (+ filter `_visible_project_ids`) |
| POST | `/projects` | `workspace:manage` |
| GET | `/projects/{id}` | `workspace:view` |
| PUT | `/projects/{id}` | `workspace:manage` |
| GET | `/timeline` | `workspace:view` |
| GET | `/projects/{id}/phases` | `workspace:view` |
| POST | `/projects/{id}/phases` | `workspace:manage` |
| PUT | `/phases/{id}` | `workspace:manage` |
| GET | `/summary` | `workspace:view` |

### Task / Work Order

| Method | Path | Penjaga dependency | Cek tambahan di dalam |
|---|---|---|---|
| GET | `/phases/{id}/tasks` | `workspace:view` | — |
| GET | `/my-tasks` | `workspace:view` | difilter ke `assigned_to = saya` |
| POST | `/phases/{id}/tasks` | `workspace:manage` | — |
| PUT | `/tasks/{id}` | `workspace:view` | — |
| POST | `/tasks/{id}/start` | `workspace:view` | assignee **atau** `execute_wo` **atau** `manage` |
| POST | `/tasks/{id}/submit-report` | `workspace:view` | idem |
| POST | `/tasks/{id}/review` | `workspace:view` | `review_wo` **atau** `manage` |
| POST | `/tasks/{id}/complete` | `workspace:complete_task` | — (jalur legacy satu foto) |
| GET | `/tasks/{id}/completions` | `workspace:view` | — |

### Mesin status Work Order

```
        ┌──────┐
        │ todo │
        └───┬──┘
            │ POST /start        (assignee / execute_wo / manage)
            ▼
      ┌─────────────┐
      │ in_progress │◄──────────────────────┐
      └──────┬──────┘                       │
             │ POST /submit-report          │ decision =
             │  → buat TaskCompletion       │ "request_revision"
             ▼    (photos_before/after)     │ (review_notes wajib)
      ┌────────────────┐                    │
      │ pending_review │────────────────────┘
      └────────┬───────┘
               │ POST /review  decision = "approve"
               ▼
           ┌──────┐
           │ done │
           └──────┘

  (jalur legacy terpisah: POST /complete → langsung done, satu foto)
```

Validasi transisi ada dan ketat: `/start` menolak dari status selain
`todo`/`in_progress` (400); `/review` menolak kalau status bukan
`pending_review` (400); `request_revision` mewajibkan `review_notes` non-kosong.

---

## Layer 4 — Frontend

### Halaman desktop (terkunci)

`app/(app)/workspace/page.tsx` — baris pertama:
`if (isLocked("workspace")) return <LockedFeature title="Workspace" />;`

Di baliknya: `ViewToggle` untuk berpindah antara `ProjectListView`,
`KanbanView`, dan `CalendarView` (743 baris — pandangan Gantt/kalender).

State: `features/workspace/store.ts` (Zustand).

### Halaman mobile (**tidak terkunci**)

| Route | Berkas |
|---|---|
| `/m/wo` | `app/m/wo/page.tsx` — daftar WO milik saya |
| `/m/wo/[id]` | `app/m/wo/[id]/page.tsx` (514 baris) — detail + tombol Mulai/Submit |

`app/m/layout.tsx` adalah layout terpisah dari `(app)` — tanpa sidebar, tanpa
topbar. Ditujukan untuk pekerja lapangan di HP.

> **Tiga penjaga yang tidak ada di jalur mobile:**
> 1. Bukan `isLocked("workspace")` — feature flag dilewati.
> 2. Bukan `<PageGuard>` — tidak ada pengecekan `workspace:view` di klien.
> 3. Bukan `isProtectedPath` di `middleware.ts` (daftarnya: `/dashboard`,
>    `/dcc`, `/approvals`, `/admin`, `/workspace` — `/m` tidak ada).
>
> Docstring `m/layout.tsx` menulis *"Auth check happens via the shared
> SupabaseProvider in root layout"* — provider itu menyediakan sesi, tapi
> tidak me-redirect siapa pun.
>
> Data tetap aman: `require_permission("workspace:view")` di backend menolak
> request tanpa token. Tapi pengunjung tanpa login melihat kerangka halaman
> dengan error, bukan diarahkan ke login. Dan alur Work Order **hidup di
> produksi lewat jalur mobile** meski modul Workspace "terkunci" — perlu
> ditegaskan apakah itu memang niatnya.

### Komponen `features/workspace/`

| Berkas | Peran |
|---|---|
| `shared/project-list.tsx` (455) | Daftar + `ProjectDetail` |
| `shared/create-project-modal.tsx` | Buat dari template |
| `shared/edit-project-modal.tsx` | *(tidak di-import — dead)* |
| `shared/wo-form-modal.tsx` | Buat/edit WO |
| `shared/wo-detail-drawer.tsx` (542) | Detail WO + aksi |
| `shared/wo-report-form.tsx` | Form laporan + unggah foto |
| `shared/complete-task-modal.tsx` | *(tidak di-import — dead, jalur legacy)* |
| `shared/progress-bar.tsx`, `status-badge.tsx`, `view-toggle.tsx` | Presentasi |
| `kanban/kanban-view.tsx`, `kanban-column.tsx`, `kanban-card.tsx` | Papan Kanban |
| `calendar/calendar-view.tsx` (743) | Timeline |
| `constants.ts`, `types.ts` | |

### Unggah foto — jalur berbeda dari Document Manager

`lib/api/workspace-storage.ts` mengunggah **langsung dari browser ke Supabase
Storage** bucket `workspace-photos`, lalu menyimpan `publicUrl` ke DB lewat
`submit-report`. Backend tidak pernah menyentuh byte-nya.

Bucket harus **public read**. Jadi setiap URL foto laporan lapangan bisa dibuka
siapa saja yang tahu URL-nya — path-nya `<taskId>/<timestamp>-<random8>.<ext>`,
jadi tidak mudah ditebak, tapi juga tidak dilindungi.

---

## Utang & catatan modul ini

| # | Hal | Dampak |
|---|---|---|
| — | Backend hidup penuh sementara frontend desktop terkunci | 31 endpoint terbuka untuk modul yang "belum dipakai" |
| — | Rute mobile `/m/wo*` melewati feature flag, `PageGuard`, **dan** `isProtectedPath` middleware | Alur WO aktif di produksi lewat pintu samping; pengunjung tanpa login tidak di-redirect (data tetap aman karena backend menolak) |
| — | `workspace:create_wo` & `workspace:close_project` tidak ditegakkan backend | Izin hantu (K-1) |
| — | Bucket `workspace-photos` public read | Foto laporan lapangan dapat diakses siapa pun yang tahu URL |
| — | Dua jalur penyelesaian (`/complete` legacy vs `/submit-report` + `/review`) | Kolom `photo_url` legacy hidup berdampingan dengan `photos_before/after` |
| — | `edit-project-modal.tsx` & `complete-task-modal.tsx` tidak di-import | Dead code |
| — | `wo-detail-drawer.tsx:96,108` & `kanban-view.tsx:50` melanggar lint | Bagian dari 17 error |
| — | Penomoran RPO otomatis ditunda | `rpo_number` diisi manual — sesuai catatan fitur tertunda |
| — | Tanpa tes | Sama seperti Document Manager |
| — | `default_role` di `task_templates` String tanpa validasi enum | Bisa menyimpan role yang tidak ada |
