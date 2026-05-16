<div align="center">

# REIN

**Remula Inti Rekayasa** — Internal ERP & Document Control System

[![Next.js](https://img.shields.io/badge/Next.js-16-black?logo=next.js)](https://nextjs.org/)
[![FastAPI](https://img.shields.io/badge/FastAPI-0.111+-009688?logo=fastapi)](https://fastapi.tiangolo.com/)
[![Supabase](https://img.shields.io/badge/Supabase-Auth+%2B+PostgreSQL-3ECF8E?logo=supabase)](https://supabase.com/)
[![React](https://img.shields.io/badge/React-19-61DAFB?logo=react)](https://react.dev/)
[![Python](https://img.shields.io/badge/Python-3.11+-3776AB?logo=python)](https://python.org/)

[Overview](#overview) · [Arsitektur](#arsitektur) · [Fitur](#fitur) · [Setup](#setup) · [API](#api-endpoints) · [Database](#database-schema) · [Docs Lengkap](docs/REIN-Technical-Documentation.md)

</div>

---

## Overview

REIN adalah sistem ERP internal untuk perusahaan engineering Indonesia. Mengelola dokumen kontrol (DCC), workspace proyek, approval workflow, akses dokumen, dan asisten AI (NimBus) dalam satu platform.

```
┌──────────┐     ┌──────────────┐     ┌─────────────────────┐
│  Browser  │────▶│   Vercel     │────▶│   FastAPI Backend    │
│           │     │   Next.js 16 │     │   (VPS / Coolify)    │
└──────────┘     └──────────────┘     └──────┬──────────────┘
                                              │
                         ┌────────────────────┼──────────────────┐
                         │                    │                  │
                    ┌────▼────┐        ┌──────▼──────┐   ┌──────▼──────┐
                    │Supabase │        │Google Drive │   │   Ollama    │
                    │Auth + PG│        │  + Sheets   │   │  (NimBus)   │
                    └─────────┘        └─────────────┘   └─────────────┘
```

---

## Fitur

| Modul | Deskripsi |
|-------|-----------|
| **Dashboard** | KPI cards, aktivitas terbaru, ringkasan proyek & tugas per role |
| **DCC — Perpustakaan Digital** | File explorer berbasis departemen: rak dokumen per dept, etalase metadata publik, upload Propose→Confirm→Upload→Forget, audit 4-layer background, akses via request approval Pustakawan (email one-click) |
| **Workspace** | Manajemen proyek dengan 3 view: **Daftar**, **Gantt** (timeline read-only), **Kanban** (drag-and-drop board) |
| **Approvals** | Approval/reject dokumen dengan komentar |
| **Access Control** | Request akses dokumen, approval dengan token sementara (15 menit), notifikasi email |
| **NimBus AI** | Chat asisten berbasis Ollama dengan tool calls (search_documents, request_access) |
| **Admin** | Manajemen user, role & permission matrix, aktivasi/deaktivasi akun |

---

## Arsitektur

### Frontend (`frontend/`)

```
src/
├── app/
│   ├── (auth)/login/page.tsx          # Login (username → synthetic email)
│   ├── (app)/
│   │   ├── layout.tsx                 # Topbar + Sidebar + MobileNav
│   │   ├── dashboard/page.tsx         # KPI + manager/engineer views
│   │   ├── dcc/page.tsx               # Digital Library file explorer
│   │   ├── workspace/page.tsx         # List / Gantt / Kanban
│   │   ├── approvals/page.tsx         # Approval workflow
│   │   └── admin/page.tsx             # User management + permissions
│   └── middleware.ts                   # Auth guard (Supabase session)
├── features/
│   ├── workspace/
│   │   ├── store.ts                   # Zustand state
│   │   ├── gantt/                     # Timeline view + drill-down
│   │   ├── kanban/                    # Drag-and-drop board
│   │   └── shared/                    # Modals, badges, progress bars
│   └── library/
│       ├── folder-tree.tsx            # Sidebar rak departemen
│       ├── file-list.tsx              # Etalase metadata + aksi
│       ├── propose-modal.tsx          # Propose→Confirm→Upload flow
│       ├── upload-zone.tsx            # Drag-and-drop zone
│       └── types.ts                   # TypeScript interfaces
├── hooks/                             # useAuth, useSidebar, useIsMobile
├── lib/api/                            # ApiClient + typed endpoints
├── components/                         # UI primitives, guards, providers
└── styles/globals.css                 # Design token system (Odoo-inspired)
```

### Backend (`backend/`)

```
app/
├── main.py                  # FastAPI app, CORS, lifespan (task queue + cleanup)
├── config.py                # Settings from env vars
├── dependencies.py          # JWT auth, permission checks
├── routers/
│   ├── auth.py              # /api/auth
│   ├── documents.py         # /api/documents
│   ├── upload.py            # /api/upload (propose/confirm/cancel)
│   ├── approvals.py         # /api/approvals
│   ├── access.py            # /api/access
│   ├── chat.py              # /api/chat (SSE streaming)
│   ├── queue.py             # /api/queue
│   ├── dashboard.py         # /api/dashboard
│   ├── admin.py             # /api/admin
│   ├── permissions.py       # /api/permissions
│   ├── clients.py           # /api/clients
│   ├── projects.py          # /api/projects
│   ├── dcc_activity.py      # /api/dcc/activity
│   ├── workspace.py         # /api/workspace
│   └── library.py           # /api/library (Digital Library)
├── services/
│   ├── nimbus.py            # AI chat (Ollama, tool calls, SSE)
│   ├── gdrive.py            # Google Drive upload/organize
│   ├── gsheets.py           # Google Sheets indexing
│   ├── metadata.py          # Hybrid metadata detection (regex + DB + LLM)
│   ├── email.py             # SMTP email (Gmail)
│   ├── audit_pipeline.py    # 4-layer audit: format, path, duplicate, AI
│   └── task_queue.py        # Background task processor
└── schemas/                 # Pydantic request/response models
```

### Database (`db/`)

```
db/
├── alembic.ini              # Alembic config
├── alembic/env.py           # Migration environment (asyncpg → psycopg2)
├── models/                 # SQLAlchemy models
│   ├── base.py              # UUIDMixin, TimestampMixin
│   ├── profile.py           # profiles (username, role, is_active)
│   ├── document.py          # documents (8 doc types, 5 statuses)
│   ├── upload_queue.py      # upload_queue (7 statuses)
│   ├── approval.py          # approvals
│   ├── access_request.py    # access_requests (temp token, 15min)
│   ├── chat_message.py      # chat_messages (JSONB content)
│   ├── client.py            # clients + clients_projects
│   ├── role_permission.py   # role_permissions (17 permissions × 10 roles)
│   ├── dcc_activity_log.py  # dcc_activity_log
│   ├── workspace.py         # 7 workspace tables + 3 enum types
│   ├── library_folder.py    # library_folders (dept hierarchy)
│   ├── library_file.py      # library_files (lifecycle + audit status)
│   ├── audit_job.py         # audit_jobs (4 rows per file)
│   ├── view_request.py      # view_requests (5-min TTL + approve_token)
│   └── library_audit_log.py # library_audit_log (admin trail)
├── alembic/versions/        # 10 migration files
└── scripts/seed_library_folders.py  # Seed Drive folder IDs
└── seed.py                 # Seed script (admin, roles, sample data)
```

---

## API Endpoints

### Auth
| Method | Path | Deskripsi |
|--------|------|-----------|
| GET | `/api/auth/me` | Profil user saat ini |
| POST | `/api/auth/session` | Verifikasi session |

### Digital Library (`/api/library/`)
| Method | Path | Permission | Deskripsi |
|--------|------|------------|-----------|
| GET | `/api/library/tree` | dcc:view | Folder tree per departemen + file count |
| GET | `/api/library/folders/{id}/files` | dcc:view | Etalase metadata file (semua role) |
| POST | `/api/library/propose` | dcc:upload | Deteksi metadata dari nama file (no upload) |
| POST | `/api/library/upload` | dcc:upload | Upload multipart → 202, audit berjalan di background |
| GET | `/api/library/files/{id}/status` | dcc:upload | Poll status audit (4 layer) |
| POST | `/api/library/files/{id}/view-request` | dcc:view | Minta akses lihat isi file |
| GET | `/api/library/view-requests/{token}/approve` | — | One-click approval via email link |
| GET | `/api/library/view-requests/{token}/deny` | — | One-click deny via email link |
| GET | `/api/library/files/{id}/link` | dcc:view | Poll temp link setelah diapprove |
| DELETE | `/api/library/files/{id}` | admin | Soft delete file |
| GET | `/api/library/log` | admin | Audit trail lengkap |
| POST | `/api/library/folders` | admin | Buat subfolder |

### DCC — Approvals & Access (Legacy)
| Method | Path | Permission | Deskripsi |
|--------|------|------------|-----------|
| GET | `/api/documents/stats` | dcc:view | Statistik dokumen |
| GET | `/api/documents/` | dcc:view | List dokumen (filter, paginate) |
| GET | `/api/approvals/pending` | dcc:approve | List pending approvals |
| POST | `/api/approvals/{id}/approve` | dcc:approve | Approve dokumen |
| POST | `/api/approvals/{id}/reject` | dcc:approve | Reject dokumen |
| POST | `/api/access/request` | dcc:view | Request akses dokumen |
| POST | `/api/access/{id}/approve` | dcc:manage_access | Approve (generate temp token + email) |
| POST | `/api/access/{id}/deny` | dcc:manage_access | Deny (send email) |

### Workspace
| Method | Path | Permission | Deskripsi |
|--------|------|------------|-----------|
| GET | `/api/workspace/projects` | workspace:view | List proyek (assignment-filtered) |
| POST | `/api/workspace/projects` | workspace:manage | Buat proyek (opsional: dari template) |
| PUT | `/api/workspace/projects/{id}` | workspace:manage | Update proyek |
| GET | `/api/workspace/projects/{id}/phases` | workspace:view | List tahapan |
| POST | `/api/workspace/projects/{id}/phases` | workspace:manage | Buat tahapan |
| PUT | `/api/workspace/phases/{id}` | workspace:manage | Update tahapan |
| GET | `/api/workspace/phases/{id}/tasks` | workspace:view | List tugas |
| POST | `/api/workspace/phases/{id}/tasks` | workspace:manage | Buat tugas |
| PUT | `/api/workspace/tasks/{id}` | workspace:view* | Update tugas |
| POST | `/api/workspace/tasks/{id}/complete` | workspace:complete_task | Tandai selesai |
| GET | `/api/workspace/my-tasks` | workspace:view | Tugas user saat ini |
| GET | `/api/workspace/summary` | workspace:view | Dashboard summary |

### Admin
| Method | Path | Permission | Deskripsi |
|--------|------|------------|-----------|
| GET | `/api/admin/users` | admin | List semua user |
| POST | `/api/admin/users` | admin | Buat user |
| PATCH | `/api/admin/users/{id}/role` | admin | Update role |
| PATCH | `/api/admin/users/{id}/status` | admin | Aktifkan/nonaktifkan |
| GET | `/api/admin/permissions` | admin | Permission matrix |
| PUT | `/api/admin/permissions` | admin | Replace permission matrix |

---

## Database Schema

### ERD

```
auth.users (Supabase) ──1:1── profiles
                              │
       ┌──────────────────────┼────────────────────────┬──────────────────┐
       │                      │                        │                  │
  documents              upload_queue              workspace_projects  library_files
  (uploaded_by)         (user_id)                 (manager_id)       (uploader_id)
       │                      │                        │                  │
  approvals              chat_messages         workspace_phases     audit_jobs (4/file)
  access_requests         dcc_activity_log           │              view_requests
                                                 workspace_tasks    library_audit_log
                                                      │
                                                task_completions

clients ──1:N── clients_projects (Project)
role_permissions ── (role, permission) unique
project_templates ──1:N── phase_templates ──1:N── task_templates
library_folders ──1:N── library_folders (self-ref, subfolder)
library_folders ──1:N── library_files
```

### Permission Matrix

| Role | dcc:view | dcc:upload | dcc:approve | workspace:view | workspace:manage | workspace:complete_task | admin |
|------|:--------:|:----------:|:-----------:|:--------------:|:----------------:|:-----------------------:|:-----:|
| admin | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| director | ✓ | ✓ | ✓ | ✓ | ✓ | — | — |
| manager | ✓ | ✓ | — | ✓ | ✓ | — | — |
| operational_manager | ✓ | ✓ | — | ✓ | ✓ | — | — |
| engineer_* | ✓ | ✓ | — | ✓ | — | ✓ | — |
| finance / accounting / HR / purchasing | ✓ | — | — | ✓ | — | — | — |

> Lihat [dokumentasi lengkap](docs/REIN-Technical-Documentation.md) untuk detail semua tabel, kolom, tipe data, dan constraint.

---

## Design System

Token system Odoo 17-inspired dengan light/dark mode:

```css
/* Warna utama */
--rein-primary: #714B67;        /* Plum/purple aksen */
--rein-bg: #ffffff;             /* Background utama */
--rein-bg-sidebar: #f4f5f7;    /* Background sidebar */
--rein-text: #212529;           /* Text utama */
--rein-text-muted: #6c757d;    /* Text secondary */
--rein-border: #e0e2e6;        /* Border */

/* Semantic colors */
--rein-green / --rein-amber / --rein-red / --rein-blue  (+ -bg variants)

/* Layout */
--topbar-h: 46px;    --sidebar-w: 224px;    --ctrl-h: 46px;
--r: 6px;            --r-lg: 8px;           --r-pill: 999px;

/* Dark mode via [data-theme="dark"] pada <html> */
```

> Lihat [`frontend/src/styles/globals.css`](frontend/src/styles/globals.css) untuk semua token.

---

## Setup

### Prerequisites

- Node.js 18+ + bun/npm
- Python 3.11+
- Supabase project (Auth + PostgreSQL)
- Google Cloud project (Drive + Sheets API)
- Ollama (opsional, untuk NimBus AI)

### 1. Clone & Install

```bash
git clone https://github.com/Mungky/Rein.git
cd Rein

# Frontend
cd frontend && bun install && cd ..

# Backend
cd backend && pip install -r requirements.txt && cd ..
```

### 2. Environment Variables

```bash
# Salin dan isi
cp .env.example .env

# Variabel wajib:
DATABASE_URL=postgresql+asyncpg://...
NEXT_PUBLIC_SUPABASE_URL=https://xxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_ROLE_KEY=eyJ...
SUPABASE_JWT_SECRET=...
GOOGLE_CLIENT_ID=xxx
GOOGLE_CLIENT_SECRET=xxx
GOOGLE_DRIVE_ROOT_FOLDER_ID=xxx
GOOGLE_SHEETS_SPREADSHEET_ID=xxx

# Digital Library
LIBRARIAN_EMAILS=email1@domain.com,email2@domain.com  # Pustakawan approval notifications
```

### 3. Database Migration

```bash
cd db && alembic upgrade head && cd ..
```

### 4. Seed (Opsional)

```bash
cd db && python seed.py && cd ..

# Seed Drive folder IDs untuk Digital Library (setelah isi GOOGLE_DRIVE_*):
python db/scripts/seed_library_folders.py
```

### 5. Run

```bash
# Development (frontend + backend concurrently)
npm run dev

# Atau terpisah:
cd frontend && npm run dev        # http://localhost:3000
cd backend && uvicorn app.main:app --reload --port 8000  # http://localhost:8000
```

---

## Key Workflows

### Upload Dokumen — Digital Library

```
Pilih File → PROPOSE (deteksi metadata dari nama file, no upload)
  → User review/edit metadata → CONFIRM → UPLOAD ke Drive TEMP (202 langsung)
  → Background: Layer 1 format nama → Layer 2 path → Layer 3 duplicate SHA-256
               → Layer 4 AI content (Ollama, non-blocking)
  → Audit PASS → pindah ke folder final Drive
  → Audit FAIL → status failed, file tetap di TEMP
```

### Request Akses File

```
User klik "Lihat" → POST /view-request
  → Director / Admin → langsung dapat link sementara (30 menit)
  → Role lain → email dikirim ke Pustakawan (Director + Manager)
               → 1 Pustakawan klik Approve → link 30 menit digenerate
               → TTL 5 menit jika tidak ada yang approve → expired
```

### Approval

```
Dokumen (status: draft) → Manager buat approval request → status: pending_review
  → Approver APPROVE → status: approved
  → Approver REJECT (dengan komentar) → status: rejected
```

### Workspace

```
Manager buat proyek (opsional dari template)
  → Buat tahapan & tugas
  → Assign engineer ke tugas
  → Engineer tandai selesai (photo + notes)
  → Manager lihat progress di Gantt/Kanban
```

### NimBus AI Chat

```
User kirim pesan → Backend stream ke Ollama
  → Text biasa → stream ke client
  → Tool call: search_documents → query DB → return hasil
  → Tool call: request_access → buat AccessRequest → return konfirmasi
```

---

<div align="center">

**Dokumentasi lengkap:** [docs/REIN-Technical-Documentation.md](docs/REIN-Technical-Documentation.md)

</div>