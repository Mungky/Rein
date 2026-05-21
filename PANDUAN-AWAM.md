# Panduan REIN untuk Orang Awam

> Dokumen ini ditulis untuk **Project Manager, atasan, atau siapa pun yang tidak ngerti coding** tapi perlu paham gimana sistem REIN ini bekerja.
> Tidak ada istilah teknis yang tidak dijelaskan ulang. Ibaratnya seperti **menjelaskan cara kerja kantor pos modern** — bukan bahasa programmer.

---

## 1. Apa itu REIN?

REIN (singkatan dari **Remula Inti Rekayasa**) adalah **sistem kantor digital** untuk perusahaan engineering. Bayangkan REIN sebagai gabungan dari:

- 📁 **Lemari arsip raksasa** yang rapi (Perpustakaan Digital / DCC)
- 📋 **Papan tugas proyek** seperti to-do list bareng tim (Workspace)
- ✅ **Meja persetujuan** untuk approve/reject dokumen (Approvals)
- 🔐 **Petugas keamanan** yang memutuskan siapa boleh lihat dokumen apa (Access Control)
- 🤖 **Asisten AI** bernama NimBus yang bisa diajak ngobrol soal arsip (NimBus AI)
- 👤 **Ruang admin** untuk atur user dan hak akses (Admin)

Semuanya dalam **satu pintu masuk lewat browser** (Chrome, Edge, dll). Karyawan login pakai username & password, dan langsung bisa kerja.

---

## 2. Gambaran Besar — Bagaimana Datanya Mengalir?

```
┌────────────────┐       ┌──────────────────┐       ┌─────────────────────┐
│  Karyawan      │       │  Halaman Web      │       │  Mesin Backend       │
│  (Browser HP/  │ ────▶│  (yang dilihat    │ ────▶│  (otak yang ngolah   │
│  Komputer)     │       │  user)            │       │  data)               │
└────────────────┘       └──────────────────┘       └──────────┬──────────┘
                                                                │
                  ┌─────────────────────────────────────────────┼──────────────────┐
                  │                              │              │                  │
            ┌─────▼─────┐                  ┌─────▼─────┐  ┌─────▼─────┐    ┌──────▼─────┐
            │ Database  │                  │ Google    │  │ Google     │   │ AI Lokal   │
            │ (catatan  │                  │ Drive     │  │ Sheets     │   │ (NimBus/   │
            │ semua     │                  │ (gudang   │  │ (laporan   │   │ Ollama)    │
            │ metadata) │                  │ file PDF/ │  │ Excel)     │   │            │
            │           │                  │ DWG, dll) │  │            │   │            │
            └───────────┘                  └───────────┘  └────────────┘   └────────────┘
```

**Penjelasan setiap kotak:**

| Kotak | Fungsi | Analogi |
|---|---|---|
| **Browser** | Tempat karyawan klik-klik & ngetik | Layar TV |
| **Halaman Web** (Frontend) | Tampilan yang user lihat — tombol, form, daftar | Resepsionis di lobi kantor |
| **Mesin Backend** (Server) | Otak yang ngolah perintah | Bagian belakang restoran — dapur |
| **Database** | Buku besar berisi catatan: siapa upload apa, kapan, ke mana | Buku tamu hotel |
| **Google Drive** | Penyimpanan file PDF/Excel/DWG asli | Lemari arsip fisik |
| **Google Sheets** | Daftar Excel otomatis untuk laporan | Buku catatan akuntan |
| **NimBus AI** | Asisten cerdas yang bisa dicari pakai bahasa biasa | Pegawai library yang pintar |

---

## 3. Alur Lengkap: Dari User Klik Sampai File Tersimpan

Mari kita ambil contoh paling penting: **upload dokumen ke Perpustakaan Digital**.

### Langkah 1 — Karyawan pilih file di komputernya
User buka halaman REIN, masuk ke menu **DCC (Perpustakaan Digital)**, lalu drag-and-drop file (misal: `INV-001-MBP Faktur Pembelian.pdf`) ke kotak upload.

### Langkah 2 — Browser ngecek file dulu (sebelum upload)
Sebelum file dikirim ke kantor (server), browser-nya user **menghitung "sidik jari" file** (namanya SHA-256 hash — anggap aja seperti **kode unik tiap file** yang akan selalu sama walau filenya di-rename).

Lalu browser nelpon server: *"Hei, ini file punya sidik jari XYZ — udah pernah ada belum?"*

→ Tahap ini disebut **PROPOSE**.

### Langkah 3 — Server cek di buku catatan (Database)
Server cek di database:
- Apakah sidik jari ini sudah pernah diupload? Kalau iya, tampilkan warning kuning: *"File ini sudah pernah ada, diupload oleh Pak Budi tanggal X. Tetap mau upload?"*
- Server juga membaca nama filenya, lalu menebak: **tipe dokumen apa, klien siapa, proyek mana** (dari pola nama file seperti `INV-001-MBP`).

### Langkah 4 — User review & klik CONFIRM
Layar nampilkan metadata yang ditebak otomatis. User bisa edit kalau salah, lalu klik tombol **Upload**.

### Langkah 5 — File benar-benar dikirim ke server
File asli dikirim dari browser ke server pakai metode aman (HTTPS — sambungan terenkripsi seperti SMS aman).

### Langkah 6 — Server upload ke Google Drive (folder TEMP)
Server **belum** langsung naruh file di folder departemen yang final. Dia naruh dulu di folder **TEMP** (semacam ruang tunggu) di Google Drive. Kenapa? Karena file harus **diaudit dulu**.

### Langkah 7 — Server bilang "OK, terima" ke browser (cepat)
Server bilang ke user: *"File diterima, sedang diproses"*. User tidak perlu nunggu lama — proses audit berjalan di belakang layar.

### Langkah 8 — Audit 4-Lapis Berjalan di Latar Belakang
Sistem pemeriksa kualitas file berjalan otomatis (lihat detail di Bagian 5 di bawah).

### Langkah 9 — Kalau Audit LULUS
- File **dipindah** dari folder TEMP ke folder departemen yang seharusnya di Google Drive
- Catatan otomatis ditambahkan ke **Google Sheets** (untuk laporan)
- Status di database berubah jadi `passed` (lulus)
- User melihat file muncul rapi di Perpustakaan Digital

### Langkah 10 — Kalau Audit GAGAL
- File **tetap di TEMP** (tidak diapus, jadi bisa diperbaiki)
- Status berubah jadi `failed`
- Admin bisa lihat & bersihkan di panel khusus

```
PILIH FILE → PROPOSE (sidik jari) → CONFIRM (user setuju)
   → UPLOAD ke folder TEMP di Drive
   → [audit 4 lapis di latar belakang]
   → LULUS → file pindah ke folder final + dicatat di Sheets
   → GAGAL → tetap di TEMP, admin diberitahu
```

---

## 4. Teknologi & Library yang Dipakai — dan Untuk Apa

Berikut daftar "alat-alat" yang kami pakai. Saya jelaskan **fungsinya pakai analogi**, bukan istilah teknis.

### 🎨 Bagian Tampilan (Frontend — yang user lihat)

| Nama | Fungsi | Analogi |
|---|---|---|
| **Next.js 16** | Framework utama untuk bikin halaman web | Cetakan kue — bantu bangun halaman lebih cepat |
| **React 19** | Library untuk bikin tombol, form, list yang interaktif | Lego untuk bangun UI |
| **TypeScript** | Bahasa pemrograman yang ngecek error sebelum dijalanin | Spell-checker untuk kode |
| **Tailwind CSS** | Bikin tampilan rapi (warna, jarak, font) | Set kuas cat siap pakai |
| **Zustand** | Nyimpan data sementara di browser user (misal: data form yang lagi diisi) | Sticky note di meja user |
| **@dnd-kit** | Buat fitur drag-and-drop (geser tugas di Kanban) | Tangan virtual yang bisa drag |
| **lucide-react** | Library icon-icon (panah, folder, dll) | Buku stiker icon |
| **sonner** | Nampilin notifikasi popup ("Upload sukses!") | Speaker untuk pengumuman |
| **@supabase/ssr** | Bantu kelola login user di halaman web | Penjaga kunci ruangan |

### 🧠 Bagian Otak (Backend — yang ngerjain kerja berat)

| Nama | Fungsi | Analogi |
|---|---|---|
| **Python 3.11** | Bahasa pemrograman utama untuk server | Bahasa kerja dapur |
| **FastAPI** | Framework yang nerima request dari halaman web & balas data | Resepsionis cepat & rapi |
| **uvicorn** | Mesin yang menjalankan FastAPI 24/7 | Mesin diesel server |
| **SQLAlchemy** | Bridge antara kode Python dan Database | Penerjemah Inggris-Indonesia |
| **asyncpg** | Driver supaya Python bisa ngobrol cepat dengan PostgreSQL | Kabel serat optik ke database |
| **Alembic** | Tool untuk mengelola perubahan struktur database (tambah kolom, dll) | Tukang renov database |
| **Pydantic** | Validator data — pastiin user kirim data yang benar | Petugas imigrasi yang ngecek paspor |
| **httpx** | Untuk nelpon Google Drive, Google Sheets, AI dari server | Telepon kantor |
| **python-jose** | Bantu verify token login (JWT) — pastiin user yang ngaku admin beneran admin | Petugas verifikasi tanda tangan |
| **slowapi** | Rate limiter — cegah 1 user spam upload 1000x dalam semenit | Polisi lalu lintas |
| **aiosmtplib** | Kirim email notifikasi pakai Gmail | Tukang pos |

### 🗄️ Penyimpanan Data

| Nama | Fungsi | Analogi |
|---|---|---|
| **PostgreSQL** (via Supabase) | Database utama — nyimpan semua catatan (siapa upload apa, role user, dll) | Buku besar kantor |
| **Supabase Auth** | Sistem login & manajemen user | Penjaga gerbang yang punya daftar tamu |
| **Google Drive** | Tempat nyimpan file fisik (PDF, DWG, Excel asli) | Gudang barang |
| **Google Sheets** | Backup laporan dalam format Excel | Buku catatan akuntan |

### 🤖 Bagian AI

| Nama | Fungsi | Analogi |
|---|---|---|
| **Ollama** | Software untuk jalanin AI lokal di server kami sendiri | Kompor di dapur (bukan beli makanan luar) |
| **NimBus** | Nama asisten chatbot REIN — bisa diajak ngobrol, cari dokumen, request akses | Pegawai resepsionis virtual |
| **glm-5.1** | Model AI yang dipakai NimBus untuk ngerti bahasa Indonesia | Otak si pegawai virtual |

### ☁️ Hosting (Tempat Sistem Tinggal di Internet)

| Nama | Fungsi | Analogi |
|---|---|---|
| **Vercel** | Hosting halaman web (frontend) | Toko sewaan untuk etalase |
| **Coolify / VPS** | Hosting backend server | Pabrik tempat dapur produksi |
| **Docker** | Bungkus semua software jadi satu paket yang gampang dipindah | Container kontener kapal |
| **Railway** | Alternatif hosting backend | Toko sewaan lain |

---

## 5. Sistem Audit 4-Lapis — Pemeriksa Kualitas Otomatis

Setiap file yang di-upload akan **diperiksa otomatis** dalam 4 tahap sebelum dianggap "final". Anggap aja seperti **karantina barang impor di bandara**:

### 🔍 Lapis 1 — Cek Format Nama File
**Pertanyaan:** Apakah nama filenya sesuai aturan REIN?
- Contoh BENAR: `INV-001-MBP Faktur Pembelian.pdf`
- Contoh SALAH: `dokumen baru.pdf` (tidak ada kode tipe)

Tipe yang valid: **Q, DRW, INV, PO, SPK, RFP, RPT, SPEC, OTHER**

→ Kalau salah format → ditolak, kasih alasan ke user.

### 📂 Lapis 2 — Cek Folder Tujuan
**Pertanyaan:** Apakah folder tujuannya valid & aktif?

→ Kalau folder udah dihapus admin atau dinonaktifkan → ditolak.

### 🔁 Lapis 3 — Cek Duplikat
**Pertanyaan:** Apakah file ini sudah pernah ada?
- Cek 1: Sidik jari SHA-256 — kalau byte filenya sama persis, dianggap duplikat.
- Cek 2: Nama file sama di folder yang sama.

→ Kalau duplikat → ditolak, kasih tau filenya udah ada di mana.

### 🤖 Lapis 4 — Cek dengan AI (Tidak Memblokir)
**Pertanyaan ke AI:** *"Nama file ini sesuai gak sama tipe dokumennya?"*

AI ngasih opini, tapi **TIDAK akan memblokir upload**. Cuma informasional — biar admin tau kalau AI curiga sesuatu.

→ Kalau AI mati / tidak respons → langsung lewat.

**Kalau 4 lapis ini LULUS** → file dipindah dari TEMP ke folder departemen final di Google Drive, dan dicatat di Google Sheets.

---

## 6. Sistem Monitoring & Log — Apa yang Berjalan di Latar Belakang?

Sistem REIN punya beberapa **"penjaga" yang kerja otomatis 24/7** tanpa user perlu klik apa-apa. Anggap aja seperti **petugas malam kantor**.

### A. Task Queue (Antrian Pekerjaan Latar Belakang)

Ada sebuah **antrian kerja** yang menampung tugas-tugas yang tidak perlu dikerjakan instan. Daripada bikin user nunggu lama, server bilang "OK terima" dulu, lalu masukin tugas ke antrian.

**Tugas-tugas yang masuk antrian:**

| Tugas | Kapan dipicu | Apa yang dikerjain |
|---|---|---|
| `INDEX_TO_SHEETS` | Setelah audit file LULUS | Tambah satu baris di Google Sheets untuk laporan |
| `SEND_EMAIL` | Saat ada request akses, approval, dll | Kirim email notifikasi via Gmail |
| `CLEANUP_EXPIRED_PROPOSALS` | Tiap 5 menit | Hapus proposal upload yang nggak jadi |
| `REVOKE_EXPIRED_ACCESS` | Tiap 5 menit | Cabut akses sementara yang sudah expired (lebih dari 15 menit) |
| `CLEANUP_EXPIRED_VIEW_REQUESTS` | Tiap 5 menit | Hapus permintaan lihat file yang nggak direspons (TTL 5 menit) |
| `AUDIT_FILE` | Setelah file upload | Jalanin 4 lapis audit di belakang layar |

### B. Pembersih Otomatis (Periodic Cleanup)

Setiap **5 menit**, sistem ngecek:
- File yang stuck "uploading" lebih dari **10 menit** → otomatis dianggap `failed` (biar admin bisa bersihin).
- Proposal yang sudah expired → dibatalin, file di Drive TEMP dihapus.
- Permintaan akses yang sudah lewat waktu → status diubah jadi `expired`.

**Kenapa perlu?** Kadang ada gangguan koneksi internet, server restart, dll — file bisa "nyangkut" di tengah jalan. Pembersih ini ngurus biar tidak ada record gantung.

### C. Log Aktivitas Pustaka (Library Audit Log)

**Setiap aksi yang penting dicatat di tabel `library_audit_log`**, mirip CCTV digital. Yang dicatat:

| Aksi | Artinya |
|---|---|
| `propose` | User mengusulkan upload file |
| `confirm` | User mengonfirmasi upload |
| `upload` | File benar-benar di-upload |
| `audit_pass` / `audit_fail` | Hasil audit |
| `view_request` | User minta lihat isi file |
| `view_approved` / `view_denied` / `view_expired` | Hasil persetujuan view |
| `file_delete` | File dihapus |
| `folder_create` / `folder_edit` | Aktivitas folder |
| `cancel` | Proposal dibatalkan |

**Setiap log mencatat:** Siapa pelakunya, kapan, target apa, plus detail metadata (JSON). Admin bisa lihat semua riwayat lewat panel `/api/library/log`.

### D. Log Sistem (Logger Python)

Server pakai **Python `logging` module** untuk nyimpan log ke konsol/file. Levelnya:

- `INFO` — Aktivitas normal ("Upload sukses", "Email terkirim")
- `WARNING` — Peringatan ringan ("Folder belum dihubungkan ke Drive")
- `ERROR` — Masalah serius ("Drive upload gagal", "Email tidak terkirim")

Log ini dibaca admin/developer kalau ada bug atau perlu investigasi.

### E. Rate Limiter (Pembatas Kecepatan)

Pakai **slowapi** untuk batasi berapa kali user bisa hit endpoint tertentu:
- `POST /propose` → **60 kali per menit** per IP
- `POST /upload` → **30 kali per menit** per IP

**Tujuannya:** Cegah serangan brute force atau user iseng spam server.

### F. Pengecekan Kesehatan Server (Health Check)

Endpoint `GET /api/health` selalu return `{"status": "ok"}`. Dipakai oleh:
- Vercel / Coolify untuk monitor — kalau endpoint ini mati, alert ke admin.
- Load balancer untuk tau kapan harus restart server.

---

## 7. Sistem Keamanan & Hak Akses

### Login
- User login pakai **username** (bukan email asli) — sistem otomatis bikin email sintetis di belakang layar untuk Supabase Auth.
- Admin di-hardcode di environment variable — tidak bisa dibuat dari UI biasa.

### Role-Based Permissions
Ada **10 role** (admin, director, manager, engineer_*, finance, dll) × **17 permission** (dcc:view, dcc:upload, dst). Disimpan di tabel `role_permissions`. Admin bisa edit matrix-nya dari panel admin.

### Hak Akses Folder
Per folder departemen, bisa diatur granular:
- `can_view` / `can_upload` / `can_download` / `can_rename` / `can_delete` / `can_move`

Ini per **role × departemen**, jadi misal: engineer mekanikal cuma boleh upload ke folder Mekanikal, tidak ke Sipil.

### Akses Sementara (Temporary Access)
Kalau user **tidak punya hak download** tapi perlu lihat file:
1. User klik "Minta Akses" → POST `/api/library/view-request`
2. Email otomatis dikirim ke **Pustakawan** (Director + Manager)
3. Pustakawan klik link "Approve" di email
4. User dapat **link sementara 30 menit** untuk lihat file
5. Kalau dalam **5 menit tidak ada Pustakawan yang approve** → request expired

---

## 8. Ringkasan Singkat untuk Pak/Bu PM

Kalau cuma punya waktu 30 detik, ingat ini:

1. **REIN = sistem kantor digital all-in-one** untuk perusahaan engineering. Akses lewat browser.

2. **Cara kerja file upload:** User pilih file → browser hitung sidik jari → server cek duplikat → user confirm → file masuk Google Drive TEMP → **diaudit 4 lapis** → kalau lulus pindah ke folder final & dicatat di Google Sheets.

3. **Teknologi inti:** Next.js + React (tampilan), Python FastAPI (otak), PostgreSQL (catatan), Google Drive (file), Ollama AI (asisten cerdas).

4. **Yang berjalan di latar belakang:**
   - Antrian tugas (email, indexing Sheets, audit file)
   - Pembersih otomatis tiap 5 menit (file nyangkut, request expired)
   - Audit log lengkap (siapa-apa-kapan)
   - Rate limiter (cegah spam)
   - Health check (monitor server hidup-mati)

5. **Keamanan:** Login per username, role-based permission, folder permission granular, akses sementara 30 menit untuk file sensitif.

6. **Kalau ada error:** Admin punya panel Temp untuk lihat file gagal/nyangkut & bersihin sekali klik.

---

## 9. Buat Bertanya Lebih Lanjut

- **Dokumentasi teknis lengkap:** [`docs/REIN-Technical-Documentation.md`](docs/REIN-Technical-Documentation.md)
- **Panduan setup:** [`SETUP.md`](SETUP.md)
- **Changelog:** [`README.md`](README.md) bagian "What's new"

Kalau ada hal yang belum jelas dari dokumen ini, **tanya ke developer** dan tunjuk ke bagian mana yang masih membingungkan — biar kami perbaiki dokumennya juga.
