# Modul 05 — Modul Dorman (kode hidup, tidak terpanggil)

Modul-modul di berkas ini **ter-mount di FastAPI, muncul di OpenAPI, dan bisa
dipanggil siapa pun yang punya token + izin** — tapi tidak ada satu pun
pemanggil di frontend produksi.

Total **2.593 baris backend** dan **34 dari 152 endpoint** (22%), plus
tabel-tabel pendampingnya.

Dokumen ini ada supaya: (a) tidak ada yang menghapusnya tanpa tahu isinya,
dan (b) kalau salah satunya mau dihidupkan lagi, jalurnya sudah terpetakan.

## Ringkasan

| Modul | Baris | Endpoint | Tabel | Alasan dorman |
|---|---:|---:|---|---|
| DCC lama — `documents.py` | 342 | 6 | `documents` | Digantikan `library_files` |
| DCC lama — `upload.py` | 503 | 4 | `upload_queue`, `documents` | Digantikan `library/upload_flow.py` |
| Pipeline audit — `audit_pipeline.py` | 387 | — | `audit_jobs` | `TaskType.AUDIT_FILE` tidak pernah di-enqueue |
| NimBus AI — `nimbus.py` + `chat.py` | 463 | 2 | `chat_messages` | `hooks/use-chat-stream.ts` orphan; tidak ada UI chat |
| Akses dokumen — `access.py` | 228 | 5 | `access_requests` | `lib/api/access.ts` orphan; digantikan `view_requests` |
| Persetujuan — `approvals.py` | 129 | 3 | `approvals` | `lib/api/approvals.ts` orphan; halaman `/approvals` pakai mock |
| Klien — `clients.py` | 115 | 4 | `clients` | `lib/api/clients.ts` orphan |
| Proyek klien — `projects.py` | 134 | 4 | `clients_projects` | idem (ekspor dari berkas yang sama) |
| Antrean — `queue.py` | 103 | 2 | `upload_queue` | Tidak ada pemanggil |
| Dashboard — `dashboard.py` | 105 | 2 | `documents`, `approvals` | Halaman dashboard pakai `/api/workspace/summary` |
| Log aktivitas DCC — `dcc_activity.py` | 84 | 2 | `dcc_activity_log` | `lib/api/dcc-activity.ts` orphan |

---

## 1. DCC lama — `documents.py` + `upload.py`

### Kenapa ada

Ini adalah generasi pertama Document Control, sebelum redesign jadi
Perpustakaan Digital. Perbandingannya:

| Aspek | DCC lama | Perpustakaan Digital |
|---|---|---|
| Tabel utama | `documents` | `library_files` |
| Alur | propose (upload ke Drive dulu) → confirm → cancel | propose (metadata saja) → upload |
| Antrean | `upload_queue` (server-side, TTL 30 menit) | IndexedDB (client-side) |
| Izin | `dcc:upload` saja | `folder_permissions` granular |
| Struktur | `folder_path` string | `library_folders` berhierarki |

Perbedaan paling penting: **DCC lama mengunggah ke Drive lebih dulu, baru
minta konfirmasi metadata.** Kalau user membatalkan, file harus dihapus dari
Drive. Perpustakaan Digital membalik urutannya — metadata dulu, byte belakangan
— sehingga pembatalan tidak meninggalkan sampah.

### Layer 1 — Database

**`documents`** — `doc_number` (unik), `doc_type` (enum `DocType`), `title`,
`description`, `client_*`, `project_*`, `folder_path`, `file_*`, `gdrive_*`,
`sheets_row_id`, `doc_sequence`, `note`, `status` (enum `DocStatus`),
`version`, `uploaded_by`, `approved_by`.
Indeks: `doc_number`, `doc_type`, `status`, `uploaded_by`.

**`upload_queue`** — proposal sementara. `status` (`awaiting_confirmation`,
`indexing`, `cancelled`, dst.), `proposal_expires_at`, `gdrive_file_id`.

> `upload_queue` masih disentuh runtime: `_cleanup_expired_proposals` di
> `task_queue.py` di-enqueue **setiap 5 menit** dan menjalankan `SELECT` ke
> tabel yang selalu kosong. Biaya kecil tapi nyata.

### Layer 3 — API Route

`documents.py`

| Method | Path | Izin |
|---|---|---|
| GET | `/api/documents/stats` | `dcc:view` |
| GET | `/api/documents/` | `dcc:view` |
| GET | `/api/documents/search` | `dcc:view` + `dcc:search` |
| GET | `/api/documents/{id}` | `dcc:view` |
| POST | `/api/documents/` | `dcc:upload` |
| PATCH | `/api/documents/{id}` | `dcc:upload` |

`upload.py`

| Method | Path | Izin |
|---|---|---|
| POST | `/api/upload/` | `dcc:upload` |
| POST | `/api/upload/{id}/confirm` | `dcc:upload` |
| DELETE | `/api/upload/{id}` | `dcc:upload` |
| GET | `/api/upload/proposals` | `dcc:upload` |

Konstanta: `MAX_FILE_SIZE = 50 MB`, `PROPOSAL_TTL = 30 menit`,
`ALLOWED_EXTENSIONS` (sama dengan Perpustakaan Digital), `MIME_MAP`.

### Kalau mau dihapus

Aman menghapus `documents.py` + `upload.py` + `queue.py` sekaligus, plus
`include_router` di `main.py`. Tabel `documents`, `upload_queue`, dan
`access_requests`/`approvals` (yang ber-FK ke `documents`) harus dihapus dalam
satu migrasi — **cek isinya di produksi dulu**, mungkin ada arsip lama di sana.

---

## 2. Pipeline audit 4-lapis — `audit_pipeline.py`

Rancangan yang matang tapi tidak pernah dinyalakan.

| Lapis | Nama | Cek |
|---|---|---|
| 1 | `format_name` | nama file cocok konvensi `{TYPE}-{NUM}-{CLIENT} judul.ext` |
| 2 | `path` | folder tujuan ada dan aktif |
| 3 | `duplicate` | tidak ada file dengan SHA-256 atau nama sama di folder yang sama |
| 4 | `content_ai` | Ollama memverifikasi konsistensi tipe/metadata (non-blocking) |

Fungsi tambahan: `_move_to_final_folder`, `_enqueue_sheets_index`,
`_summarise_jobs`.

**Kenapa mati:** `upload_flow.py` menyetel status file langsung ke `passed`
setelah upload Drive berhasil. `TaskType.AUDIT_FILE` terdefinisi di
`task_queue.py` dan punya handler, tapi tidak ada satu pun `enqueue` di seluruh
repo.

**Konsekuensi yang terlihat:** status `LibraryFileStatus.in_audit` tidak pernah
tercapai, tapi tetap dicek `_flip_stuck_uploads` di `main.py`. Tabel
`audit_jobs` kosong. Endpoint `GET /api/library/files/{id}/status` selalu
mengembalikan `audit_layers: []`.

**Kalau mau dihidupkan:** cukup `task_queue.enqueue(TaskType.AUDIT_FILE,
{"file_id": str(lib_file.id)})` setelah upload Drive sukses, dan ubah status
awal jadi `in_audit` alih-alih `passed`. Lapis 3 (`_check_duplicate`) akan
langsung berguna — sekarang deteksi duplikat hanya ada di `propose`, bukan di
`upload`, jadi dua orang bisa mengunggah file identik bersamaan.

---

## 3. NimBus AI — `chat.py` + `nimbus.py`

Chat AI berbasis Ollama dengan tool use.

### Layer 2 — Backend

`services/nimbus.py` (409 baris) memakai endpoint kompatibel-OpenAI milik
Ollama, streaming, dengan function calling untuk dua tool:
`search_documents` dan `request_access`.

Konfigurasi: `OLLAMA_BASE_URL`, `OLLAMA_MODEL` (default `glm-5.1:cloud` di
`config.py` — tapi `.env.example` menulis `llama3`), `OLLAMA_API_KEY`.

### Layer 3 — API Route

| Method | Path | Izin |
|---|---|---|
| POST | `/api/chat/` | `dcc:chat` |
| GET | `/api/chat/status` | `dcc:chat` |

### Layer 1 — Database

`chat_messages` — `conversation_id`, `user_id`, `role` (enum `ChatRole`),
`message_type` (enum `MessageType`), `content` JSONB. Indeks komposit
`(conversation_id, created_at)`.

**Tabel ini tidak pernah ditulis.** `chat.py` melakukan streaming langsung
tanpa persistensi. Riwayat percakapan hilang saat halaman ditutup.

### Layer 4 — Frontend

`hooks/use-chat-stream.ts` — mem-parse SSE dari `POST /api/chat/`.
**Tidak di-import komponen mana pun.** Tidak ada UI chat di aplikasi.

Izin `dcc:chat` diberikan ke 10 dari 11 role yang punya default — untuk fitur
yang tidak punya antarmuka.

---

## 4. Akses dokumen — `access.py`

Pendahulu `view_requests` di Perpustakaan Digital.

| Method | Path | Izin |
|---|---|---|
| POST | `/api/access/request` | `dcc:view` |
| GET | `/api/access/pending` | `dcc:manage_access` |
| **GET** | **`/api/access/{token}`** | **tanpa autentikasi sama sekali** |
| POST | `/api/access/{id}/approve` | `dcc:manage_access` |
| POST | `/api/access/{id}/deny` | `dcc:manage_access` |

> ⚠ `GET /api/access/{token}` adalah satu-satunya endpoint **tanpa dependency
> auth apa pun** di seluruh backend. Siapa pun yang punya token bisa menukarnya
> jadi `download_url`. Itu memang desainnya (link sementara dari email), dan
> token-nya `secrets`-grade — tapi kalau modul ini dihapus, celah ini ikut
> hilang; kalau dipertahankan, ini yang harus paling dulu diaudit.

Tabel `access_requests`: `document_id`, `requested_by`, `reason`, `status`
(enum `AccessStatus`), `approved_by`, `expires_at`, `temp_token` (unik),
`acted_at`.

Pembersih `_revoke_expired_access` di `task_queue.py` masih dijalankan tiap
5 menit terhadap tabel ini.

---

## 5. Persetujuan dokumen — `approvals.py`

| Method | Path | Izin |
|---|---|---|
| GET | `/api/approvals/pending` | `dcc:approve` |
| POST | `/api/approvals/{id}/approve` | `dcc:approve` |
| POST | `/api/approvals/{id}/reject` | `dcc:approve` |

Tabel `approvals`: `document_id`, `requested_by`, `assigned_to`, `action`
(enum `ApprovalAction`), `comment`, `acted_at`.

### ⚠ Yang membuat modul ini berbeda dari yang lain di daftar ini

Backend-nya dorman, tapi **halaman `/approvals` ada di navigasi produksi** dan
terbuka untuk pemegang `dcc:approve` — dengan **data palsu**:

`frontend/src/app/(app)/approvals/page.tsx`
- baris 26: `const MOCK_APPROVALS: MockApproval[] = [...]`
- baris 158: `useState<MockApproval[]>(MOCK_APPROVALS)`
- nol panggilan API

Pengguna nyata (Director, Manager, Finance, Operational Manager) melihat
antrian berisi "DRW-PLB-0041 — Gambar Teknik Pile Cap Dermaga Palembang" yang
diminta "Budi Santoso" — dokumen dan orang yang tidak ada.

**Ini prioritas tertinggi di seluruh audit** bukan karena teknis, tapi karena
satu-satunya temuan yang secara aktif menyesatkan pengguna. Dua pilihan:

- **Sambungkan** — `lib/api/approvals.ts` sudah lengkap, tinggal dipakai.
  Tapi backend-nya memakai tabel `approvals` yang ber-FK ke `documents`
  (DCC lama), jadi perlu diarahkan ulang ke `library_files`.
- **Kunci** — tambahkan `approvals: false` ke `FEATURES` di
  `lib/feature-flags.ts` dan bungkus halamannya dengan `<LockedFeature />`,
  sama seperti Dashboard dan Workspace. Lima menit kerja.

---

## 6. Klien & Proyek — `clients.py` + `projects.py`

Ini kasus paling halus di daftar ini: **API-nya dorman, tapi tabelnya hidup.**

| Method | Path | Izin |
|---|---|---|
| GET | `/api/clients/` | `dcc:view` |
| POST / PATCH | `/api/clients/`, `/api/clients/{id}` | `dcc:manage_clients` |
| PATCH | `/api/clients/{id}/deactivate` | `dcc:manage_clients` |
| GET | `/api/projects/` | `dcc:view` |
| POST / PATCH | `/api/projects/`, `/api/projects/{id}` | `dcc:manage_clients` |
| PATCH | `/api/projects/{id}/deactivate` | `dcc:manage_clients` |

Tabel `clients` (`code` unik, `name`, `is_active`) dan `clients_projects`
(`code` unik, `name`, `client_id` FK, `is_active`) **dibaca aktif** oleh
`services/metadata.py` saat deteksi metadata nama file — itulah yang mengisi
`client_name/code` dan `project_name/code` di kartu upload.

Yang orphan hanya pemanggilnya: `lib/api/clients.ts` mengekspor
`clientsApi` **dan** `projectsApi`, tapi berkas itu tidak di-import komponen
mana pun.

**Akibat praktis:** tidak ada cara di UI untuk menambah klien atau proyek baru.
Deteksi metadata hanya bisa mengenali klien yang di-seed lewat
`db/seed.py:seed_clients_and_projects()`. Klien baru = jalankan SQL manual.

Izin `dcc:manage_clients` dimiliki Director dan Manager — untuk fitur yang
tidak punya tombol.

> Ini **bukan** kandidat hapus. Ini kandidat **sambung**: endpoint-nya sudah
> jadi, klien API-nya sudah jadi, tinggal satu tab di halaman Admin.

---

## 7. Log aktivitas DCC — `dcc_activity.py`

| Method | Path | Izin |
|---|---|---|
| POST | `/api/dcc/activity` | `dcc:view` |
| GET | `/api/dcc/activity` | `dcc:view` |

Tabel `dcc_activity_log`: `profile_id`, `action` (enum `DccAction`),
`detail` (String(500)), `created_at`. Indeks `profile_id` dan `created_at`.

Pemanggilnya `lib/api/dcc-activity.ts` orphan. Tabel tidak pernah ditulis.

Ini **berbeda** dari `library_audit_log` yang aktif dan lengkap — jadi
kehilangannya tidak menciptakan lubang jejak audit di Perpustakaan Digital.

---

## 8. Antrean & Dashboard

**`queue.py`** — `GET /api/queue/status`, `GET /api/queue/stats`, izin
`dcc:upload`. Membaca `upload_queue`. Digantikan panel antrean sisi klien
(`upload-queue-panel.tsx` + IndexedDB).

**`dashboard.py`** — `GET /api/dashboard/stats`, `GET /api/dashboard/activity`,
izin `dashboard:view`. Mengagregasi `documents` + `approvals`.

Halaman `app/(app)/dashboard/page.tsx` **tidak memanggilnya** — halaman itu
memakai `workspaceApi.summary` (`/api/workspace/summary`), dan lagipula
terkunci feature flag (`dashboard: false`).

Jadi ada tiga lapis: halaman terkunci → yang memanggil endpoint modul lain →
sementara endpoint dashboard-nya sendiri menganggur.

---

## Rencana pembersihan

Urutan aman, satu langkah per commit supaya mudah di-rollback:

Urutan aman, satu langkah per commit supaya mudah di-rollback:

```
1. Kunci /approvals di feature-flags.ts     ← lakukan lebih dulu, terlepas dari sisanya
2. Hapus include_router untuk: documents, upload, queue, dashboard, chat, dcc_activity
3. Hapus berkas router + services/nimbus.py + services/audit_pipeline.py
4. Hapus TaskType.AUDIT_FILE + handler-nya di task_queue.py
5. Putuskan nasib access.py + approvals.py (hapus, atau sambungkan ke library_files)
6. SAMBUNG (jangan hapus) clients.py + projects.py — tambah tab di /admin
7. Hapus lib/api/{access,approvals,dcc-activity}.ts + hooks/use-chat-stream.ts
   (lib/api/clients.ts dipertahankan untuk langkah 6)
8. Migrasi: DROP TABLE audit_jobs, chat_messages, upload_queue,
            dcc_activity_log, access_requests, approvals, documents
   ← ekspor isinya lebih dulu; urutan drop harus mengikuti FK
   ← JANGAN drop clients / clients_projects: dipakai deteksi metadata
9. Hapus _cleanup_expired_proposals + _revoke_expired_access dari _periodic_cleanup
10. Perbarui TABLES di migrasi RLS supaya test_rls.py tetap hijau
```

Setelah selesai: backend turun ≈2.300 baris (menyisakan `clients`/`projects`),
permukaan API mengecil dari **152 endpoint ke ~120**, dan satu endpoint tanpa
autentikasi (`GET /api/access/{token}`) hilang.
