# Audit Codebase REIN — 25 Juli 2026

Basis: commit `d7cfd72` (branch `main`), ditambah perubahan belum-commit di
`.claude/settings.local.json`, `db/certs/`, `package-lock.json`.

Metode: pembacaan menyeluruh backend (`backend/app`, `db/`), frontend
(`frontend/src`), migrasi Alembic, CI, plus eksekusi nyata:

| Cek | Perintah | Hasil |
|---|---|---|
| Tes backend | `python -m pytest -q` (di `backend/`) | **149 passed**, 10.98s |
| Typecheck frontend | `npx tsc --noEmit` | **bersih**, 0 error |
| Lint frontend | `npx eslint src` | **17 error** (sesuai catatan CI) |
| Lint backend | ruff | **tidak terpasang** — `pyproject.toml` punya `[tool.ruff]` tapi ruff tidak ada di `requirements-dev.txt` dan tidak dijalankan CI |

---

## 1. Nilai keseluruhan

| Dimensi | Nilai | Ringkas |
|---|:---:|---|
| Arsitektur & pemisahan layer | **A−** | 4 layer benar-benar terpisah (route / service / model / UI). Router library sudah dipecah per-domain. Tidak ada logika bisnis di model. |
| Kualitas modul R-Net | **A** | Terbaik di repo. Caching TTL + single-flight, bucketing SQL, audit log, atomic alarm claim, retensi terkendali. |
| Kualitas modul Document Manager | **B** | Jalur utama solid, tapi ada bug nyata (hitungan file, `doc_number` mati, link email approve tidak bisa diklik). |
| Keamanan | **B−** | Pondasi bagus (RLS wajib + tes dinamis, JWT lokal + JWKS TTL, rate limit per-user, security headers, secret diredaksi di audit log). Tapi ada 4 celah model-izin & 1 celah memori upload. |
| Dead code | **C** | 2.593 baris backend (34 dari 152 endpoint) + 14 modul frontend tidak terpanggil sama sekali, termasuk 1 halaman produksi yang isinya data palsu. |
| Konsistensi | **C+** | Dua mekanisme otorisasi (`require_permission` vs `require_role`) hidup berdampingan tanpa aturan; dua `cn()`; dua gaya HTTP client di frontend. |
| Testing | **B+** | 149 tes, termasuk tes paritas frontend↔backend dan tes RLS dinamis. Tapi hampir semua di R-Net; Document Manager & Workspace nyaris tanpa tes. |
| Dokumentasi | **A−** | Tidak biasa bagusnya untuk proyek internal (ARSITEKTUR, RUNBOOK, PANDUAN-AWAM, komentar "kenapa" bukan "apa"). |
| Observability | **B+** | Sentry, health monitor, audit log 3 jenis, data-access monitor, runbook kegagalan. |

**Nilai gabungan: B (baik, dengan utang yang jelas terpetakan).**

Kalimat jujurnya: **inti sistem ini ditulis dengan disiplin di atas rata-rata**
— komentar menjelaskan *alasan*, bukan mengulang kode; keputusan sulit (SSL
pooler Supabase, `statement_cache_size=0`, single-flight cache) didokumentasikan
di tempatnya. Masalahnya bukan kualitas, tapi **akumulasi**: fitur lama tidak
pernah dihapus, hanya berhenti dipanggil.

---

## 2. Temuan keamanan

Diurutkan dari yang paling penting.

### K-1 · Permission `admin:*` diiklankan tapi tidak pernah ditegakkan — HIGH

`db/models/role_permission.py` mendeklarasikan `admin:manage_users` dan
`admin:manage_file_types`, dan UI matriks izin mengizinkan admin memberikannya
ke role lain. Tapi **seluruh** `backend/app/routers/admin.py` dijaga
`require_role(AppRole.admin)` — bukan `require_permission`.

Verifikasi: jumlah kemunculan string permission di kode.

```
admin:manage_users        backend=0  frontend=4
admin:manage_file_types   backend=0  frontend=2
dcc:delete                backend=0  frontend=2
workspace:create_wo       backend=0  frontend=3
workspace:close_project   backend=0  frontend=2
```

Akibatnya: kalau admin mencentang `admin:manage_users` untuk role Manager,
menu **Admin** muncul di sidebar Manager (`sidebar.tsx:41`), halaman terbuka,
lalu **setiap** panggilan API balas 403. Izin yang terlihat diberikan tapi tidak
berfungsi adalah kelas bug paling berbahaya di sistem RBAC — operator percaya
akses sudah dicabut/diberikan padahal tidak.

Perbaikan: satu keputusan, lalu konsisten — entah ganti semua penjaga admin
jadi `require_permission("admin:manage_users")`, atau hapus kunci itu dari
`ALL_PERMISSIONS` supaya tidak bisa dicentang.

### K-2 · Batas ukuran upload dicek setelah file dibaca penuh ke RAM — HIGH

`backend/app/routers/library/upload_flow.py:219`

```python
content = await file.read()          # <- seluruh body masuk memori
if len(content) > MAX_FILE_SIZE:     # <- baru dicek di sini
```

Satu POST 2 GB dari user ber-`dcc:upload` mana pun akan dialokasikan penuh di
RAM proses backend sebelum ditolak. Rate limit `30/minute` tidak menolong: 30
request paralel × ukuran besar = OOM. Backend jalan satu proses (task queue,
alarm engine, historian ada di dalamnya), jadi OOM menjatuhkan R-Net juga.

Perbaikan: cek `Content-Length` sebelum baca, dan/atau baca berpotongan
(`while chunk := await file.read(1<<20)`) sambil menghitung total dan berhenti
di ambang.

### K-3 · Link persetujuan di email tidak mungkin bekerja — MEDIUM (fungsional + jejak audit)

`view_requests.py:178-182` mengirim email berisi URL:

```
{settings.frontend_url}/api/library/view-requests/{token}/approve
```

Endpoint tujuannya (`view_requests.py:217`) memakai
`Depends(get_current_profile)` → butuh header `Authorization: Bearer`. Browser
yang mengklik link dari email **tidak pernah** mengirim header itu, jadi hasilnya
selalu 401. Token `secrets.token_urlsafe(32)` yang dibuat tidak pernah dipakai
lewat jalur yang dimaksud.

Jalur yang benar-benar dipakai adalah inbox (`/dcc/access` →
`GET /view-requests/inbox` + `POST /view-requests/{req_id}/decide`), jadi
fiturnya tidak rusak — tapi emailnya berbohong ke Pustakawan, dan dua endpoint
token itu jadi permukaan serang tanpa fungsi.

Catatan tambahan: `settings.frontend_url` dibaca dari `NEXT_PUBLIC_API_URL`
(`config.py`) — namanya menyesatkan; nilainya URL backend.

### K-4 · Kredensial stream dikirim mentah ke semua pemegang `scada:view` — MEDIUM

`scada.py:170-183` (`_stream_dict`) mengembalikan `read_pass` dan `secret`
apa adanya. Ini **disengaja** dan didokumentasikan di docstring modul
(kredensial read-only MediaMTX harus ditempel browser sebagai query param).

Tapi bandingkan dengan `_site_dict` (`scada.py:728`) yang meredaksi password
MQTT jadi `has_password: bool` — dua tabel, dua standar. Dan `scada:view`
adalah izin *paling luas* di R-Net (engineer, manager, operational manager
semua punya). Field `secret` untuk sumber VNC bukan kredensial read-only.

Perbaikan minimal: kirim `read_pass` hanya pada endpoint yang benar-benar butuh
memutar stream, atau proxy autentikasi di backend supaya kredensial tidak
pernah sampai ke bundle browser.

### K-5 · `/api/library/public-index` membocorkan nama file lintas departemen — MEDIUM

`browse.py:213` sengaja tidak memfilter `can_view`: siapa pun yang login
melihat 100 nama file terakhir dari **setiap** departemen (Finance, HR,
Directorate). Konvensi penamaan REIN adalah `TYPE-NUM-CLIENT judul.ext`, jadi
nama file memuat nama klien dan judul dokumen.

Ini keputusan produk ("etalase/brosur"), bukan bug — tapi harus **eksplisit
disetujui**, bukan diwarisi. Nama file gaji atau kontrak klien di daftar publik
adalah kebocoran, meski isinya tidak bisa dibuka.

### K-6 · Verifikasi JWT tanpa cek `issuer` — LOW

`dependencies.py` memverifikasi tanda tangan + `audience="authenticated"` tapi
tidak `issuer`. Untuk HS256, siapa pun yang memegang `SUPABASE_JWT_SECRET` bisa
menerbitkan token — tapi itu memang secret proyek, jadi dampaknya kecil.
Tambahkan `issuer=f"{supabase_url}/auth/v1"` sebagai pengerasan murah.

### Yang sudah benar (jangan diutak-atik)

- **RLS wajib + tes dinamis.** `db/alembic/versions/t4u5v6w7x8y9` menyalakan RLS
  di semua tabel, dan `backend/tests/test_rls.py` bertanya langsung ke
  `pg_class.relrowsecurity` — jadi tabel baru yang lupa RLS ketahuan CI, bukan
  cuma yang terdaftar manual. Ini pola yang benar.
- **Rate limit dikunci per-user, bukan per-IP** (`limiter.py`) dengan alasan
  yang ditulis: satu kantor di belakang NAT tidak saling menghabiskan jatah.
- **Audit log meredaksi secret.** `scada_audit.py` punya daftar `SENSITIVE`;
  password hanya tercatat `{"changed": true}`.
- **Cache JWKS ber-TTL + refresh paksa saat `kid` tak dikenal** — rotasi kunci
  Supabase tidak butuh restart backend.
- **`API_SECRET_KEY` default kosong** dengan peringatan startup, bukan nilai
  contoh yang diam-diam terpakai di produksi.

---

## 3. Dead code

Diverifikasi dua arah: endpoint backend yang tidak punya pemanggil frontend,
dan modul frontend yang tidak pernah di-import.

### 3.1 Halaman produksi berisi data palsu — prioritas tertinggi

`frontend/src/app/(app)/approvals/page.tsx` (516 baris) — **nol** panggilan API.
Seluruh isinya `MOCK_APPROVALS` (baris 26), state-nya
`useState<MockApproval[]>(MOCK_APPROVALS)` (baris 158). Nomor dokumen palsu
("DRW-PLB-0041"), nama karyawan palsu ("Budi Santoso", "Rina Wijaya").

Halaman ini **ada di navigasi produksi** dan terbuka untuk pemegang
`dcc:approve` (Director, Manager, Finance, Operational Manager). Mereka melihat
antrian persetujuan yang tidak nyata, dan tombol Setujui/Tolak yang hanya
mengubah state lokal.

Ini bukan sekadar dead code — ini **misinformasi ke pengguna nyata**.
Pilih satu: sambungkan ke `/api/approvals/*` yang sudah ada, atau kunci
halamannya lewat `feature-flags.ts` seperti Dashboard dan Workspace.

### 3.2 Router backend tanpa pemanggil

| Modul | Baris | Endpoint | Status |
|---|---:|---:|---|
| `app/routers/upload.py` | 503 | 4 | Alur propose/confirm DCC lama — digantikan `library/upload_flow.py` |
| `app/services/audit_pipeline.py` | 387 | — | Pipeline audit 4-lapis. `TaskType.AUDIT_FILE` **tidak pernah di-enqueue** di seluruh repo |
| `app/services/nimbus.py` | 409 | — | Chat AI. Satu-satunya pemanggil `hooks/use-chat-stream.ts` sendiri orphan |
| `app/routers/documents.py` | 342 | 6 | CRUD dokumen lama — digantikan `library_files` |
| `app/routers/access.py` | 228 | 5 | `lib/api/access.ts` orphan. Berisi **satu-satunya endpoint tanpa autentikasi** di backend: `GET /api/access/{token}` |
| `app/routers/projects.py` | 134 | 4 | `lib/api/clients.ts` orphan |
| `app/routers/approvals.py` | 129 | 3 | `lib/api/approvals.ts` orphan |
| `app/routers/clients.py` | 115 | 4 | idem projects |
| `app/routers/dashboard.py` | 105 | 2 | Halaman dashboard pakai `workspaceApi.summary`, bukan ini |
| `app/routers/queue.py` | 103 | 2 | Tidak ada pemanggil |
| `app/routers/dcc_activity.py` | 84 | 2 | `lib/api/dcc-activity.ts` orphan |
| `app/routers/chat.py` | 54 | 2 | Lihat nimbus |

**Total 2.593 baris backend dan 34 dari 152 endpoint (22%)** ter-mount di
FastAPI tapi tidak pernah dipanggil. Semuanya tetap jadi permukaan serang,
tetap masuk OpenAPI, tetap harus dipelihara saat model berubah.

Satu pengecualian penting: **`clients.py` + `projects.py` sebaiknya
disambungkan, bukan dihapus.** Tabel `clients` dan `clients_projects` dibaca
aktif oleh `services/metadata.py` untuk deteksi metadata nama file — yang
hilang cuma UI-nya, sehingga sekarang **tidak ada cara menambah klien baru
selain SQL manual atau `db/seed.py`.**

### 3.3 Tabel database mati

- **`audit_jobs`** — hanya ditulis `audit_pipeline.py` yang tidak pernah jalan.
- **`chat_messages`** — modelnya ada, migrasinya ada, RLS-nya ada. Nol referensi
  di kode selain definisinya sendiri. `chat.py` tidak menyimpan apa pun.
- **`upload_queue`** — dipakai `upload.py` (mati) dan pembersih terjadwal
  `_cleanup_expired_proposals` yang tiap 5 menit query tabel yang selalu kosong.
- **`dcc_activity_log`** — modelnya lengkap dengan indeks; tidak pernah ditulis.
- **`documents`, `approvals`, `access_requests`** — hanya router mati.

`clients` dan `clients_projects` **tidak** termasuk daftar ini — keduanya
dibaca `services/metadata.py` di setiap `POST /api/library/propose`.

### 3.4 Kolom mati dengan konsekuensi

`library_files.doc_number` punya `unique=True` dan indeks, tapi
`upload_flow.py` **tidak pernah mengisinya**. Konstruktor `LibraryFile(...)`
mengisi `doc_type`, `title`, `note`, `proposal_metadata` — `doc_number`
tidak ada di daftar. Nomor arsip yang susah payah dihitung dari
`document_sequences` hanya hidup di dalam string nama file dan di
`proposal_metadata`.

Efek nyata: deteksi duplikat di `propose_file` mengembalikan
`"doc_number": existing_file.doc_number` (baris 131) yang **selalu `null`**.

### 3.5 Modul frontend tanpa import

```
components/ui/badge.tsx            features/library/dept-summary.tsx
components/ui/skeleton.tsx         features/library/file-system-utils.ts
lib/api/access.ts                  features/scada/analysis/column-form.tsx
lib/api/approvals.ts               features/scada/presets.ts
lib/api/clients.ts                 features/workspace/shared/complete-task-modal.tsx
lib/api/dcc-activity.ts            hooks/use-chat-stream.ts
lib/utils/format.ts                types/index.ts
```

Plus komentar basi: `presence-provider.tsx` merujuk
`features/admin/activity-tab.tsx` yang tidak ada (isi `features/admin/` cuma
6 file: file-types, permissions, rnet, sequences, shared, users).

### 3.6 Duplikasi

- **Dua `cn()` identik**: `lib/utils.ts` (dipakai ~30 file) dan
  `lib/utils/cn.ts` (dipakai 3 file). Isinya sama persis, beda titik-koma.
- **Dua gaya HTTP client**: `lib/api/client.ts` (kelas `ApiClient`, dipakai
  scada + workspace) dan `fetch` mentah + `authHeaders()` lokal
  (`lib/api/library.ts`, admin tabs). Yang kedua punya timeout sesi 8 detik
  yang tidak dimiliki yang pertama.
- **Import superset di router library**: `file_ops.py`, `folder_ops.py`,
  `browse.py` dll. masing-masing menyalin blok import lengkap dari
  `library.py` asli, dengan komentar jujur *"Imports mirror the original file
  (superset; unused ones are harmless)"*. `file_ops.py` meng-import `File`,
  `Form`, `UploadFile`, `HTMLResponse`, `RedirectResponse`, `hashlib`,
  `secrets` yang tidak dipakai satu pun.

---

## 4. Bug fungsional

### B-1 · `file_count` di public-index salah — `browse.py:253`

```python
.limit(100)          # ambil maksimal 100 baris
...
"file_count": len(file_rows),   # lalu hitung baris yang diambil
```

Departemen dengan 500 file menampilkan "100 file". Hitungan harus `COUNT(*)`
terpisah, bukan panjang halaman yang sudah dipotong.

### B-2 · N+1 di public-index — `browse.py:213-260`

Loop per departemen, satu query per iterasi. Sepuluh departemen = sebelas
round-trip ke pooler Supabase untuk data yang bisa diambil satu `GROUP BY`.
Ini endpoint yang dibuka setiap kali user klik tab Index.

### B-3 · Query ganda di `get_file_link` — `file_ops.py:86-115`

Cabang admin mengeksekusi `SELECT LibraryFile`, lalu kode di bawahnya
mengeksekusi `SELECT LibraryFile` **yang sama persis** tanpa syarat. Admin
selalu bayar dua query. Tidak ada pula filter `is_deleted` — admin bisa dapat
link ke file yang sudah dihapus.

### B-4 · Role tanpa izin default — `role_permission.py`

`AppRole` punya 15 role. `DEFAULT_ROLE_PERMISSIONS` hanya memetakan 11.
Yang hilang: **`engineer_civil`, `procurement`, `safety_man`,
`warehouse_manager`**. User baru dengan role itu di-seed tanpa izin apa pun —
login berhasil, lalu semua halaman kosong. Empat role ini ada di
`DEPT_ROLE_MAP` (`library_folder.py`) sebagai pemilik rak departemen, jadi
mereka jelas dimaksudkan aktif.

### B-5 · Nomor urut terbakar saat upload gagal — `upload_flow.py`

`document_sequences` di-increment dan **di-commit** sebelum panggilan Drive.
Kalau Drive gagal, nomornya hilang permanen (lompatan di seri arsip). Ini
trade-off yang disengaja (commit awal supaya baris terlihat kalau Drive
menggantung), tapi belum didokumentasikan sebagai keputusan.

### B-7 · Klien & proyek tidak bisa ditambah lewat UI

`services/metadata.py` mencocokkan nama file terhadap tabel `clients` dan
`clients_projects` untuk mengisi kartu metadata saat upload. Endpoint CRUD-nya
lengkap (`/api/clients/*`, `/api/projects/*`, izin `dcc:manage_clients`),
klien API-nya lengkap (`lib/api/clients.ts`) — tapi **tidak ada komponen yang
meng-import-nya**.

Akibatnya deteksi metadata hanya mengenali klien yang di-seed lewat
`db/seed.py:seed_clients_and_projects()`. Menambah klien baru butuh SQL manual.
Izin `dcc:manage_clients` yang dipegang Director & Manager tidak punya tombol.

Perbaikannya paling murah dari semua temuan: satu tab baru di `/admin`.

### B-6 · 17 error lint React

Semuanya `react-hooks/set-state-in-effect` kecuali dua:
`use-chat-stream.ts:60` (`Date.now()` saat render — impure) dan
`use-upload-queue.ts:82` (akses ref saat render). Tersebar di 14 file termasuk
`permissions-provider.tsx:131`, `theme-provider.tsx:37`, `use-auth.tsx:71`
— yaitu tiga provider yang membungkus **seluruh** aplikasi. Cascading render di
sana berdampak ke semua halaman.

CI sengaja `continue-on-error: true` untuk ini. Wajar sebagai keputusan, tapi
utangnya tidak menyusut sejak dicatat (masih tepat 17).

---

## 5. Jalur antar-kode (arah dependensi)

```
Browser
  │
  ├─ middleware.ts ────────────► Supabase Auth (getUser, verifikasi nyata)
  │
  ├─ PageGuard + PermissionsProvider ──► GET /api/permissions/  (matriks)
  │
  ├─ lib/api/client.ts (ApiClient)  ─┐
  └─ lib/api/library.ts (fetch)    ──┤
                                     ▼
                          FastAPI  backend/app/main.py
                                     │
              ┌──────────────────────┼───────────────────────┐
              ▼                      ▼                       ▼
     dependencies.py           routers/*.py            services/*.py
     (verify JWT, JWKS,        (validasi, HTTP)        (Drive, Sheets,
      require_permission,             │                 email, Telegram,
      require_role)                   │                 alarm, historian)
              │                       ▼                       │
              └──────────────► db/session.py ◄────────────────┘
                              (AsyncSession, pooler 6543)
                                     │
                                     ▼
                             db/models/*.py  →  PostgreSQL (Supabase, RLS on)
                                     ▲
                                     │  (jalur terpisah, tanpa backend)
                          deploy/data/bridge.py  ◄── MQTT (Mosquitto VPS)
                                     │
                          Supabase Realtime ──► Browser (nilai live + alarm)
```

Dua hal yang perlu disadari dari diagram ini:

1. **Bridge menulis langsung ke database, melewati backend.** Konsekuensinya
   `deploy/data/bridge.py` menyimpan salinan sendiri logika sampling
   (`rnet_settings.py` menulisnya eksplisit: *"keep the two in sync"*). Dua
   sumber kebenaran yang harus dijaga manual — dan catatan memori proyek
   menyebut versi di `C:\rein-scada` sudah lebih tua dari yang di repo.

2. **Semua worker latar (alarm engine, historian, archiver, health monitor,
   task queue) hidup di dalam proses FastAPI yang sama** (`main.py` lifespan).
   Backend mati = alarm berhenti, sampling berhenti, arsip berhenti. Tidak ada
   pemisahan proses. Untuk skala sekarang ini pilihan yang benar, tapi ini
   alasan tambahan kenapa K-2 (OOM upload) berbahaya.

---

## 6. Urutan perbaikan yang saya sarankan

Dikelompokkan supaya bisa dikerjakan fitur-per-fitur seperti yang kamu mau.

**Gelombang 1 — hal yang menyesatkan pengguna atau bisa menjatuhkan server**

1. K-2: batasi ukuran upload sebelum baca (± 10 baris, `upload_flow.py`).
2. 3.1: kunci atau sambungkan halaman `/approvals` (data palsu di produksi).
3. K-1: putuskan `require_role` vs `require_permission` untuk admin, lalu
   samakan. Kalau tidak, hapus kunci `admin:*` dari matriks.
4. B-4: lengkapi `DEFAULT_ROLE_PERMISSIONS` untuk 4 role yang hilang.

**Gelombang 2 — bug yang terlihat pengguna**

5. B-1 + B-2: perbaiki hitungan dan N+1 di public-index (satu query `GROUP BY`).
6. 3.4: isi `library_files.doc_number` saat upload — memperbaiki deteksi
   duplikat sekaligus mengaktifkan indeks unik yang sudah ada.
7. K-3: ganti isi email jadi link ke `/dcc/access` (inbox), hapus dua endpoint
   token yang tidak bisa dipakai.
8. B-7: sambungkan tab Klien & Proyek di `/admin` — backend dan klien API
   sudah jadi, tinggal komponennya.

**Gelombang 3 — pembersihan (aman, mekanis, mengecilkan permukaan serang)**

9. Hapus router mati: `documents`, `upload`, `queue`, `dashboard`, `chat`,
   `dcc_activity`, `access`, `approvals` + service `nimbus`, `audit_pipeline`.
   Turunkan `include_router` di `main.py`. ≈2.300 baris hilang.
   **Kecualikan `clients`/`projects`** — itu disambung, bukan dihapus
   (tambah satu tab di `/admin`).
10. Hapus tabel mati lewat migrasi: `audit_jobs`, `chat_messages`,
   `upload_queue`, `dcc_activity_log`, `documents`, `approvals`,
   `access_requests`. (Backup dulu — cek isinya di produksi. Jangan drop
   `clients`/`clients_projects`.)
11. Hapus 14 modul frontend orphan; satukan `cn()`; satukan gaya HTTP client.
12. Bersihkan import superset di `routers/library/*.py`.

**Gelombang 4 — kualitas jangka panjang**

13. Tambahkan `ruff` ke `requirements-dev.txt` dan jalankan di CI (config-nya
    sudah ada di `pyproject.toml`, tinggal dipakai).
14. Lunasi 17 error React — mulai dari 3 provider global.
15. Tes untuk Document Manager (izin folder, propose/upload, view-request).
    Sekarang 149 tes hampir semuanya R-Net.
16. K-4, K-5, K-6: keputusan produk soal kredensial stream dan index publik.

---

## 7. Dokumentasi 4-layer

Dokumentasi per-fitur/per-modul yang kamu minta ada di
[`docs/modul/`](modul/README.md) — satu berkas per modul, masing-masing
memecah fitur ke empat layer (Database → Backend → API Route → Frontend),
lengkap dengan alur end-to-end dan catatan utang per fitur.
