# Modul 01 — Document Manager (Perpustakaan Digital / DCC)

Modul utama v1.0.0 dan landing page default (`/dcc`). Menyimpan dokumen
perusahaan di Google Drive, dengan metadata + izin + jejak audit di Postgres.

**Prinsip yang membedakannya dari file server biasa:** Drive adalah tempat
byte-nya; database adalah tempat *kebenaran* tentang byte itu (siapa, kapan,
di rak mana, siapa yang boleh). Kalau keduanya berselisih, database yang benar.

## Peta layer

| Fitur | Database | Backend | API Route | Frontend |
|---|---|---|---|---|
| Pohon folder | `library_folders`, `folder_permissions` | `_has_folder_perm` | `GET /tree` | `features/library/folder-tree.tsx` |
| Daftar file | `library_files` | `_file_meta` | `GET /folders/{id}/files` | `features/library/file-list.tsx` |
| Propose (deteksi metadata) | `file_types`, `clients`, `clients_projects` | `services/metadata.py` | `POST /propose` | `features/library/batch-upload-modal.tsx` |
| Upload | `library_files`, `document_sequences` | `services/gdrive.py` | `POST /upload` | `use-upload-queue.ts`, `upload-idb.ts` |
| Indexing ke Sheets | — | `services/gsheets.py`, `task_queue` | *(latar)* | — |
| Operasi file | `library_files` | `services/gdrive.py` | `DELETE/PATCH /files/{id}/*` | `file-list.tsx`, `move-modal.tsx` |
| Operasi folder | `library_folders` | `services/gdrive.py` | `POST /folders`, `PATCH/DELETE /folders/{id}` | `folder-actions.tsx` |
| Permintaan lihat | `view_requests` | `services/email.py`, `task_queue` | `POST /files/{id}/view-request` dst. | `app/(app)/dcc/access/page.tsx` |
| Index publik | `library_files` | `services/gsheets.py` | `GET /public-index`, `/public-list` | `features/library/public-index.tsx` |
| Panel Temp (admin) | `library_files` | — | `GET /admin/activity`, `POST /admin/purge-failed` | `features/library/temp-panel.tsx` |
| Izin folder (admin) | `folder_permissions` | — | `GET/PUT /admin/folder-permissions` | `features/admin/permissions-tab.tsx` |
| Jejak audit | `library_audit_log` | `_write_log` | `GET /log` | — |

Semua endpoint berprefiks `/api/library`.

---

## Layer 1 — Database

### `library_folders`

Hirarki rak. `parent_id` NULL = folder **root departemen**; di situlah izin
melekat.

| Kolom | Tipe | Catatan |
|---|---|---|
| `id` | UUID PK | |
| `parent_id` | UUID FK → self, null | NULL = root dept |
| `department` | String(50), index | slug, mis. `engineering` |
| `name` | String(255) | |
| `folder_type` | enum | `department` / `project` / `client` / `custom` |
| `path` | String(1000) | jalur manusia, mis. `Engineering/Proyek A` |
| `gdrive_folder_id` | String(100), null | tanpa ini upload ditolak 422 |
| `is_active` | bool | soft-delete |
| `created_by` | UUID FK → profiles | |

Konstanta pendamping di `db/models/library_folder.py`:
`DEPT_LABELS` (10 departemen), `DEPT_ROLE_MAP` (dept → role pemilik rak),
`LIBRARIAN_ROLES = {director, manager}`.

### `folder_permissions`

Matriks izin **granular** yang terpisah dari `role_permissions`.

| Kolom | Default |
|---|---|
| `folder_id` FK, `role` enum | — |
| `can_view` | true |
| `can_download` | true |
| `can_upload`, `can_rename`, `can_delete`, `can_move` | false |
| `can_create_folder`, `can_rename_folder`, `can_delete_folder` | false |

`UNIQUE (folder_id, role)`. Migrasi: `j4k5l6m7n8o9` → `k5l6m7n8o9p0`
(granular) → `m7n8o9p0q1r2` (subfolder).

> **Aturan yang mudah salah paham:** izin **hanya** dicek pada folder **root
> departemen**, lalu berlaku ke seluruh anak. `_has_folder_perm` mem-`JOIN`
> `LibraryFolder.parent_id IS NULL AND department = folder.department`. Baris
> `folder_permissions` untuk subfolder tidak berpengaruh apa-apa.

### `library_files`

| Kolom | Tipe | Catatan |
|---|---|---|
| `id` | UUID PK | |
| `folder_id` | UUID FK, null | |
| `original_name` | String(500) | nama saat diunggah |
| `file_name` | String(500), null | nama hasil format REIN |
| `doc_type` | String(10), null | kode dari `file_types` |
| **`doc_number`** | String(50), **unik** | **tidak pernah diisi** — lihat utang |
| `title`, `note` | | |
| `client_code/name`, `project_code/name` | | diisi deteksi metadata |
| `file_size` | BigInteger | |
| `mime_type` | String(100) | |
| `content_hash` | String(64), index | SHA-256, untuk deteksi duplikat |
| `gdrive_file_id` / `_folder_id` / `_web_link` | | |
| `upload_status` | enum | `uploading` → `in_audit` → `passed` / `failed` / `archived` / `cancelled` |
| `audit_results`, `proposal_metadata` | JSONB | |
| `uploader_id` | UUID FK | |
| `is_deleted` | bool | soft-delete |

Indeks: `folder_id`, `uploader_id`, `upload_status`, `content_hash`.

### `file_types`

Admin-editable. `code` (String(8)) adalah PK dan **immutable** setelah dibuat —
melindungi nomor arsip yang sudah terlanjur dipakai. `label`, `description`,
`is_active`, `sort_order` bebas diedit. Tidak pernah hard-delete, hanya
`is_active = false`.

### `document_sequences`

`doc_type` PK, `current_number` int. Dinaikkan dengan SQL mentah
`UPDATE ... RETURNING` (atomik), dengan fallback
`INSERT ... ON CONFLICT DO UPDATE` untuk tipe yang belum punya baris.

### `view_requests`

| Kolom | Catatan |
|---|---|
| `file_id`, `requester_id` | |
| `status` | `pending` / `approved` / `denied` / `expired` |
| `approve_token` | `secrets.token_urlsafe(32)` |
| `expires_at` | now + `VIEW_REQUEST_TTL_SECONDS` (5 menit) |
| `approved_by`, `approved_at` | |
| `temp_link`, `link_expires_at` | now + `LINK_TTL_MINUTES` (30 menit) |

### `library_audit_log`

Append-only. `id` BigInteger, `actor_id`, `action` (String(50)),
`target_type`, `target_id`, `metadata` JSONB (dipetakan ke atribut Python
`log_metadata` karena `metadata` bentrok dengan SQLAlchemy).
Aksi: `propose`, `upload`, `confirm`, `cancel`, `file_delete`, `folder_create`,
`move_file`, `rename_file`, `view_request`, `view_approved`, `view_denied`,
`view_expired`, `audit_pass`, `audit_fail`.

### Tabel milik modul ini yang **mati**

`audit_jobs` — 4 lapis pipeline audit. Tidak pernah ditulis (lihat Utang).

---

## Layer 2 — Backend (service)

### `services/gdrive.py` (520 baris)

Satu-satunya jalan ke Google Drive. OAuth 2.0 (bukan service account), token
dari `GOOGLE_TOKEN_JSON` (env, untuk cloud) atau `credentials/token.json`
(lokal).

Dua keputusan penting yang didokumentasikan di kode:

1. **Service dibangun baru per upload** (`_build_drive_service`) — bukan
   di-cache. Objek `httplib2.Http` memakai satu socket; upload paralel dengan
   service ter-cache menyebabkan tabrakan SSL.
2. **`_drive_call_with_retry`** — backoff eksponensial (5 percobaan, mulai 1 s)
   untuk: `HttpError` 408/429/5xx, `httplib2.RedirectMissingLocation` /
   `ServerNotFoundError` / `HttpLib2Error`, dan `ssl.SSLError` / `OSError` /
   `ConnectionError`. 4xx lain langsung dilempar.

Semua panggilan Google sinkron, dibungkus thread pool saat dipanggil dari async.

Operasi: `upload_file`, `create_folder`, `find_or_create_folder`, `rename_file`,
`rename_folder`, `get_file`, `delete_file`, `trash_file`, `trash_folder`,
`move_file`, `move_folder`, `build_folder_path`.

### `services/gsheets.py` (341 baris)

Index dokumen ke Google Sheets. Dua spreadsheet: privat per tipe dokumen
(`GOOGLE_SHEETS_SPREADSHEET_ID`) dan publik terbatas
(`GOOGLE_SHEETS_PUBLIC_SPREADSHEET_ID`).

### `services/metadata.py` (197 baris)

`detect_metadata_from_filename(filename, db)` → dataclass berisi
`doc_type`, `client_name/code`, `project_name/code`, `folder_path`, masing-masing
dengan skor `*_confidence`. Kombinasi regex + lookup ke `file_types`,
`clients`, `clients_projects`. Punya cache `file_types` yang di-invalidasi
oleh endpoint admin (`invalidate_file_types_cache`).

> ⚠ **Klien & proyek tidak bisa ditambah lewat UI.** Endpoint
> `/api/clients/*` dan `/api/projects/*` ada dan berfungsi, tapi klien
> frontend-nya (`lib/api/clients.ts`) tidak di-import komponen mana pun.
> Artinya deteksi metadata hanya mengenali klien yang di-seed lewat
> `db/seed.py`. Klien baru = SQL manual. Lihat
> [Modul 05 §6](05-modul-dorman.md#6-klien--proyek--clientspy--projectspy).

### `services/email.py` (97 baris)

SMTP Gmail via `aiosmtplib`. Fire-and-forget: gagal kirim dicatat, tidak pernah
memblokir alur utama. **Terpisah** dari `email_notifier.py` (Resend) yang
dipakai R-Net.

### `services/task_queue.py`

`asyncio.Queue` satu worker, sekuensial. Tipe tugas yang relevan modul ini:
`INDEX_TO_SHEETS`, `SEND_EMAIL`, `CLEANUP_EXPIRED_PROPOSALS`,
`CLEANUP_EXPIRED_VIEW_REQUESTS`, `AUDIT_FILE` *(tidak pernah di-enqueue)*.

### Pembersih terjadwal (`main.py`)

Tiap `CLEANUP_INTERVAL = 300` detik:
- enqueue `CLEANUP_EXPIRED_PROPOSALS`, `REVOKE_EXPIRED_ACCESS`,
  `CLEANUP_EXPIRED_VIEW_REQUESTS`
- `_flip_stuck_uploads()` — file yang stuck di `uploading`/`in_audit` lebih dari
  `STUCK_UPLOAD_TIMEOUT_MIN = 10` menit di-flip ke `failed`, supaya baris tidak
  menggantung selamanya kalau worker mati di tengah upload.

### Helper izin (`routers/library/_shared.py`)

`_has_folder_perm(db, profile, folder, field)` + sembilan pembungkus
(`_can_view_dept`, `_can_upload_to`, `_can_download_from`, `_can_rename_in`,
`_can_delete_in`, `_can_move_in`, `_can_create_folder_in`,
`_can_rename_folder_in`, `_can_delete_folder_in`). Admin selalu `True`.

Helper lain: `_write_log`, `_file_meta`, `_redact_email`, `_build_filename`,
`_sanitize_filename`, `_strip_ext`, `_html_page`, `_is_librarian`.

Konstanta: `ALLOWED_EXTENSIONS = {.docx .xlsx .pptx .pdf .zip .rar .dwg .step .stp}`,
`MAX_FILE_SIZE = 50 MB`, `LINK_TTL_MINUTES = 30`.

---

## Layer 3 — API Route

Router dipecah per-domain di `backend/app/routers/library/`, semua berbagi satu
objek `router` yang didefinisikan di `_shared.py`.

### `browse.py` — membaca

| Method | Path | Penjaga | Catatan |
|---|---|---|---|
| GET | `/file-types` | login | hanya `is_active` |
| GET | `/tree` | login + filter `can_view` | 2 query total, tidak N+1 |
| GET | `/public-index` | login, **tanpa filter dept** | ⚠ `file_count` salah, N+1 |
| GET | `/folders/{id}/files` | `_can_view_dept` | paginasi + pencarian |

`GET /folders/{id}/files` juga mengembalikan `my_perms` (9 boolean) supaya
frontend bisa menyembunyikan tombol tanpa request kedua.

### `upload_flow.py` — memasukkan file

| Method | Path | Limit | Penjaga |
|---|---|---|---|
| POST | `/propose` | 60/menit | login |
| POST | `/upload` | 30/menit | `_can_upload_to` |
| GET | `/files/{id}/status` | — | uploader / admin / director |

### `file_ops.py` — operasi file

| Method | Path | Siapa yang boleh |
|---|---|---|
| GET | `/files/{id}/link` | admin, atau `can_download`, atau pemilik view-request aktif |
| DELETE | `/files/{id}` | admin **atau uploader** atau `can_delete` |
| PATCH | `/files/{id}/move` | admin, atau `can_move` di asal **dan** `can_upload` di tujuan |
| PATCH | `/files/{id}/rename` | admin **atau uploader** atau `can_rename` |

> Perhatikan: **uploader selalu boleh hapus & rename**, melewati matriks
> `folder_permissions`. Itu keputusan yang masuk akal ("bersihkan sampahmu
> sendiri") tapi berarti mencabut `can_delete` dari sebuah role tidak
> mencegah anggotanya menghapus file yang mereka unggah sendiri.

### `folder_ops.py` — operasi folder

| Method | Path | Penjaga |
|---|---|---|
| POST | `/folders` | `_can_create_folder_in` |
| PATCH | `/folders/{id}/rename` | `_can_rename_folder_in` |
| PATCH | `/folders/{id}/move` | `_can_move_in` |
| DELETE | `/folders/{id}` | `_can_delete_folder_in` |
| PATCH | `/admin/folders/{id}/gdrive-link` | **admin** |

### `view_requests.py` — persetujuan lihat

| Method | Path | Penjaga |
|---|---|---|
| POST | `/files/{id}/view-request` | login |
| GET | `/view-requests/{token}/approve` | Pustakawan — ⚠ tidak bisa diklik dari email |
| GET | `/view-requests/{token}/deny` | Pustakawan — idem |
| GET | `/view-requests/inbox` | Pustakawan |
| POST | `/view-requests/{req_id}/decide` | Pustakawan — **jalur yang benar-benar dipakai** |
| GET | `/admin/email-config` | admin |
| POST | `/admin/email-test` | admin |

### `admin_ops.py` — panel admin

| Method | Path |
|---|---|
| GET | `/admin/activity` |
| POST | `/admin/reset-stuck` |
| POST | `/admin/purge-failed` |
| DELETE | `/admin/temp/{file_id}` |
| GET / PATCH | `/sequences`, `/sequences/{doc_type}` |
| GET / PUT | `/admin/folder-permissions` |

Semua `require_role(AppRole.admin)`.

### `public_meta.py`

| Method | Path | Penjaga |
|---|---|---|
| GET | `/public-index/sheets` | login |
| GET | `/public-list` | login — ⚠ 1000 file terbaru dari **semua** dept |
| GET | `/log` | admin |

---

## Layer 4 — Frontend

### Halaman

- `app/(app)/dcc/page.tsx` (703 baris) — `LibraryPage`. Sidebar pohon folder
  yang bisa di-resize (lebar disimpan di `localStorage`), daftar file, pencarian
  dengan debounce, seleksi banyak untuk hapus/pindah massal.
- `app/(app)/dcc/access/page.tsx` — inbox Pustakawan.

### Komponen `features/library/`

| Berkas | Peran |
|---|---|
| `folder-tree.tsx` | Pohon. Menyuntik dua node semu: `TEMP_FOLDER_ID = "__temp__"` dan `INDEX_FOLDER_ID = "__index__"` |
| `file-list.tsx` | Tabel file + menu aksi per baris |
| `batch-upload-modal.tsx` (570) | Kartu metadata per file; hitung SHA-256 di browser; checkbox "Pakai nama file asli" |
| `use-upload-queue.ts` | Antrean: `CONCURRENCY = 3`, `MAX_RETRIES = 3`, backoff 1500 ms |
| `upload-idb.ts` | Persistensi antrean di **IndexedDB** (bukan localStorage — blob File tidak bisa di-JSON). Antrean selamat dari refresh/tutup tab |
| `upload-queue-panel.tsx` | Panel progres melayang |
| `move-modal.tsx` | Pemilih folder tujuan |
| `folder-actions.tsx` | Menu "Baru" + aksi folder |
| `temp-panel.tsx` (513) | Panel admin: aktivitas + purge massal |
| `public-index.tsx` | Tampilan etalase |
| `sync-indicator.tsx` | Status "terakhir disinkron" |
| `types.ts` | Tipe bersama |

### Klien API

`lib/api/library.ts` (555 baris) — `fetch` mentah, **bukan** `ApiClient`.
Punya `authHeaders()` sendiri dengan timeout 8 detik pada
`supabase.auth.getSession()`. `uploadFile` memakai `XMLHttpRequest` (bukan
`fetch`) supaya bisa melaporkan progres upload.

---

## Alur end-to-end: Upload satu file

```
1. User drop file          → filterValidFiles()  (ekstensi + ukuran, sisi klien)
2. Browser hitung SHA-256  → POST /api/library/propose { filename, size, hash }
3. Backend                 → detect_metadata_from_filename()
                           → cek duplikat: library_files WHERE content_hash = ?
                                           AND status=passed AND NOT is_deleted
                           → tulis library_audit_log (action=propose)
                           ← { detected: {...}, duplicate: {...} | null }
4. Modal tampilkan kartu metadata + peringatan kuning kalau duplikat
5. User konfirmasi         → antrean (IndexedDB), maks 3 paralel
6. POST /api/library/upload (multipart)
   ├─ validasi folder ada + punya gdrive_folder_id       (404 / 422)
   ├─ _can_upload_to()                                    (403)
   ├─ validasi ekstensi                                   (422)
   ├─ file.read()  ← ⚠ K-2: baca penuh SEBELUM cek ukuran
   ├─ ukuran > 50 MB?                                     (413)
   ├─ nomor arsip: UPDATE document_sequences ... RETURNING
   ├─ _build_filename() → "TYPE-NUM-JUDUL.ext"
   ├─ COMMIT  ← nomor urut dikunci sebelum panggilan lambat
   ├─ INSERT library_files (status=uploading) + COMMIT
   │     ← baris terlihat walau Drive menggantung
   ├─ gdrive.upload_file()  (retry 5×)
   │     ├─ gagal → status=failed, catat error di proposal_metadata → 503
   │     └─ sukses ↓
   ├─ status=passed, isi gdrive_file_id + web_link
   ├─ library_audit_log (action=upload)
   └─ enqueue INDEX_TO_SHEETS  (non-fatal kalau gagal)
7. ← 201 { file_id, file_name, status, gdrive_web_link }
```

## Alur end-to-end: Membuka isi file

```
User klik file
   │
   ▼
GET /api/library/files/{id}/link
   │
   ├─ admin?                              → link langsung
   ├─ can_download di dept folder?        → link langsung
   ├─ view_request approved & belum lewat → temp_link (30 menit)
   ├─ view_request pending & belum lewat  → { status: pending, expires_at }
   └─ selain itu                          → { status: none }
                                                │
                                                ▼
                              POST /api/library/{id}/view-request
                                 ├─ buat token (TTL 5 menit)
                                 ├─ tulis view_requests + audit log
                                 └─ enqueue SEND_EMAIL ke LIBRARIAN_EMAILS
                                                │
                                                ▼
                              Pustakawan buka /dcc/access (inbox)
                                 └─ POST /view-requests/{id}/decide
                                       → status=approved, temp_link, +30 menit
```

---

## Utang & catatan modul ini

| # | Hal | Lokasi | Dampak |
|---|---|---|---|
| **K-2** | Ukuran dicek setelah `await file.read()` | `upload_flow.py:219` | OOM bisa menjatuhkan backend (termasuk R-Net) |
| **K-3** | Link approve di email selalu 401 | `view_requests.py:178` | Email menyesatkan Pustakawan; 2 endpoint tak terpakai |
| **K-5** | `/public-index` + `/public-list` tanpa filter dept | `browse.py:213`, `public_meta.py:100` | Nama file (memuat nama klien) bocor lintas departemen |
| **B-1** | `file_count = len(file_rows)` setelah `.limit(100)` | `browse.py:253` | Dept dengan 500 file tampil "100" |
| **B-2** | N+1: satu query per departemen | `browse.py:213-260` | 11 round-trip untuk data satu `GROUP BY` |
| **B-3** | `get_file_link` query `LibraryFile` dua kali; tanpa filter `is_deleted` | `file_ops.py:86` | Admin bayar 2 query; bisa dapat link file terhapus |
| **3.4** | `doc_number` unik tapi **tidak pernah diisi** | `upload_flow.py` | Deteksi duplikat selalu balas `doc_number: null`; indeks unik sia-sia |
| **B-5** | Nomor urut di-commit sebelum Drive | `upload_flow.py` | Upload gagal = lompatan permanen di seri arsip |
| — | Pipeline audit 4-lapis tidak pernah jalan | `services/audit_pipeline.py` (387 baris) | Dead code + tabel `audit_jobs` mati. Status `in_audit` tak pernah tercapai |
| — | Uploader bisa hapus/rename lepas dari `folder_permissions` | `file_ops.py` | Mencabut `can_delete` tidak sepenuhnya mencabut |
| — | Izin subfolder disimpan tapi diabaikan | `_shared.py:_has_folder_perm` | Migrasi `m7n8o9p0q1r2` menyiapkan kolom yang tidak dibaca |
| — | Import superset di tiap berkas router | `library/*.py` | Diakui di docstring; menyulitkan lint |
| — | `list_folder_files` docstring bilang "all roles can read" | `browse.py:267` | Salah — ada cek `_can_view_dept`. Komentar basi |
| — | Nyaris tanpa tes | `backend/tests/` | 149 tes hampir semuanya R-Net |
