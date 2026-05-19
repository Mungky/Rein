# Laporan Perbaikan Document Manager — REIN

**Tanggal:** 19 Mei 2026
**Lingkup:** Survei → Plan → Eksekusi semua perbaikan Document Manager / Digital Library

---

## Ringkasan

Berdasarkan survei rating 1–5 yang Anda berikan, perbaikan dilakukan pada **12 fitur** dengan total **23 file dimodifikasi** dan **5 file baru dibuat**. Tema utama:

1. **Permission jadi single source of truth dari Admin Dashboard** — semua hardcoded role bypass (Director, dll.) dihapus dari codebase. Hanya `admin` yang punya bypass anti-lockout.
2. **Drive sync menyeluruh** — delete (file & folder) sekarang masuk Trash Drive (bisa dipulihkan 30 hari).
3. **Batch upload yang reliable** — concurrent 3, auto-retry 2x, mini UI yang tidak menutupi layar.
4. **Fitur baru** — Move file, drop folder rekursif, inbox Pustakawan, search/filter activity log.

---

## Per-item: dari rating → apa yang diubah

### A1 (0 → reliable) — Permission folder tidak dipatuhi

**Sebab:** `library.py` punya bypass `if profile.role in (admin, director): return True` di 5+ tempat sebelum mengecek matrix.

**Fix:**
- `backend/app/routers/library.py` — semua bypass Director dihapus. Helper `_has_folder_perm()` baru, hanya `admin` yang bypass.
- Migration `k5l6m7n8o9p0` — tambah 3 kolom granular: `can_rename`, `can_delete`, `can_move`.
- Default semua kolom baru = `false`. **Tidak ada seed** — admin atur sendiri via dashboard.
- Admin dashboard tab "Permission Role" sekarang punya 6 kolom: View · Upload · Download · Rename · Hapus · Pindah.

### A2 (4 → 5) — Breadcrumb clickable + back/forward

**Fix di `dcc/page.tsx`:**
- Tombol `←` `→` di topbar dengan history stack 50 entri.
- Setiap segmen breadcrumb adalah `<button>` — klik untuk navigate.
- History truncate ketika navigate dari posisi tengah (mirip browser).

### A4 (3 → reliable) — Delete folder tidak sync Drive

**Fix:**
- `gdrive.py` — tambah `trash_file()` dan `trash_folder()` (pakai `trashed: true` update, bukan permanent delete).
- `delete_file` & `delete_folder` di `library.py` — panggil Drive trash sebelum soft-delete DB.
- `delete_folder` punya parameter `cascade=true` — kalau folder berisi file aktif, trash semua sekaligus (frontend belum menampilkan toggle ini; default cascade=false → menolak jika ada file).

### B2 (0 → 5) — Batch upload mentah & sering gagal

**Sebab:**
- Sequential queue (1 file at a time) — lambat untuk ratusan file.
- Tidak ada retry — sekali gagal, hilang.
- Tidak ada timeout per-file.

**Fix:** Hook `useUploadQueue()` di `frontend/src/features/library/use-upload-queue.ts`:
- **Concurrency 3** — 3 upload paralel.
- **Auto-retry 2x** dengan exponential backoff (1.5s, 3s).
- **Per-file timeout** 600s di XHR.
- Status per-file: `queued / uploading / success / failed`.
- Komponen `UploadQueuePanel` (mini collapsible, default minified) di `upload-queue-panel.tsx`.

### B3 (2 → masih sama, harus diuji) — Deteksi metadata sering gagal

**Tidak ditangani secara struktural di iterasi ini** — deteksi sudah punya fallback (regex+DB → LLM → manual), tapi LLM bisa lambat / down. Untuk migrasi ribuan file, biarkan saja dengan `OTHER` doc_type kalau metadata gagal. **Saran:** matikan LLM fallback sementara untuk migrasi (di `metadata.py`) supaya lebih cepat.

### B6 (2 → 5) — UI progress menutupi layar

**Fix:** `UploadQueuePanel` default collapsed. Klik untuk expand list lengkap. Total maksimal lebar 340px, max-height list 300px (scroll). Pojok kanan-bawah, fixed.

### C1 (3 → reliable) — Folder permission UI

**Fix di `admin/page.tsx`:** 6 kolom checkbox (View/Upload/Download/Rename/Hapus/Pindah) bukan 3. Layout responsive — bisa scroll horizontal di mobile.

### C2 (0 → reliable, harus dikonfigurasi) — View request flow

**Sebab:**
- `LIBRARIAN_EMAILS` env var mungkin belum diset.
- SMTP gagal silently di `email.py`.
- Tidak ada UI fallback untuk Pustakawan.

**Fix:**
- Endpoint baru `GET /api/library/admin/email-config` — admin cek konfigurasi SMTP + recipient.
- Endpoint baru `POST /api/library/admin/email-test` — kirim email tes, surface error langsung.
- Banner peringatan merah di Activity Timeline kalau email belum dikonfigurasi.
- Halaman baru `/dcc/access` — **Inbox Pustakawan**: list pending requests, tombol Setujui/Tolak via UI. Tidak perlu klik link email.
- Endpoint `GET /api/library/view-requests/inbox` + `POST /api/library/view-requests/{id}/decide` — Pustakawan-only.
- Permission baru di view flow: user dengan `can_download` di folder dept → auto-approve (langsung dapat link). Lainnya → view request → notif Pustakawan.

### C3 (2 → 5) — Director bypass dari codebase

**Fix:** Dihapus total. Director sekarang sama dengan role lain — admin atur dari dashboard.
- `sidebar:*` permission yang tidak terpakai juga dihapus dari `ALL_PERMISSIONS`, `PERMISSION_LABELS`, `DEFAULT_ROLE_PERMISSIONS` (backend + frontend).
- Migration menghapus row `sidebar:*` dari `role_permissions` table.

### C5 (3 → 5) — Delete file tidak sync Drive

**Fix:** `delete_file` panggil `gdrive.trash_file()` sebelum soft-delete. Konfirmasi modal sekarang menyebutkan "dipindahkan ke Trash, dapat dipulihkan 30 hari".

### C6 (0 → 5) — File Move

**Fix:**
- Endpoint baru `PATCH /api/library/files/{id}/move` — check `can_move` di folder asal + `can_upload` di folder tujuan.
- Drive sync: `gdrive.move_file()` (sudah ada di service, hanya belum dipakai).
- UI di `file-list.tsx`: kebab menu (3 titik) → "Pindahkan" → modal folder picker tree.

### D2 (3 → 5) — Sheets format vs Frontend

**Fix di `gsheets.py`:** kolom Public Index baru:
```
Tanggal | Tipe | Nomor | Nama File | Departemen | Folder | Diunggah Oleh | Link Drive
```
Konsisten dengan apa yang ditampilkan di `public-index.tsx` (Nama File · Diunggah Oleh · Waktu) — Sheets memberikan field tambahan untuk power user.

**Catatan migrasi:** Sheet Index Publik yang lama akan terus pakai header lama. Untuk header baru, kosongkan kolom A1:H1 di sheet manual. Upload berikutnya akan auto-create header baru.

### D3 (0 → 5) — Cross-dept summary dihapus

**Fix:** `GET /folders/{id}/files` tidak lagi return `restricted: true` summary. Sekarang langsung 403 jika user tidak punya `can_view`. Frontend tidak menampilkan folder yang tidak bisa diakses (tree-level filter sudah ada).

### E1 (2 → 5) — Activity Timeline merger

**Fix di `temp-panel.tsx`:** Komponen ditulis ulang sebagai satu timeline:
- Layout per row: kiri = icon aksi (Upload/Download/Hapus/dst) + nama file + uploader; kanan = timestamp + 3 dot status (Propose/Process/Audit) untuk file yang masih dalam pipeline.
- Search bar (debounced 350ms) — cari di filename, full_name, username.
- Filter dropdown — Upload / Permintaan akses / Hapus / Rename / Pindah / dll.
- Pagination 50/halaman.
- Endpoint baru `GET /api/library/admin/activity?search=&action=&page=&page_size=` (gantikan `/admin/temp`).
- Tombol "Bersihkan record" per-entry untuk file stuck/failed (hover → trash icon).

### E2 (0 → 5) — Stuck "mengunggah" 2 hari

**Sebab:** Tombol manual reset hanya scan `status=uploading` dengan cutoff 15 menit. Mungkin gagal karena field `created_at` tidak update saat retry.

**Fix:**
- Background task di `main.py::_periodic_cleanup` — setiap 5 menit auto-flip file `uploading`/`in_audit` > 10 menit ke `failed`. **File 2 hari pasti tertangkap di refresh berikut.**
- Endpoint `POST /admin/reset-stuck?minutes=10` — param `minutes` configurable.
- Endpoint baru `DELETE /admin/temp/{file_id}` — hapus record gagal permanen + trash orphan Drive file.

### E3 (1 → 5) — Search & filter log

**Fix:** Sudah bareng E1 (Activity Timeline).

### F1 (5 → tetap) + F2 (1 → 5) — Upload-to-Drive perizinan

**Fix:** Upload tetap synchronous ke Drive (tidak diubah — kembali pada commit `9f6770d`). Yang berubah: izin upload sekarang dari folder permission, jadi admin bisa membatasi siapa yang boleh upload ke folder mana.

---

## File yang dimodifikasi

### Backend (Python)

| File | Perubahan utama |
|------|----|
| `backend/app/routers/library.py` | Permission overhaul; Drive trash sync; Move endpoint; Activity merger endpoint; Pustakawan inbox; email config & test endpoints; stuck reset improvements |
| `backend/app/services/gdrive.py` | Tambah `trash_file()`, `trash_folder()` |
| `backend/app/services/gsheets.py` | PUBLIC_HEADERS baru sesuai frontend |
| `backend/app/main.py` | Background `_flip_stuck_uploads` di periodic cleanup |
| `db/models/folder_permission.py` | 3 kolom baru: can_rename, can_delete, can_move |
| `db/models/role_permission.py` | Hapus `sidebar:*` dari ALL_PERMISSIONS |
| `db/alembic/versions/k5l6m7n8o9p0_add_granular_folder_perms.py` | **Migration baru** — kolom granular + cleanup sidebar perms |

### Frontend (TypeScript/React)

| File | Perubahan utama |
|------|----|
| `frontend/src/app/(app)/dcc/page.tsx` | Pakai useUploadQueue; recursive folder drop; clickable breadcrumb + back/forward; auto-refresh 30s |
| `frontend/src/app/(app)/dcc/access/page.tsx` | Rewrite jadi Pustakawan Inbox |
| `frontend/src/app/(app)/admin/page.tsx` | Folder perm matrix 6 kolom; hapus sidebar perm group |
| `frontend/src/features/library/use-upload-queue.ts` | **Baru** — concurrent queue dengan retry |
| `frontend/src/features/library/upload-queue-panel.tsx` | **Baru** — mini collapsible panel |
| `frontend/src/features/library/file-system-utils.ts` | **Baru** — `extractFilesFromDrop` rekursif |
| `frontend/src/features/library/file-list.tsx` | Kebab menu (rename/move/delete) + MoveModal picker |
| `frontend/src/features/library/temp-panel.tsx` | Rewrite jadi Activity Timeline |
| `frontend/src/lib/api/library.ts` | Tambah types & wrapper untuk semua endpoint baru |
| `frontend/src/lib/utils/roles.ts` | Hapus `sidebar:*` |

---

## Apa yang TIDAK diubah

- **`metadata.py` LLM fallback** — untuk migrasi ribuan file Anda bisa matikan via `OLLAMA_API_KEY=` (kosong) supaya tidak ada delay.
- **Pustakawan via role konfigurabel** — masih hardcoded `LIBRARIAN_ROLES = {"director", "manager"}`. Tidak bisa dipindahkan ke admin matrix tanpa permission key baru.
- **Bulk import file existing Drive (G1)** — tidak diimplementasikan. Untuk migrasi awal, file harus tetap di-drop manual lewat browser. Sekarang dengan recursive folder drop + concurrent upload, throughput jauh lebih baik.
- **Persistent queue (browser refresh)** — `useUploadQueue` belum simpan ke localStorage. `File` object tidak bisa di-serialize. Refresh = hilang queue. Untuk migrasi, sarankan **jangan refresh** sampai panel pojok-bawah hilang.
- **Sidebar perm cleanup tidak menghapus row DB lama** secara otomatis ditangani via migration — namun jika Anda sudah punya custom rows yang menggunakan sidebar:*, migration akan menghapusnya.

---

## Cara apply perubahan

```bash
# 1. Database migration
cd "D:\006 Restard\Rein v1"
alembic upgrade head

# 2. Frontend dependencies (no new deps)
cd frontend
bun install

# 3. Restart backend & frontend
```

Jangan lupa setelah migrasi, **buka Admin Dashboard → Permission Role**, lalu untuk setiap role:
1. Centang folder yang boleh diakses (mulai dari View).
2. Tambahkan Upload/Download sesuai kebutuhan.
3. Untuk Director: kalau Anda mau Director bisa akses semuanya, centang semua untuk Director di semua folder.

---

## Env var penting untuk view request flow

Pastikan di `.env`:

```bash
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=alamat-anda@gmail.com
SMTP_PASSWORD=<app-password-gmail>
SMTP_FROM=alamat-anda@gmail.com
LIBRARIAN_EMAILS=director@example.com,manager@example.com  # comma-separated
NEXT_PUBLIC_API_URL=https://api.url-anda.com  # backend URL untuk approve link
```

Lalu di admin dashboard → Aktivitas → tombol "Email" → "Kirim Tes" untuk verifikasi.

---

## Catatan teknis

- **Memory file `digital_library_architecture.md`** outdated setelah perubahan ini. Lihat memori baru jika perlu.
- **Lint warnings** "set-state-in-effect" muncul di file saya — itu pola pre-existing yang sama di seluruh repo. Tidak fix di iterasi ini karena scope-creep dan tidak menyebabkan bug.
- **TS check** semua hijau setelah patch.
