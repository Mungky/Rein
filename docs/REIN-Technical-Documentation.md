# REIN — Dokumentasi Teknis Lengkap

> **REIN** (Remula Inti Rekayasa) — Sistem ERP internal untuk perusahaan engineering Indonesia.
> Dibangun dengan FastAPI (Python), Next.js 16 (React 19), Supabase Auth + PostgreSQL, Google Drive/Sheets, dan Ollama AI.

---

## Daftar Isi

1. [Arsitektur Sistem](#1-arsitektur-sistem)
2. [Frontend](#2-frontend)
3. [Backend](#3-backend)
4. [Database](#4-database)
5. [Integrasi Eksternal](#5-integrasi-eksternal)
6. [Autentikasi & Otorisasi](#6-autentikasi--otorisasi)
7. [Alur Kerja (Workflow)](#7-alur-kerja-workflow)
8. [Design System & CSS](#8-design-system--css)
9. [Deployment & Infrastruktur](#9-deployment--infrastruktur)
10. [Environment Variables](#10-environment-variables)

---

## 1. Arsitektur Sistem

```
Browser
  │
  ├─ Vercel (Next.js 16 Frontend)
  │    └─ SSR + Client Components
  │         ├─ Supabase Auth (JWT)
  │         └─ API Calls ──┐
  │                          │
  └─ VPS/Coolify (FastAPI Backend) ◀─┘
       ├─ Supabase PostgreSQL (via pooler)
       ├─ Google Drive API (file storage)
       ├─ Google Sheets API (document indexing)
       └─ Ollama (NimBus AI chat)
```

**Key decisions:**
- Frontend di-deploy ke Vercel, backend di VPS (Coolify) atau Railway
- `BACKEND_URL` env var mengaktifkan Next.js rewrites proxy; tanpa itu, frontend memanggil backend langsung via `NEXT_PUBLIC_API_URL`
- Supabase Auth digunakan untuk JWT authentication; profile data disimpan di tabel `profiles` di database yang sama

---

## 2. Frontend

### 2.1 Tech Stack

| Package | Versi | Fungsi |
|---------|-------|--------|
| Next.js | 16.2.6 | Framework SSR/CSR |
| React | 19.2.4 | UI library |
| @supabase/ssr | 0.10.3 | Auth SSR integration |
| @supabase/supabase-js | 2.105.4 | Supabase client |
| @base-ui/react | 1.4.1 | Headless UI primitives |
| @dnd-kit/core + sortable + utilities | 6.3.1 / 10.0.0 / 3.2.2 | Drag-and-drop |
| zustand | 5.0.13 | State management |
| date-fns | 4.1.0 | Date formatting (locale id) |
| lucide-react | 1.14.0 | Icons |
| class-variance-authority | 0.7.1 | Component variants |
| sonner | 2.0.7 | Toast notifications |
| tailwind-merge | 3.5.0 | Class merging |

### 2.2 Struktur Direktori

```
frontend/src/
  app/
    layout.tsx                    # Root: ThemeProvider > SupabaseProvider > PermissionsProvider
    page.tsx                      # Redirects to /dashboard
    (auth)/
      login/page.tsx              # Login form (username -> synthetic email)
      callback/route.ts           # Supabase auth callback
    (app)/
      layout.tsx                  # Authenticated: Topbar + Sidebar + MobileNav
      dashboard/page.tsx         # Dashboard (manager KPI + engineer tasks)
      dcc/page.tsx               # NimBus AI chat + upload propose/confirm + activity
      dcc/access/page.tsx        # Access requests
      approvals/page.tsx         # Approval workflow
      admin/page.tsx             # User management + permission matrix
      workspace/page.tsx         # Project management (list/gantt/kanban)
  features/
    workspace/
      store.ts                   # Zustand store (projects, phases, tasks, view state)
      types.ts                   # WorkspaceView type + re-exports
      constants.ts               # STATUS_LABEL, STATUS_COLOR, PROJECT_STATUSES, TASK_STATUSES
      shared/
        status-badge.tsx          # Status pill component
        progress-bar.tsx          # Percentage progress bar
        complete-task-modal.tsx   # Task completion modal (notes + photo_url)
        create-project-modal.tsx # New project form (name, client, template, dates)
        project-list.tsx         # ProjectListView + ProjectDetail (accordion phases)
        view-toggle.tsx          # List/Gantt/Kanban toggle buttons
      gantt/
        utils.ts                 # Date math: computeDateRange, dayOffset, pxPerDay, etc.
        gantt-bar.tsx            # Bar/diamond component for timeline items
        gantt-timeline.tsx       # Month + day/week column headers
        gantt-view.tsx           # Overview: all projects on timeline
        gantt-detail.tsx         # Drill-down: phases + tasks per project
      kanban/
        kanban-column.tsx        # Droppable column (useDroppable)
        kanban-card.tsx          # Draggable card (useSortable)
        kanban-view.tsx          # Overview (project status) + detail (task status)
  hooks/
    use-auth.tsx                 # useAuth() + useAuthDisplay() — Supabase auth + profile
    use-chat-stream.ts           # SSE streaming for NimBus AI chat
    use-is-mobile.ts             # Viewport < 768px detection
    use-sidebar.ts               # Zustand: sidebar pinned/collapsed/mobileOpen
  components/
    guards/page-guard.tsx         # Permission gate: shows "Akses Ditolak" if unauthorized
    providers/
      supabase-provider.tsx      # Lazy Supabase client singleton
      permissions-provider.tsx   # Fetches + caches permission matrix, provides useCan()
      theme-provider.tsx         # Light/dark theme, localStorage persistence
    layout/
      topbar.tsx                 # App top bar (brand, breadcrumb, theme, user dropdown)
      sidebar.tsx                # Desktop nav sidebar (permission-filtered items)
      sidebar-drawer.tsx         # Mobile slide-over sidebar
      mobile-nav.tsx             # Bottom tab navigation (5 tabs)
    ui/                           # shadcn-style components (Button, Dialog, Sheet, Badge, etc.)
    dashboard/                    # KPI strip, activity feed, doc stats, quick actions
  lib/
    api/
      client.ts                  # ApiClient: get, post, patch, put, delete, upload (JWT auth)
      workspace.ts               # Full CRUD: templates, projects, phases, tasks, completions, summary
      upload.ts                   # propose(), confirm(), cancel(), listProposals()
      approvals.ts                # getPending(), approve(), reject()
      access.ts                   # requestAccess(), getPending(), verifyToken(), approveAccess(), denyAccess()
      clients.ts                  # list(), create(), update(), deactivate() for clients + projects
      dcc-activity.ts             # log(), list() (fire-and-forget activity logging)
    utils/
      cn.ts                       # clsx + twMerge
      utils.ts                    # (duplicate of cn.ts)
      roles.ts                    # AppRole type, Permission type, ROLE_PERMISSIONS_FALLBACK, hasPermission()
      format.ts                   # formatDate(), formatDateTime(), formatRelativeTime(), formatFileSize(), formatCurrency()
    supabase/
      client.ts                   # createBrowserClient for client-side Supabase
  styles/
    globals.css                   # Full design token system (see Section 8)
  middleware.ts                   # Auth guard: redirects unauthenticated to /login
```

### 2.3 Middleware Flow

```
Request → middleware.ts
  ├─ Public paths (/login, /callback) → allow
  ├─ Protected prefixes (/dashboard, /dcc, /approvals, /admin, /workspace) → check session
  │    ├─ No session → redirect to /login?next=<path>
  │    └─ Has session → refresh token → allow
  └─ Authenticated user visiting /login → redirect to /dashboard
```

### 2.4 Autentikasi Flow

```
1. User memasukkan username + password di /login
2. Frontend konversi username → <username>@rein.internal via usernameToEmail()
3. supabase.auth.signInWithPassword({ email, password })
4. Middleware memvalidasi session di setiap request
5. useAuth() hook fetch profile dari /api/auth/me (menggunakan JWT)
6. PermissionsProvider fetch permission matrix dari /api/permissions/
7. PageGuard membungkus setiap halaman, memeriksa required permission
```

### 2.5 API Client

```typescript
// Semua API call menggunakan instance tunggal:
import { apiClient } from "@/lib/api/client";

// Auto-attach JWT dari Supabase session
// URL base: NEXT_PUBLIC_API_URL (default: http://localhost:8000)

// Methods tersedia:
apiClient.get<T>(path, params?)
apiClient.post<T>(path, body?)
apiClient.patch<T>(path, body?)
apiClient.put<T>(path, body?)       // ← ditambahkan untuk workspace
apiClient.delete<T>(path)
apiClient.upload<T>(path, file, fieldName?)
```

---

## 3. Backend

### 3.1 Tech Stack

- **FastAPI** 0.111+ (Python 3.11+)
- **SQLAlchemy** 2.0 async dengan asyncpg driver
- **Supabase** untuk Auth + PostgreSQL
- **Google Drive/Sheets API** untuk document storage
- **Ollama** untuk AI chat (model: `glm-5.1:cloud`)
- **aiosmtplib** untuk email notifications

### 3.2 Routers & Endpoints

#### Auth (`/api/auth`)

| Method | Path | Auth | Deskripsi |
|--------|------|------|-----------|
| GET | `/me` | Any authenticated | Profil user saat ini |
| POST | `/session` | Any authenticated | Verifikasi session |

#### Documents (`/api/documents`)

| Method | Path | Permission | Deskripsi |
|--------|------|------------|-----------|
| GET | `/stats` | dcc:view | Statistik dokumen |
| GET | `/` | dcc:view | List dokumen (filter: doc_type, status, client, project, limit, offset) |
| GET | `/search` | dcc:view + dcc:search | Cari dokumen (ILIKE pada title, doc_number, client_name, project_name) |
| GET | `/{document_id}` | dcc:view | Detail satu dokumen |
| POST | `/` | dcc:upload | Buat metadata dokumen |
| PATCH | `/{document_id}` | dcc:upload | Update metadata dokumen |

#### Upload (`/api/upload`) — Propose/Confirm/Cancel Flow

| Method | Path | Permission | Deskripsi |
|--------|------|------------|-----------|
| POST | `/` | dcc:upload | **PROPOSE**: Upload ke Drive, deteksi metadata, return proposal (TTL 30 menit) |
| POST | `/{upload_id}/confirm` | dcc:upload | **CONFIRM**: Simpan metadata, pindahkan file ke folder klien/proyek, indeks ke Sheets |
| DELETE | `/{upload_id}` | dcc:upload | **CANCEL**: Hapus file dari Drive |
| GET | `/proposals` | dcc:upload | List proposal aktif user |

**Format nama file:** `TYPE-SEQ-CLIENT-TITLE-PROJECT-NOTE.ext`
**Ukuran maksimum:** 50MB
**Ekstensi didukung:** .docx, .xlsx, .pptx, .pdf, .zip, .rar, .dwg, .step, .stp

#### Approvals (`/api/approvals`)

| Method | Path | Permission | Deskripsi |
|--------|------|------------|-----------|
| GET | `/pending` | dcc:approve | List approval pending untuk user saat ini |
| POST | `/{approval_id}/approve` | dcc:approve | Setujui dokumen |
| POST | `/{approval_id}/reject` | dcc:approve | Tolak dokumen (dengan komentar) |

#### Access (`/api/access`)

| Method | Path | Permission | Deskripsi |
|--------|------|------------|-----------|
| POST | `/request` | dcc:view | Buat permintaan akses dokumen |
| GET | `/pending` | dcc:manage_access | List permintaan akses yang pending |
| GET | `/{token}` | Public | Verifikasi token akses sementara (15 menit expiry) |
| POST | `/{request_id}/approve` | dcc:manage_access | Setujui permintaan (kirim email dengan link download) |
| POST | `/{request_id}/deny` | dcc:manage_access | Tolak permintaan (kirim email penolakan) |

#### Chat (`/api/chat`)

| Method | Path | Permission | Deskripsi |
|--------|------|------------|-----------|
| POST | `/` | dcc:chat | Stream respons AI (SSE) dengan tool calls (search_documents, request_access) |
| GET | `/status` | dcc:chat | Cek status server Ollama |

#### Queue (`/api/queue`)

| Method | Path | Permission | Deskripsi |
|--------|------|------------|-----------|
| GET | `/status` | dcc:upload | Status antran upload user saat ini |
| GET | `/stats` | dcc:upload | Statistik antrian |

#### Dashboard (`/api/dashboard`)

| Method | Path | Permission | Deskripsi |
|--------|------|------------|-----------|
| GET | `/stats` | dashboard:view | KPI: active_projects, open_invoices, documents_this_month, dll. |
| GET | `/activity` | dashboard:view | Aktivitas upload dokumen terbaru |

#### Admin (`/api/admin`)

| Method | Path | Permission | Deskripsi |
|--------|------|------------|-----------|
| GET | `/users` | admin only | List semua profil |
| POST | `/users` | admin only | Buat user (Supabase Auth + Profile) |
| PATCH | `/users/{user_id}/role` | admin only | Update role user |
| PATCH | `/users/{user_id}/status` | admin only | Aktifkan/nonaktifkan user |
| PATCH | `/users/{user_id}/name` | admin only | Update nama user |
| POST | `/users/{user_id}/reset-password` | admin only | Reset password user |
| GET | `/permissions` | admin only | Matriks permission lengkap |
| PUT | `/permissions` | admin only | Replace matriks permission (admin selalu retain semua) |

#### Permissions (`/api/permissions`)

| Method | Path | Auth | Deskripsi |
|--------|------|------|-----------|
| GET | `/` | Any authenticated | Matriks permission aktif (untuk frontend gating) |

#### Clients (`/api/clients`)

| Method | Path | Permission | Deskripsi |
|--------|------|------------|-----------|
| GET | `/` | dcc:view | List klien (filter active_only) |
| POST | `/` | dcc:manage_clients | Buat klien |
| PATCH | `/{client_id}` | dcc:manage_clients | Update klien |
| PATCH | `/{client_id}/deactivate` | dcc:manage_clients | Soft-delete klien |

#### Projects (`/api/projects`)

| Method | Path | Permission | Deskripsi |
|--------|------|------------|-----------|
| GET | `/` | dcc:view | List proyek (filter client_id, active_only) |
| POST | `/` | dcc:manage_clients | Buat proyek |
| PATCH | `/{project_id}` | dcc:manage_clients | Update proyek |
| PATCH | `/{project_id}/deactivate` | dcc:manage_clients | Soft-delete proyek |

#### DCC Activity (`/api/dcc/activity`)

| Method | Path | Permission | Deskripsi |
|--------|------|------------|-----------|
| POST | `` | dcc:view | Log aktivitas (upload / access_request) |
| GET | `` | dcc:view | List aktivitas terbaru (limit max 200) |

#### Workspace (`/api/workspace`)

| Method | Path | Permission | Deskripsi |
|--------|------|------------|-----------|
| GET | `/templates` | workspace:view | List template proyek |
| GET | `/templates/{id}` | workspace:view | Detail template dengan phases/tasks |
| POST | `/templates` | workspace:manage | Buat template |
| GET | `/projects` | workspace:view | List proyek (assignment-filtered) |
| POST | `/projects` | workspace:manage | Buat proyek (opsional: dari template) |
| GET | `/projects/{id}` | workspace:view | Detail proyek |
| PUT | `/projects/{id}` | workspace:manage | Update proyek |
| GET | `/projects/{id}/phases` | workspace:view | List tahapan proyek |
| POST | `/projects/{id}/phases` | workspace:manage | Buat tahapan |
| PUT | `/phases/{id}` | workspace:manage | Update tahapan |
| GET | `/phases/{id}/tasks` | workspace:view | List tugas dalam tahapan |
| GET | `/my-tasks` | workspace:view | Tugas user saat ini (belum selesai) |
| POST | `/phases/{id}/tasks` | workspace:manage | Buat tugas |
| PUT | `/tasks/{id}` | workspace:view* | Update tugas (non-manager hanya bisa update tugas sendiri) |
| POST | `/tasks/{id}/complete` | workspace:complete_task | Tandai tugas selesai (photo_url, notes) |
| GET | `/tasks/{id}/completions` | workspace:view | List riwayat penyelesaian |
| GET | `/summary` | workspace:view | Ringkasan dashboard (managed + personal) |

### 3.3 Background Tasks

Task queue berbasis asyncio yang berjalan di lifespan startup:

- `INDEX_TO_SHEETS` — Indeks dokumen ke Google Sheets
- `SEND_EMAIL` — Kirim email notifikasi (SMTP Gmail)
- `CLEANUP_EXPIRED_PROPOSALS` — Hapus file Drive yang expired (setiap 300 detik)
- `REVOKE_EXPIRED_ACCESS` — Revoke token akses yang expired

### 3.4 Metadata Detection (Hybrid)

```
Upload filename → detect_metadata_hybrid()
  ├─ 1. Regex pattern: (DRW|INV|PO|SPK|RFP|RPT|SPEC)-(CLIENT)-(SEQ)
  │    └─ Confidence > 0.6 → return metadata
  └─ 2. Extension heuristics (.dwg → DRW, .xlsx → PO, etc.)
       └─ Confidence > 0.6 → return metadata
  └─ 3. LLM fallback (Ollama) → structured prompt → return metadata
       └─ Confidence still low → return best effort
```

---

## 4. Database

### 4.1 ERD Summary

```
auth.users (Supabase) ──1:1── profiles
                              │
                              ├─1:N─ documents.uploaded_by
                              ├─1:N─ documents.approved_by
                              ├─1:N─ upload_queue
                              ├─1:N─ approvals (requested_by, assigned_to)
                              ├─1:N─ access_requests (requested_by, approved_by)
                              ├─1:N─ chat_messages
                              ├─1:N─ workspace_projects.manager_id
                              ├─1:N─ workspace_tasks.assigned_to
                              ├─1:N─ task_completions.submitted_by
                              └─1:N─ dcc_activity_log

clients ──1:N─ clients_projects (Project)
                │
                └─1:N─ documents (project_name, client_name)

documents ──1:N─ approvals
           └─1:N─ access_requests

role_permissions ── (role, permission) unique

project_templates ──1:N─ phase_templates ──1:N─ task_templates
workspace_projects ──1:N─ workspace_phases ──1:N─ workspace_tasks ──1:N─ task_completions
```

### 4.2 Semua Tabel

#### `profiles`
| Kolom | Tipe | Constraint |
|-------|------|-----------|
| id | UUID | PK (matches auth.users.id) |
| username | VARCHAR(64) | NOT NULL, UNIQUE, indexed |
| full_name | VARCHAR(255) | NOT NULL |
| initials | VARCHAR(10) | NOT NULL, default "" |
| avatar_url | TEXT | nullable |
| role | ENUM(AppRole) | NOT NULL, default 'engineer_mechanical' |
| is_active | BOOLEAN | NOT NULL, default true |
| created_at | TIMESTAMPTZ | server_default now() |
| updated_at | TIMESTAMPTZ | server_default now() |

**AppRole values:** admin, director, manager, finance, accounting, human_resources, engineer_mechanical, engineer_process, engineer_electrical, purchasing, operational_manager

#### `role_permissions`
| Kolom | Tipe | Constraint |
|-------|------|-----------|
| id | INTEGER | PK, autoincrement |
| role | ENUM(AppRole) | NOT NULL, indexed |
| permission | VARCHAR(64) | NOT NULL, indexed |
| created_at | TIMESTAMPTZ | server_default now() |
| updated_at | TIMESTAMPTZ | server_default now() |

**Unique:** (role, permission)

**All permissions:** dashboard:view, dcc:view, dcc:upload, dcc:search, dcc:approve, dcc:manage_access, dcc:manage_clients, dcc:delete, dcc:chat, sidebar:crm, sidebar:projects, sidebar:finance, sidebar:hr, admin:manage_users, workspace:view, workspace:manage, workspace:complete_task

#### `documents`
| Kolom | Tipe | Constraint |
|-------|------|-----------|
| id | UUID | PK |
| doc_number | VARCHAR(50) | UNIQUE, NOT NULL, indexed |
| doc_type | ENUM(DocType) | NOT NULL, default OTHER, indexed |
| title | VARCHAR(500) | NOT NULL |
| description | TEXT | nullable |
| client_name | VARCHAR(255) | nullable |
| client_code | VARCHAR(20) | nullable |
| project_name | VARCHAR(255) | nullable |
| project_code | VARCHAR(20) | nullable |
| folder_path | VARCHAR(500) | nullable |
| file_name | VARCHAR(500) | NOT NULL |
| file_size | BIGINT | NOT NULL, default 0 |
| mime_type | VARCHAR(100) | nullable |
| gdrive_file_id | VARCHAR(100) | nullable |
| gdrive_folder_id | VARCHAR(100) | nullable |
| gdrive_web_link | TEXT | nullable |
| sheets_row_id | INTEGER | nullable |
| doc_sequence | INTEGER | nullable |
| note | VARCHAR(200) | nullable |
| status | ENUM(DocStatus) | NOT NULL, default 'draft', indexed |
| version | INTEGER | NOT NULL, default 1 |
| uploaded_by | UUID | FK → profiles.id, NOT NULL |
| approved_by | UUID | FK → profiles.id, nullable |
| created_at | TIMESTAMPTZ | server_default now() |
| updated_at | TIMESTAMPTZ | server_default now() |

**DocType:** DRW, INV, PO, SPK, RFP, RPT, SPEC, OTHER
**DocStatus:** draft, pending_review, approved, rejected, archived

#### `upload_queue`
| Kolom | Tipe | Constraint |
|-------|------|-----------|
| id | UUID | PK |
| user_id | UUID | FK → profiles.id |
| original_name | VARCHAR(500) | NOT NULL |
| file_size | BIGINT | NOT NULL, default 0 |
| mime_type | VARCHAR(100) | nullable |
| detected_type | VARCHAR(10) | nullable |
| detected_client | VARCHAR(255) | nullable |
| detected_project | VARCHAR(255) | nullable |
| detected_folder | VARCHAR(500) | nullable |
| confidence_type | FLOAT | nullable |
| confidence_client | FLOAT | nullable |
| confidence_project | FLOAT | nullable |
| confidence_folder | FLOAT | nullable |
| status | ENUM(UploadStatus) | NOT NULL, default 'detecting' |
| gdrive_file_id | VARCHAR(100) | nullable |
| gdrive_folder_id | VARCHAR(100) | nullable |
| chat_message_id | UUID | nullable |
| proposal_expires_at | TIMESTAMPTZ | nullable |
| created_at | TIMESTAMPTZ | server_default now() |
| updated_at | TIMESTAMPTZ | server_default now() |

**UploadStatus:** detecting, awaiting_confirmation, uploading, indexing, completed, failed, cancelled

#### `approvals`
| Kolom | Tipe | Constraint |
|-------|------|-----------|
| id | UUID | PK |
| document_id | UUID | FK → documents.id (CASCADE) |
| requested_by | UUID | FK → profiles.id |
| assigned_to | UUID | FK → profiles.id |
| action | ENUM(ApprovalAction) | nullable |
| comment | TEXT | nullable |
| acted_at | TIMESTAMPTZ | nullable |
| created_at | TIMESTAMPTZ | server_default now() |
| updated_at | TIMESTAMPTZ | server_default now() |

**ApprovalAction:** approve, reject, request_changes

#### `access_requests`
| Kolom | Tipe | Constraint |
|-------|------|-----------|
| id | UUID | PK |
| document_id | UUID | FK → documents.id (CASCADE) |
| requested_by | UUID | FK → profiles.id |
| reason | TEXT | nullable |
| status | ENUM(AccessStatus) | NOT NULL, default 'pending' |
| approved_by | UUID | FK → profiles.id, nullable |
| expires_at | TIMESTAMPTZ | nullable |
| temp_token | VARCHAR(100) | UNIQUE, nullable |
| acted_at | TIMESTAMPTZ | nullable |
| created_at | TIMESTAMPTZ | server_default now() |
| updated_at | TIMESTAMPTZ | server_default now() |

**AccessStatus:** pending, approved, denied, expired

#### `chat_messages`
| Kolom | Tipe | Constraint |
|-------|------|-----------|
| id | UUID | PK |
| conversation_id | VARCHAR(100) | NOT NULL, indexed |
| user_id | UUID | FK → profiles.id |
| role | ENUM(ChatRole) | NOT NULL |
| message_type | ENUM(MessageType) | NOT NULL, default 'text' |
| content | JSONB | NOT NULL, default {} |
| created_at | TIMESTAMPTZ | server_default now() |
| updated_at | TIMESTAMPTZ | server_default now() |

**ChatRole:** user, assistant, system
**MessageType:** text, tool_call, search_results, proposal, confirmation

#### `clients`
| Kolom | Tipe | Constraint |
|-------|------|-----------|
| id | UUID | PK |
| code | VARCHAR(20) | UNIQUE, NOT NULL |
| name | VARCHAR(255) | NOT NULL |
| is_active | BOOLEAN | NOT NULL, default true |
| created_at | TIMESTAMPTZ | server_default now() |
| updated_at | TIMESTAMPTZ | server_default now() |

#### `clients_projects` (tabel Project)
| Kolom | Tipe | Constraint |
|-------|------|-----------|
| id | UUID | PK |
| code | VARCHAR(20) | UNIQUE, NOT NULL |
| name | VARCHAR(255) | NOT NULL |
| client_id | UUID | FK → clients.id, NOT NULL, indexed |
| is_active | BOOLEAN | NOT NULL, default true |
| created_at | TIMESTAMPTZ | server_default now() |
| updated_at | TIMESTAMPTZ | server_default now() |

#### `dcc_activity_log`
| Kolom | Tipe | Constraint |
|-------|------|-----------|
| id | UUID | PK |
| profile_id | UUID | FK → profiles.id (CASCADE) |
| action | ENUM(DccAction) | NOT NULL |
| detail | VARCHAR(500) | NOT NULL |
| created_at | TIMESTAMPTZ | server_default now() |

**DccAction:** upload, access_request

#### Workspace Tables

**`project_templates`**: id, name (UNIQUE), description, created_at, updated_at

**`phase_templates`**: id, template_id (FK → project_templates.id CASCADE), name, order, estimated_days, created_at, updated_at

**`task_templates`**: id, phase_template_id (FK → phase_templates.id CASCADE), name, estimated_days, default_role, order, created_at, updated_at

**`workspace_projects`**: id, name, client_name, template_id (FK → project_templates.id SET NULL), start_date, deadline, status (planning/active/on_hold/completed), manager_id (FK → profiles.id SET NULL), description, created_at, updated_at

**`workspace_phases`**: id, project_id (FK → workspace_projects.id CASCADE), name, order, start_date, deadline, status (pending/active/completed), created_at, updated_at

**`workspace_tasks`**: id, phase_id (FK → workspace_phases.id CASCADE), name, assigned_to (FK → profiles.id SET NULL), deadline, status (todo/in_progress/done/overdue), notes, order, created_at, updated_at

**`task_completions`**: id, task_id (FK → workspace_tasks.id CASCADE), submitted_by (FK → profiles.id CASCADE), photo_url, notes, completed_at (server_default now()), created_at, updated_at

### 4.3 Migrasi Alembic

| Revisi | Deskripsi |
|--------|-----------|
| 2dd21eb2162c | Create all tables (profiles, chat_messages, documents, upload_queue, access_requests, approvals) |
| a6c135352c84 | Add profiles FK to auth users |
| c7d3f8e2a1b9 | Add is_active to profiles |
| d8f4a1b2c905 | Add username and role_permissions tables |
| 178dedd5c04f | Add clients, projects tables and client FK on documents |
| f2a3b4c5d6e7 | Add dcc_activity_log |
| a1b2c3d4e5f6 | Add note and sequence to documents |
| e1b2f3a4c5d6 | Add indexing and cancelled to upload status |
| g9h1i2j3k4l5 | Add workspace tables (7 tabel + 3 enum types + permission rows) |

---

## 5. Integrasi Eksternal

### 5.1 Google Drive

- **OAuth 2.0** dengan token refresh (mendukung `GOOGLE_TOKEN_JSON` env var untuk cloud)
- **Folder hierarchy:** `ROOT/Client/Project/` — setiap klien punya folder, setiap proyek punya subfolder
- **Fungsi:** `upload_file()`, `create_folder()`, `find_or_create_folder()`, `rename_file()`, `get_file()`, `delete_file()`, `move_file()`, `build_folder_path()`
- **File rename saat confirm:** Format `TYPE-SEQ-CLIENT-TITLE-PROJECT-NOTE.ext`
- **Cleanup:** File proposal yang expired dihapus otomatis oleh background task

### 5.2 Google Sheets

- **Private spreadsheet** per doc type (tab DRW, INV, PO, dll.) dengan headers: Nomor Urut, Nama Full Klien, Nama Projek, Nama File, Note, Path Lengkap, Link Drive, User Upload, Kapan
- **Public spreadsheet** ("Index Publik") dengan headers terbatas: Jenis, Nomor Urut, Kode Klien, Projek, Nama File, Note
- **Fungsi:** `add_document_row()`, `add_document_row_safe()`, `update_document_row()`, `search_documents()`, `get_public_index_url()`, `get_public_index_count()`, `delete_document_row()`

### 5.3 Ollama (NimBus AI)

- **Model default:** `glm-5.1:cloud` (bisa dikonfigurasi via `OLLAMA_MODEL`)
- **System prompt:** Bahasa Indonesia, asisten kontrol dokumen
- **Tool definitions:** `search_documents` (query, doc_type, limit) dan `request_access` (document_id, reason)
- **Streaming:** SSE events (text, tool_call, search_results, confirmation, done)
- **Health check:** `GET /api/tags` untuk cek ketersediaan Ollama

### 5.4 Supabase Auth

- **JWT verification:** Mendukung HS256 (JWT secret) dan ES256 (JWKS dari Supabase)
- **JWKS caching:** One-time fetch, disimpan di memory
- **Admin API:** Digunakan untuk create user, reset password

### 5.5 SMTP (Gmail)

- **Host:** smtp.gmail.com:587 (TLS)
- **Fungsi:** `send_email()`, `send_access_approved_email()`, `send_access_denied_email()`, `send_document_uploaded_email()`
- **Template:** HTML dalam Bahasa Indonesia

---

## 6. Autentikasi & Otorisasi

### 6.1 Login Flow

```
User → /login (masukkan username + password)
  │
  ├─ usernameToEmail(username) → "username@rein.internal"
  │
  ├─ supabase.auth.signInWithPassword({ email, password })
  │    ├─ Success → redirect ke /dashboard
  │    └─ Failure → tampilkan error
  │
  └─ Middleware memvalidasi session di setiap request
       └─ useAuth() fetch profile dari /api/auth/me
            └─ PermissionsProvider fetch matrix dari /api/permissions/
```

### 6.2 Permission Matrix

| Role | dashboard:view | dcc:* | workspace:* | admin:* |
|------|:-:|:-:|:-:|:-:|
| admin | ✓ | ✓ (all) | ✓ (view, manage, complete) | ✓ |
| director | ✓ | ✓ (view, upload, search, approve, manage_access, chat) | ✓ (view, manage) | ✗ |
| manager | ✓ | ✓ (view, upload, search, manage_clients, chat) | ✓ (view, manage) | ✗ |
| operational_manager | ✓ | ✓ (view, upload, search, chat) | ✓ (view, manage) | ✗ |
| engineer_mechanical | ✓ | ✓ (view, chat) | ✓ (view, complete_task) | ✗ |
| engineer_process | ✓ | ✓ (view, chat) | ✓ (view, complete_task) | ✗ |
| engineer_electrical | ✓ | ✓ (view, chat) | ✓ (view, complete_task) | ✗ |
| finance | ✓ | ✓ (view) | ✓ (view) | ✗ |
| accounting | ✓ | ✓ (view) | ✓ (view) | ✗ |
| human_resources | ✓ | ✓ (view) | ✓ (view) | ✗ | ✗ |
| purchasing | ✓ | ✓ (view) | ✓ (view) | ✗ |

### 6.3 require_permission() Dependency

```python
# Backend: router dependency
@router.get("/projects", dependencies=[Depends(require_permission("workspace:view"))])

# Frontend: component guard
<PageGuard permission="workspace:view">
  {/* content hanya untuk user dengan permission */}
</PageGuard>

# Frontend: hook
const canManage = useCan(role as AppRole, "workspace:manage");
```

---

## 7. Alur Kerja (Workflow)

### 7.1 Upload Dokumen (DCC)

```
1. User pilih file → POST /api/upload/
   ├─ Upload ke Google Drive (folder sementara)
   ├─ Deteksi metadata (hybrid: regex + DB + LLM)
   └─ Return proposal (TTL 30 menit)

2. User konfirmasi/edit → POST /api/upload/{id}/confirm
   ├─ Validasi metadata
   ├─ Hitung nomor dokumen (TYPE-SEQ)
   ├─ Pindahkan file ke folder klien/proyek di Drive
   ├─ Rename file ke format REIN
   ├─ Buat record Document di DB
   ├─ Indeks ke Google Sheets (tab doc type)
   └─ Buat ApprovalRequest jika perlu

3. User batal → DELETE /api/upload/{id}
   ├─ Hapus file dari Drive
   └─ Mark queue entry sebagai cancelled

4. Background: Cleanup expired proposals setiap 300 detik
   └─ Hapus file Drive yang sudah expired
```

### 7.2 Approval Workflow

```
1. Dokumen diupload → status: "draft"
2. Admin/Director buat approval request → status: "pending_review"
3. Approver buka /approvals
   ├─ Approve → status: "approved"
   └─ Reject (dengan komentar) → status: "rejected"
4. Dokumen bisa di-arsip → status: "archived"
```

### 7.3 Access Request Workflow

```
1. User request akses → POST /api/access/request
2. Manager buka /dcc/access
   ├─ Approve → generate temp_token (15 menit expiry) + kirim email
   └─ Deny → kirim email penolakan
3. User klik link di email → GET /api/access/{token}
   └─ Return download URL jika valid dan belum expired
```

### 7.4 Workspace Workflow

```
1. Manager buat proyek (opsional: dari template)
   └─ Jika pilih template: auto-create phases + tasks dari template

2. Manager assign task ke engineer
   └─ PUT /api/workspace/tasks/{id} { assigned_to: user_id }

3. Engineer melihat tugas di "My Tasks"
   └─ GET /api/workspace/my-tasks

4. Engineer tandai selesai
   └─ POST /api/workspace/tasks/{id}/complete { photo_url, notes }

5. Manager lihat progress di Gantt/Kanban
   └─ GET /api/workspace/summary
```

### 7.5 AI Chat (NimBus) Flow

```
1. User kirim pesan → POST /api/chat/
2. Backend buat/create conversation (jika belum ada)
3. Stream request ke Ollama dengan system prompt + tools
4. Ollama respons:
   ├─ Text biasa → stream ke client (SSE event: "text")
   ├─ Tool call: search_documents → eksekusi query → return hasil (SSE event: "search_results")
   └─ Tool call: request_access → buat AccessRequest → return konfirmasi (SSE event: "confirmation")
5. Semua message disimpan di chat_messages (JSONB content)
```

---

## 8. Design System & CSS

### 8.1 Design Tokens

File utama: `frontend/src/styles/globals.css`

**Warna Primary (Light → Dark):**
| Token | Light | Dark | Kegunaan |
|-------|-------|------|----------|
| `--rein-primary` | #714B67 | #a678a0 | Aksen utama (plum/purple) |
| `--rein-primary-hover` | #5e3d56 | #c08dba | Hover state |
| `--rein-primary-mid` | rgba(113,75,103,0.4) | rgba(166,120,160,0.3) | Border primary |
| `--rein-primary-bg` | rgba(113,75,103,0.08) | rgba(166,120,160,0.1) | Background primary |
| `--rein-bg` | #ffffff | #1e1e2d | Background utama |
| `--rein-bg-sidebar` | #f4f5f7 | #181826 | Background sidebar |
| `--rein-bg-hover` | #f0f1f3 | #262640 | Hover background |
| `--rein-bg-sel` | #e8e9eb | #32324a | Selected background |
| `--rein-bg-stripe` | #f8f8fa | #1e1e2d | Stripe (alternating rows) |
| `--rein-text` | #212529 | #e6e6f0 | Text utama |
| `--rein-text-muted` | #6c757d | #7878a0 | Text secondary |
| `--rein-text-light` | #b0b8c4 | #5c5c78 | Text tertiary |
| `--rein-border` | #e0e2e6 | rgba(255,255,255,0.09) | Border |
| `--rein-border-soft` | #e8e9eb | rgba(255,255,255,0.05) | Border subtle |

**Warna Semantik:**
| Token | Light | Dark | Kegunaan |
|-------|-------|------|----------|
| `--rein-green` | #28a745 | #4caf50 | Success |
| `--rein-green-bg` | #e8f5e9 | rgba(76,175,80,0.1) | Success background |
| `--rein-amber` | #e67e00 | #ff9800 | Warning |
| `--rein-amber-bg` | #fff3e0 | rgba(255,152,0,0.1) | Warning background |
| `--rein-red` | #dc3545 | #f44336 | Error |
| `--rein-red-bg` | #fde8ea | rgba(244,67,54,0.08) | Error background |
| `--rein-blue` | #0d6efd | #42a5f5 | Info |
| `--rein-blue-bg` | #e3f2fd | rgba(66,165,245,0.1) | Info background |

**Layout Constants:**
| Token | Value | Kegunaan |
|-------|-------|----------|
| `--topbar-h` | 46px | Tinggi top bar |
| `--ctrl-h` | 46px | Tinggi control bar |
| `--sidebar-w` | 224px | Lebar sidebar desktop |
| `--r` | 6px | Border radius default |
| `--r-lg` | 8px | Border radius large |
| `--r-xl` | 12px | Border radius extra large |
| `--r-pill` | 999px | Border radius pill |
| `--tr` | 140ms ease | Transition duration |

**Typography:**
- Sans: `DM Sans` (weights: 300–700)
- Mono: `JetBrains Mono` (code blocks)

### 8.2 CSS Utility Classes

```css
/* Buttons */
.btn { /* base button styles */ }
.btn-primary { background: var(--rein-primary); color: white; }
.btn-default { background: var(--rein-bg); border: 1px solid var(--rein-border); }
.btn-sm { padding: 4px 10px; font-size: 12px; }
.btn-xs { padding: 2px 8px; font-size: 11px; }
.btn-icon { width: 32px; height: 32px; padding: 0; }

/* Badges */
.badge { /* base badge */ }
.badge-green, .badge-amber, .badge-red, .badge-blue, .badge-purple, .badge-muted { /* colored badges */ }

/* View toggle */
.ctrl-view-btn { width: 30px; height: 30px; border-radius: var(--r); /* ... */ }
.ctrl-view-btn:hover { background: var(--rein-bg-hover); }
.ctrl-view-btn.active { background: var(--rein-primary-bg); color: var(--rein-primary); }
```

### 8.3 Dark Mode

- Diaktifkan via `data-theme="dark"` pada `<html>` element
- `ThemeProvider` menyimpan preferensi di localStorage
- Semua CSS custom properties memiliki nilai light dan dark

---

## 9. Deployment & Infrastruktur

### 9.1 Arsitektur Deployment

```
Vercel (Frontend)
  └─ Next.js 16.2.6 + Turbopack
  └─ Environment: NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, NEXT_PUBLIC_API_URL

VPS/Coolify (Backend)
  └─ FastAPI + Uvicorn (2 workers)
  └─ Environment: DATABASE_URL, SUPABASE_*, GOOGLE_*, OLLAMA_*, SMTP_*
  └─ Systemd service: rein-backend.service

Supabase (Auth + PostgreSQL)
  └─ Pooler connection: aws-1-ap-southeast-1.pooler.supabase.com
  └─ SSL mode: require
```

### 9.2 Docker

```dockerfile
FROM python:3.11-slim
WORKDIR /app
COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY backend/ .
COPY db/ .
ENV PYTHONPATH=/app
EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
```

### 9.3 VPS Setup

Script `deploy/setup-vps.sh`:
- Ubuntu 22.04
- Python 3.11
- Virtual environment di `/opt/rein/backend/venv`
- Systemd service: `rein-backend.service`
- Alembic migration dijalankan saat setup

---

## 10. Environment Variables

### Backend (.env)

```bash
# Supabase
NEXT_PUBLIC_SUPABASE_URL=https://xxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_ROLE_KEY=eyJ...
SUPABASE_JWT_SECRET=...

# Database
DATABASE_URL=postgresql+asyncpg://postgres.xxx:password@aws-1-ap-southeast-1.pooler.supabase.com:5432/postgres

# FastAPI
API_SECRET_KEY=dev-secret-key
API_PORT=8000
CORS_ORIGINS=http://localhost:3000,https://your-domain.com

# Google OAuth
GOOGLE_CLIENT_ID=xxx.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=GOCSPX-xxx
GOOGLE_TOKEN_PATH=credentials/token.json
GOOGLE_CREDENTIALS_PATH=credentials/credentials.json
GOOGLE_DRIVE_ROOT_FOLDER_ID=1xxx...
GOOGLE_SHEETS_SPREADSHEET_ID=1xxx...
GOOGLE_SHEETS_PUBLIC_SPREADSHEET_ID=1xxx...

# Ollama
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_MODEL=glm-5.1:cloud
OLLAMA_API_KEY=

# SMTP
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your@gmail.com
SMTP_PASSWORD=app-password
SMTP_FROM=your@gmail.com

# Frontend
NEXT_PUBLIC_API_URL=http://localhost:8000

# Admin (for seed script)
ADMIN_USERNAME=admin
ADMIN_PASSWORD=changeme
```

### Frontend (.env.local)

```bash
NEXT_PUBLIC_SUPABASE_URL=https://xxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
NEXT_PUBLIC_API_URL=http://localhost:8000
```

---

*Dokumentasi ini terakhir diperbarui pada 15 Mei 2026.*