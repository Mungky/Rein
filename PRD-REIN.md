# PRD — REIN (Remula Engineering INtegrated tracker)

| | |
|---|---|
| Produk | REIN, aplikasi web internal untuk pelacakan project PT Remula Inti Rekayasa |
| Versi dokumen | 1.0 · 15 November 2026 |
| Status | Siap untuk implementasi MVP |
| Desain | Figma "REIN — UI/UX": https://www.figma.com/design/m6TD7AHjnmgljGiPNT00f7 |
| Pembaca utama | Coding agent / tim engineering |
| Bahasa UI | Bahasa Indonesia. Istilah teknis tetap dalam bahasa Inggris (Kanban, Timeline, S-Curve, Worklist, Logbook, PIN, OTP, dll.) |

> **Cara membaca dokumen ini.** Setiap requirement punya ID (`FR-xxx`, `NFR-xxx`). Acceptance criteria (AC) ditulis agar bisa diuji otomatis. Nama frame Figma ditulis seperti `D/05a`, `M/07`, `P3-1`. Halaman Figma: **Tokens & Components**, **Desktop**, **Mobile**, **Prototype**, dan **Cover**. Fitur bertanda **[USULAN]** tidak ada di brief. Fitur itu boleh ditunda dan **tidak wajib untuk MVP**.

---

## 1. Ringkasan, tujuan, non-goals

> **Revisi 1.10 (19 Nov 2026, permintaan pengguna).** Aktivitas tampil per project sebagai tab sejajar dengan Worklist, Dokumen, dan Material. Tab aktif tersimpan di URL. Worklist memakai satu panel Filter dan anggota project di HP dibuka dari tombol Anggota. Material ditambah dari baris kosong dan diubah langsung pada barisnya, dengan kartu responsif di HP. Status Material mencakup Need review. Tanggal Diterima hanya digunakan pada status PO. Part No. dihilangkan dari tampilan dan input manual, serta tetap dibaca pada impor lama untuk pencocokan duplikat. Beberapa material dapat dipilih untuk dihapus dan dipulihkan dalam satu transaksi.

### 1.1 Ringkasan
> **Revisi 1.9 (18 Nov 2026, permintaan pengguna):** Material dapat dihapus (soft delete, dengan aksi Batalkan), serta dihubungkan/dilepas ke beberapa WO dalam project yang sama. Material terhubung ditampilkan pada detail WO. Izin pengelolaan tetap `wo.create`. Input manual, impor, edit, dan pemulihan mencegah duplikat berdasarkan kombinasi Part No., Description, Material, Spesifikasi, dan Satuan yang dinormalisasi (huruf kecil, spasi dirapikan); jumlah/status/tanggal/note bukan identitas baru. Impor melewati duplikat dan melaporkan jumlahnya. Duplikat lama tidak digabung atau dihapus otomatis agar catatan dan hubungan tidak hilang. Perubahan bersamaan diserialkan per project. Revisi ini menggantikan perilaku impor ulang yang menambahkan baris pada revisi 1.8.

REIN melacak setiap project fabrikasi (mixing tank, storage tank, reaktor, panel, line otomasi) mulai **PO diterima** sampai **Selesai**. Status Selesai ditentukan manual oleh pengguna yang memiliki izin `project.close`; tidak mensyaratkan punch list habis, tanggal serah terima, ataupun lampiran BAST.

Pelunasan terjadi setelah itu dan **berada di luar REIN**.

Hierarki konten: **Project → Work Order (WO) → Logbook entry → Attachment**. Attachment juga bisa melekat langsung di Project atau di WO.

> **Revisi 1.1 (15 Nov 2026):** project **tidak punya tahapan baku**. Proses berjalan **paralel** dan menjadi **kategori Jenis WO**. Project hanya punya status **Berjalan / Ditunda / Selesai** (§4.4). Progres dirangkum **per kategori** (§8.4).
>
> **Revisi 1.8 (18 Nov 2026, permintaan pengguna):** Logbook menerima progres WO (0–100%) dan status catatan Aktivitas/Dokumen/Kendala, keduanya opsional. Progres hanya boleh diubah PIC dengan `wo.edit.own` atau pemegang `wo.edit.any`, dicatat atomik bersama `progress_events`, dan tidak mengubah status WO. Tab Material menyediakan daftar per project (Part No., Description, Material, Size or Specification, QTY angka + satuan, status In stock/Not available/PO, tanggal diterima, Note), input manual, edit, dan impor `.xlsx` dengan pratinjau. Pengelolaan Material mengikuti izin `wo.create` pada project; membaca mengikuti `project.view`. Ini pelacakan kebutuhan project, tanpa mutasi stok lintas project atau data keuangan. Tab Lampiran menjadi Dokumen; kategori tidak ditampilkan/dipilih. Tombol Attach menghubungkan file ke satu atau beberapa WO dalam project yang sama tanpa memindahkan atau menghapus file asal. Aturan transisi WO §4.5 tetap berlaku; syarat Logbook sebelum Review ditampilkan. Revisi ini menggantikan pembatasan Logbook pada revisi 1.6/FR-040 AC2 dan larangan daftar material pada §1.3.
>
> **Revisi 1.7 (17 Nov 2026, permintaan pengguna):** self-host di `staff.remula.online` memakai **database baru** dan **penyimpanan server** (`LocalDriver`, volume permanen `app-uploads`, path `/app/uploads`). Akses file tetap diperiksa server. **Gmail API/email ditunda** (`MAIL_PROVIDER=null`); WhatsApp menjadi kanal aktif. Google Cloud, Gmail, dan Login Google bukan syarat deployment tahap ini. Compose produksi berada di root repository (`docker-compose.yml`, Coolify Base Directory `/`, branch `main`). Backup harus mencakup PostgreSQL dan volume lampiran serta salinan di luar server. Revisi ini menggantikan kewajiban GCS/Gmail dan lokasi Compose pada §7/§11; lihat `docs/SELFHOST-COOLIFY.md`.
>
> **Revisi 1.4:** batas lampiran **50 MB per file**. Lampiran dan foto profil disimpan di **Google Cloud Storage** (bucket privat, region Jakarta). Email dikirim lewat **Gmail API**. Ditambah **Login dengan Google** (FR-006). Backup database ke GCS (§7, §11.4). Pilihan deployment saat ini mengikuti revisi 1.7.
>
> **Revisi 1.6 (16 Nov 2026, permintaan pengguna):** project ditutup manual; logbook hanya catatan/lampiran; lampiran project merangkum WO dan logbook; tugas dan notifikasi disatukan di Beranda; daftar project hanya Card. Role & Izin, Timeline dan S-Curve mengikuti frame Figma. Sidebar memakai dropdown akun, tema tetap di topbar, kalender dan jam WIB ditambahkan. Lihat `docs/WORKSPACE-REVISION.md`.
>
> **Revisi 1.5 (16 Nov 2026, permintaan pengguna):** onboarding hanya nomor WhatsApp → OTP dikirim bot dan diinput di aplikasi → PIN opsional → nama panggilan dan foto opsional. Email dikonfigurasi setelah masuk dari Profil. Revisi ini menggantikan verifikasi WA dibalik dan kewajiban PIN pada revisi sebelumnya. Akun lama yang sudah dipakai tetap dapat masuk.
>
> **Revisi 1.3:** WhatsApp memakai **OpenWA** self-host (engine `baileys`) dengan nomor baru khusus; mekanisme verifikasi mengikuti revisi 1.5 (§10.4, FR-003). Checklist persiapan dan stack final ada di `BUILD-KICKOFF.md`.
>
> **Revisi 1.2:** kategori diringkas menjadi **6 kategori berwarna**: Engineering, Pengadaan, Produksi, QC & Testing, Pengiriman & Serah Terima, Umum (§4.2, §9.9). Form Buat WO mendukung lampiran (FR-030).

### 1.2 Tujuan (terukur)
| ID | Tujuan | Indikator keberhasilan (3 bulan setelah go-live) |
|---|---|---|
| G1 | Satu sumber kebenaran untuk status project & WO | ≥ 90% project aktif tercatat di REIN; tidak ada lagi rekap WO di spreadsheet terpisah |
| G2 | Penugasan sampai ke orangnya dalam hitungan detik | Notifikasi WA/email untuk WO baru terkirim ≤ 60 detik setelah disimpan (p95) |
| G3 | Kendala cepat sampai ke manager | Median waktu dari "Butuh bantuan" sampai balasan manager ≤ 4 jam kerja |
| G4 | Progres terlihat tanpa rapat | Manager membuka Kanban/Timeline/S-Curve ≥ 3×/minggu; deviasi S-Curve terlihat per project |
| G5 | Ringan di lapangan | Lulus performance budget NFR-001 s.d. NFR-006 di koneksi Slow 4G |

### 1.3 Non-goals (eksplisit)
- **Tidak ada fitur keuangan.** Tidak ada invoice, nominal harga/nilai PO/RAB/biaya, termin, atau status pembayaran. Field angka uang **dilarang** di skema data.
- Tidak ada akses publik. REIN hanya bisa diakses dari jaringan kantor atau VPN. Notifikasi keluar (WA & email) tetap berjalan.
- Bukan ERP atau inventory. Tidak ada stok material, BOM terstruktur, atau purchase order ke vendor. "Belanja" hanya dicatat sebagai WO beserta lampirannya (mis. surat belanja).
- Tidak ada portal klien. Klien tidak punya akun.
- Tidak ada chat real-time umum. Komunikasi melekat ke WO lewat logbook/komentar.
- Tidak ada aplikasi native. REIN berupa PWA (installable).

---

## 2. Persona, role, dan matriks izin

### 2.1 Persona
| Persona | Contoh (data contoh di Figma) | Perangkat utama | Kebutuhan inti |
|---|---|---|---|
| Manager / PM | Rina Pratiwi | Laptop + HP | Buat project & WO, memantau progres, merespons "Butuh bantuan" |
| Engineer / Drafter | Udin Saputra, Amba Wijaya | Laptop (gambar) + HP | Menerima WO, mengisi logbook, mengunggah gambar/foto, minta bantuan |
| Produksi | Bayu Prakoso | **HP** di workshop | Melihat WO fabrikasi, memfoto progres, mengubah status |
| Purchasing | Dewi Lestari | Laptop + HP | WO Belanja, unggah surat belanja |
| QC | Sari Handayani | HP + tablet | WO QC, unggah dokumen QC/foto |
| Admin | Fajar Nugroho | Laptop | Kelola pengguna, role & izin, jenis WO |

### 2.2 Model role
- **Revisi 16 November 2026 (permintaan user):** satu role global tetap menjadi dasar izin. Admin dapat memberi override per pengguna untuk setiap permission dan scope, termasuk `none` untuk menolak akses. Menghapus override mengembalikan izin dari role. Izin efektif selalu diperiksa server; akses administrasi Admin bawaan tetap dilindungi.
- **Role = divisi + sekumpulan permission flag**, bukan hierarki. Satu user punya tepat **satu role global**. Contoh role: Manager, Engineering/Drafting, Produksi, Purchasing, QC, Admin.
- Selain role global, user punya **peran di project** (teks bebas atau pilihan, mis. "Project Manager", "Drafter", "Kepala Produksi") lewat `project_members.project_role`. Peran di project bersifat informatif, **kecuali** `is_project_manager = true`. Flag itu memberi status "pengelola" project tersebut, yang dipakai sebagai scope **Project yang dikelola**.
- **Scope izin:**
  - `all`: semua project.
  - `managed`: project tempat user adalah pengelola (`is_project_manager`).
  - `member`: project tempat user menjadi anggota.
  - `own`: objek yang dibuat user atau di-assign ke user.
- Izin dievaluasi di server untuk **setiap** request. UI hanya menyembunyikan aksi, tidak menjadi satu-satunya pengaman.

### 2.3 Daftar permission (kunci final)
Frame Figma: `D/10b Admin — Role & Izin`.

| Kunci | Arti | Scope yang didukung |
|---|---|---|
| `project.view` | Melihat project & isinya | all / member |
| `project.create` | **Membuat project** (aturan wajib: hanya Manager ke atas) | — |
| `project.edit` | Edit info project, logo, banner, ubah status Berjalan ⇄ Ditunda | all / managed |
| `project.members.manage` | Tambah/hapus anggota & peran di project | all / managed |
| `project.close` | Menandai Selesai (dengan syarat §4.4) & arsip | all / managed |
| `wo.create` | Membuat WO | all / managed / member |
| `wo.edit.any` | Edit WO siapa pun (judul, jenis, PIC, deadline, urgent, bobot, status) | all / managed |
| `wo.edit.own` | Edit WO yang di-assign ke saya: status, progres, detail | own |
| `wo.delete` | Hapus WO (soft delete) | all / managed |
| `wo.weight.edit` | Ubah bobot WO untuk S-Curve | all / managed |
| `logbook.create` | Menulis logbook & komentar | member |
| `logbook.edit.own` | Edit/hapus entri sendiri ≤ 24 jam | own |
| `logbook.delete.any` | Hapus entri orang lain (moderasi) | all / managed |
| `attachment.upload` | Mengunggah lampiran | member |
| `attachment.delete.any` | Menghapus lampiran orang lain | all / managed |
| `view.scurve` | Melihat view S-Curve | all / member |
| `admin.users` | Kelola pengguna (undang, nonaktifkan, reset PIN/password) | — |
| `admin.roles` | Kelola role & permission | — |
| `admin.wo_types` | Kelola jenis WO | — |
| `admin.audit` | Melihat audit log | — |

### 2.4 Matriks izin default (seed)
Keterangan: ✓ = diizinkan (scope dalam kurung); — = tidak.

| Permission | Manager | Engineering/Drafting | Produksi | Purchasing | QC | Admin |
|---|---|---|---|---|---|---|
| project.view | ✓ (all) | ✓ (member) | ✓ (member) | ✓ (member) | ✓ (member) | ✓ (all) |
| project.create | ✓ | — | — | — | — | — |
| project.edit | ✓ (managed) | — | — | — | — | ✓ (all) |
| project.members.manage | ✓ (managed) | — | — | — | — | ✓ (all) |
| project.close | ✓ (managed) | — | — | — | — | — |
| wo.create | ✓ (member) | ✓ (member) | ✓ (member) | ✓ (member) | ✓ (member) | — |
| wo.edit.any | ✓ (managed) | — | — | — | — | — |
| wo.edit.own | ✓ | ✓ | ✓ | ✓ | ✓ | — |
| wo.delete | — | — | — | — | — | — |
| wo.weight.edit | ✓ (managed) | — | — | — | — | — |
| logbook.create | ✓ | ✓ | ✓ | ✓ | ✓ | — |
| logbook.edit.own | ✓ | ✓ | ✓ | ✓ | ✓ | — |
| logbook.delete.any | — | — | — | — | — | ✓ |
| attachment.upload | ✓ | ✓ | ✓ | ✓ | ✓ | — |
| attachment.delete.any | — | — | — | — | — | ✓ |
| view.scurve | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| admin.users | — | — | — | — | — | ✓ |
| admin.roles | — | — | — | — | — | ✓ |
| admin.wo_types | ✓ | — | — | — | — | ✓ |
| admin.audit | — | — | — | — | — | ✓ |

> Catatan: role **Admin** sengaja **tidak** mendapat `project.create` dan `wo.*`. Admin mengurus sistem, tidak mengelola project. "Manager ke atas" berarti role mana pun yang diberi `project.create` oleh admin.

---

## 3. User stories & functional requirements

Format AC: *Given / When / Then* atau poin yang bisa diuji. Prioritas: **P0** = MVP wajib, **P1** = iterasi 2, **P2** = iterasi 3+.

### 3.1 Autentikasi & akun (Figma `D/01a–d`, `M/01a–d`, `D/09`, `M/09`)

**US-01.** Sebagai karyawan, saya masuk dengan email/username + password lalu memverifikasi WhatsApp, memilih PIN opsional, dan melengkapi nama panggilan serta foto profil. Email dapat dihubungkan setelah masuk.

- **FR-001 (P0) Login password.**
  - AC1: Login dengan `email` **atau** `username` + password benar → sesi dibuat → redirect ke Beranda (atau ke URL `next` yang aman, path internal saja).
  - AC2: Kredensial salah → pesan generik "Email/username atau password salah", tanpa membedakan mana yang salah.
  - AC3: 10 kegagalan per akun dalam 15 menit → akun terkunci 15 menit. 30 kegagalan per IP dalam 15 menit → IP ditolak 15 menit (HTTP 429).
  - AC4: Checkbox "Ingat perangkat ini" → perangkat terdaftar sebagai *trusted device* (lihat FR-004).
- **FR-002 (P0) Aktivasi akun dari undangan.** Admin mengundang user (FR-090) → user menerima email berisi tautan aktivasi (berlaku 72 jam) → set password → masuk ke alur verifikasi.
  - AC: tautan bekas atau kedaluwarsa → halaman "Tautan tidak berlaku" + tombol "Minta tautan baru".
- **FR-003 (P0) Verifikasi email & WhatsApp** (`D/01b`, `M/01b`).
  - AC1: Email dihubungkan setelah masuk melalui Profil, bukan tahap onboarding. Email diverifikasi lewat kode 6 digit **atau** magic link (keduanya dikirim dalam satu email). Berlaku 15 menit, maksimal 5 percobaan per kode.
  - AC2 (revisi 1.5): nomor WA dinormalisasi ke E.164 (`+62…`). Bot OpenWA mengirim OTP 6 digit ke nomor tersebut; pengguna memasukkan OTP di aplikasi. Tidak ada kode dalam respons API atau tautan `wa.me`. Berlaku 10 menit, jeda kirim ulang 60 detik, maksimal 5 kode per akun/nomor per 24 jam dan 5 kode salah per tantangan. OTP terikat akun, disimpan sebagai HMAC, dan sekali pakai. Fallback jika gagal: Admin memverifikasi manual.
  - AC3: Notifikasi email/WA **hanya** dikirim ke kontak yang `verified_at` tidak null. Jika WA belum terverifikasi, kanal WA dilewati dan dicatat di log pengiriman.
  - AC4: Akun baru wajib memverifikasi WhatsApp sebelum mengakses aplikasi; email tidak wajib. Akun aktif lama yang sudah memiliki kontak terverifikasi tetap dapat masuk, termasuk Admin bootstrap untuk menyiapkan bot.
  - AC5: Mengubah email/WA (`D/09`) membuat kontak baru berstatus *pending*. Kontak lama tetap dipakai sampai yang baru terverifikasi.
- **FR-004 (P0) PIN & fast login** (`D/01c–d`, `M/01c–d`).
  - AC1: Setelah verifikasi WA, pengguna dapat membuat PIN 6 digit (dua kali input) atau memilih **Lewati dulu**. Pilihan disimpan dan tidak diminta ulang setelah onboarding selesai. Setelah pilihan PIN, pengguna mengisi nama panggilan (1–40 karakter) dan foto profil opsional, lalu **Mulai**. Nama resmi tidak berubah. PIN yang berurutan (123456, 654321) atau semua digitnya sama ditolak.
  - AC2: PIN **terikat ke perangkat**. Server menyimpan `device_id` + hash PIN (argon2id) per perangkat. PIN di perangkat A tidak berlaku di perangkat B.
  - AC3: Fast login: perangkat trusted yang sesinya terkunci (idle > 15 menit atau aplikasi dibuka ulang) menampilkan layar PIN berisi nama & avatar user.
  - AC4: 5 PIN salah berturut-turut → PIN perangkat itu dinonaktifkan dan user wajib login dengan password; PIN baru dapat dibuat dari Profil.
  - AC5: "Lupa PIN" → login password → buat PIN baru. Admin dapat mereset PIN semua perangkat user (FR-091).
  - AC6: Trusted device kedaluwarsa 30 hari tanpa aktivitas. Setelah itu wajib login password.
- **FR-005 (P0) Profil & keamanan** (`D/09`, `M/09`).
  - AC: User dapat mengganti foto (dipotong & dikompres di klien ke 256×256 WebP), password (wajib password lama; min. 10 karakter; ditolak jika ada di daftar 10k password umum), PIN, email/WA (verifikasi ulang), melihat daftar perangkat trusted, mencabut satu perangkat, dan "Keluar dari semua perangkat".
- **FR-006 (P0) Login dengan Google** (OpenID Connect, Google Cloud OAuth Client).
  - Halaman login (`D/01a`, `M/01a`) punya tombol **"Masuk dengan Google"** selain email/username + password.
  - AC1: Hanya akun yang **sudah terdaftar** di REIN (email Google cocok dengan `user_contacts` email yang aktif) yang bisa masuk. Email tidak dikenal → pesan "Akun Google ini belum terdaftar di REIN. Hubungi Admin." Tidak ada pendaftaran mandiri.
  - AC2: Login Google pertama kali otomatis menandai email sebagai terverifikasi (`verified_at`) dan menautkan `google_sub` ke user.
  - AC3: Setelah login Google, akun baru tetap wajib memverifikasi WA dan menjalani onboarding dengan PIN opsional (FR-003/004); sesi dan trusted device seperti login password.
  - AC4: Scope hanya `openid email profile`. Parameter `state` + PKCE wajib; `id_token` diverifikasi (issuer, audience, expiry, `email_verified = true`).
  - AC5: User tetap bisa login dengan password. Admin bisa menonaktifkan login password per user [P1].

### 3.2 Beranda (Figma `D/02`, `M/02`)
**US-02.** Sebagai user, saya langsung melihat tugas saya, yang urgent, yang jatuh tempo, dan permintaan bantuan.
- **FR-010 (P0)** Beranda menampilkan:
  - **Stat**: Tugas saya (WO aktif yang di-assign ke saya; status ∉ {Selesai, Dibatalkan}), Urgent (subset urgent), Jatuh tempo 7 hari, dan Butuh bantuan (untuk pengelola project: permintaan terbuka di project yang dikelola; untuk user lain: permintaan yang saya buat dan belum selesai).
  - **Callout "Butuh perhatian"**: maksimal 3 permintaan bantuan terbuka terbaru, dengan tombol Balas & Buka WO.
  - **Tabel/daftar "Tugas saya"**: urutan *terlambat → urgent → deadline terdekat*, maksimal 10 item, tautan "Lihat semua".
  - AC: Angka stat dihitung server, sesuai dengan daftar saat filter diterapkan, dan dimuat dalam satu request ≤ 20 KB JSON.
- **FR-011 (P1, revisi 1.6)** Tugas saya disatukan di Beranda, menampilkan 10 tugas teratas dan **Lihat semua** untuk membuka daftar lengkap di halaman yang sama. URL lama `/tugas` diarahkan ke `/#tugas`; tidak ada menu Tugas terpisah.

### 3.3 Project (Figma `D/03a–d`, `D/04a–b`, `D/05a–d`, `M/03a–d`, `M/04`, `M/05`)
**US-03.** Sebagai Manager, saya membuat project dengan form sederhana lalu mengundang anggota.
- **FR-020 (P0) Buat project.** Hanya user dengan `project.create`.
  - Field: Nama klien* (teks; autocomplete dari klien yang pernah dipakai), No RPO* (unik, format bebas, disarankan `RPO-YYYY-NNN`), Nama project*, Lokasi, Timeline mulai* & selesai* (selesai ≥ mulai), Deskripsi singkat (≤ 500 karakter), Logo klien (opsional), Banner (opsional).
  - AC1: RPO duplikat → error field "No RPO sudah dipakai project X".
  - AC2: Project baru berstatus **Berjalan** (tanggal PO diterima = `start_date`). Pembuat menjadi anggota dengan `is_project_manager = true` dan peran "Project Manager".
  - AC3: Langkah 2 (`D/04b`) mengundang anggota: cari user aktif per nama/divisi, pilih peran di project, hapus. Langkah ini bisa dilewati.
  - AC4: Setelah disimpan, anggota baru menerima notifikasi `project.member_added` (§6).
- **FR-021 (P0) Edit project & anggota** (izin `project.edit`, `project.members.manage`). Pengelola tidak bisa menghapus dirinya sendiri jika ia satu-satunya pengelola.
- **FR-022 (P0) Status project & progres per kategori.** Tidak ada tahapan. Header Detail Project (`D/05a`, `M/05`) menampilkan **satu bar kategori** dan legenda di bawahnya:
  - Bar: satu segmen per kategori yang punya WO; lebar segmen = porsi bobot kategori, isi segmen = progres kategori, warna = warna kategori.
  - Legenda: titik warna + nama kategori + `selesai/total · progres%`.
  - Status project: Berjalan / Ditunda / Selesai (§4.4). Perubahan dicatat di `project_status_history` + audit log + aktivitas.
  - AC: nilai dihitung otomatis dari WO; kategori tanpa WO tidak ditampilkan; klik item legenda memfilter worklist ke kategori itu (klik lagi untuk melepas).
- **FR-023 (P0) Lampiran project** merangkum file milik project, WO, dan logbook di project yang sama, dengan label asal. File yang dihapus, logbook yang dihapus, dan WO yang dihapus dikecualikan. PO/kontrak/spesifikasi/foto/BAST tetap dapat diunggah; BAST bukan syarat menutup project.
- **FR-024 (P0) Penutupan manual.** Pengguna dengan `project.close` dapat menandai project Selesai, termasuk dari status Ditunda. Tidak ada checklist atau validasi punch list/serah terima/BAST. Perubahan tetap dicatat di audit dan histori status; izin membuka kembali tetap berlaku.
- **FR-025 (P0) Daftar project** hanya memakai Card (komponen Project Card Figma), dengan pencarian dan filter status. Tidak ada Table atau Kanban pada daftar project. Worklist tetap mempunyai empat view.
- **FR-026 (P1) Arsip project.** Project Selesai > 90 hari tersembunyi dari default view. Filter "Tampilkan arsip" menampilkannya kembali.

### 3.4 Work Order (Figma `D/06`, `D/07a`, `M/06`, `M/07`)
**US-04.** Sebagai Manager, saya membuat WO, memilih jenis, PIC, deadline, dan urgent, lalu mengisi detail & lampiran.
- **FR-030 (P0) Buat WO.**
  - Field:
    - Nomor otomatis per project (`WO 01`, `WO 02`, …; berurutan dan tidak dipakai ulang walau ada WO yang dihapus).
    - Nama*, Jenis* (dari `wo_types` aktif), Penanggung jawab* (anggota project), Deadline*.
    - Mulai (rencana) (opsional; default = tanggal dibuat). **Catatan:** field ini tidak tampil di frame `D/06`/`M/06` dan perlu ditambahkan di form; lihat Asumsi A-07.
    - Urgent (boolean), Bobot % (opsional, izin `wo.weight.edit`), Detail pekerjaan (rich text ringan), Referensi (tautan ke WO lain, lampiran project, atau URL).
    - **Lampiran** (opsional, maks 10 file): dropzone klik atau drag-and-drop, plus kamera di mobile. Foto dikompres di klien (§7), file lain diunggah apa adanya (maks **50 MB per file**). Setiap file menampilkan progres, ukuran sebelum/sesudah kompresi, dan tombol hapus. Lampiran disimpan sebagai `attachments.owner_type = 'wo'` dan tampil di bagian "Lampiran WO" pada Detail WO.
    - Pemilih Jenis dikelompokkan per kategori (`<optgroup>`), dan di bawahnya tampil titik warna + nama kategori yang terpilih.
  - AC0: Tombol Buat WO nonaktif selama masih ada lampiran yang sedang diunggah. File > 50 MB atau tipe yang tidak diizinkan ditolak dengan pesan per file, sebelum upload dimulai (dicek di klien) dan dicek ulang di server.
  - AC1: PIC wajib anggota project. Memilih non-anggota menawarkan "Tambahkan sebagai anggota" (hanya jika punya `project.members.manage`).
  - AC2: Deadline < Mulai → error.
  - AC3: Setelah disimpan → notifikasi `wo.assigned` ke PIC (in-app + email + WA; pesan menyebut jumlah lampiran) dan toast "WO NN dibuat [dengan N lampiran] · notifikasi WA & email terkirim ke {nama}". Toast diganti "…gagal dikirim, akan dicoba lagi" jika enqueue gagal.
- **FR-031 (P0) Edit WO.** Semua perubahan field dicatat sebagai entri logbook otomatis bertipe `system`, mis. "Rina mengubah deadline 20 Nov → 24 Nov". Perubahan PIC/deadline/urgent memicu notifikasi ke PIC lama & baru.
- **FR-032 (P0) Status WO.** Mengikuti state machine §4.5. Perubahan bisa dari properti WO, kartu Kanban (drag), atau properti status WO; composer logbook tidak mengubah status.
- **FR-033 (P0) Detail WO** (`D/07a`, `M/07`): judul, jenis, flag Urgent, detail, referensi, lampiran WO, properti (Status, PIC, Pembuat, Jenis, Deadline, Urgent, Bobot, Progres), pengikut, logbook.
- **FR-034 (P0) Pengikut (watchers).** Pembuat, PIC, dan pengelola project otomatis menjadi pengikut. User lain bisa "Ikuti/Berhenti ikuti". Notifikasi logbook dikirim ke pengikut.
- **FR-035 (P0) Hapus WO** = soft delete (`deleted_at`). Hanya untuk izin `wo.delete`. Default seed: tidak ada role. WO yang dihapus tidak dihitung di S-Curve. Nomor WO tidak dipakai ulang.
- **FR-036 (P1) Shortcut.** `C` = buat WO (konteks project aktif), `Ctrl/Cmd+Enter` = simpan form.

### 3.5 Logbook (Figma `D/07a`, `M/07`, `P4-1`)
**US-05.** Sebagai Engineer, saya mencatat pekerjaan dan foto di logbook WO. Status WO diubah terpisah melalui properti WO.
- **FR-040 (P0) Tulis entri.**
  - Isi entri: teks (plain text + baris baru; tautan otomatis; `@mention` anggota project [P1]), dan lampiran (≤ 10 per entri).
  - AC1: Entri tersimpan dengan `author_id` dan `created_at` server (bukan waktu klien). Untuk entri yang dikirim dari antrean offline, waktu klien disimpan di `client_created_at`.
  - AC2 (revisi 1.8): progres integer 0–100 dan status catatan (`activity`, `document`, `issue`) opsional. Progres memerlukan izin edit WO dan versi `expectedUpdatedAt`; konflik ditolak 409. Progres, snapshot Logbook, audit, dan `progress_events` disimpan atomik. Status WO tetap melalui endpoint terpisah. WO selesai/dibatalkan tidak menerima pembaruan progres. Catatan/lampiran tanpa progres tetap dapat dikirim anggota.
  - AC3: Mengubah status WO menjadi `Selesai` melalui properti status membuat progres 100. Histori progres/status lama tetap dipertahankan.
  - AC4: Entri bisa diedit/dihapus oleh penulis ≤ 24 jam (`logbook.edit.own`). Edit menyimpan riwayat (`edited_at`) dan menampilkan label "diedit".
- **FR-041 (P0) Jenis entri:** `note` (catatan biasa), `comment` (balasan/komentar, mis. dari manager), `system` (perubahan field otomatis), `help_request`, `help_resolved`.
- **FR-042 (P0) Urutan & paginasi.** Terbaru di atas, 20 entri per halaman, tombol "Muat lebih lama". Lampiran ditampilkan sebagai thumbnail 96–120 px.

### 3.6 Butuh bantuan (Figma `D/07b`, `M/07b`, `D/08a`, `P5-1/P5-2`)
**US-06.** Sebagai Engineer, saya menandai kendala agar manager langsung tahu.
- **FR-050 (P0)** Tombol "Butuh bantuan" di WO → sheet/modal berisi teks kendala* (≤ 1.000 karakter) dan checkbox "Tampilkan flag di WO" (default aktif).
  - AC1: Membuat `help_requests` (status `open`) + entri logbook `help_request`.
  - AC2: Penerima: semua pengelola project + pembuat WO (tanpa duplikat, tanpa pengirim). Kanal: in-app + WA + email, **tidak terkena jam tenang & tidak bisa di-mute** (§6.4).
  - AC3: WO menampilkan badge merah "Butuh bantuan" di semua view sampai permintaan diselesaikan.
  - AC4: Hanya satu permintaan `open` per WO. Permintaan kedua menambah entri ke permintaan yang sama.
- **FR-051 (P0)** Manager membalas dari Notifikasi (`D/08a` panel pratinjau) atau dari WO. Balasan = entri logbook `comment`. Checkbox "Tandai bantuan selesai" → `help_requests.status = resolved` + entri `help_resolved` + notifikasi ke peminta.

### 3.7 Lampiran (Figma `D/06`, `D/07a`, `M/07`, `M/11d`)
- **FR-060 (P0)** Unggah dari form WO, composer logbook, atau panel lampiran project. Mobile mendukung kamera langsung (`<input type="file" accept="image/*" capture="environment">`) dan pemilih file.
- **FR-061 (P0)** Kompresi gambar di klien sebelum unggah, dengan progres terlihat ("Dikompres 3,2 MB → 240 KB · mengunggah 70%"). Spesifikasi ada di §7.
- **FR-062 (P0)** Pratinjau: gambar dibuka di lightbox (versi `display`), PDF di tab baru, file lain langsung diunduh. Semua akses lewat endpoint yang terautentikasi.

### 3.8 View & pencarian
- **FR-070 (revisi 1.6)** Worklist: Table, Kanban, Timeline, S-Curve. Daftar project: Card saja. Detail visual mengacu frame D/05a–d dan komponen Project Card.
- **FR-071 (P0)** Filter: kategori, jenis, PIC/assignee, urgent, status, deadline (terlambat / 7 hari / rentang), dan Butuh bantuan. Pengelompokan worklist: status, **kategori**, jenis, PIC, atau tanpa grup. Daftar project: status, klien, atau PIC. Urutan: deadline, nomor WO, terakhir diubah.
- **FR-072 (P1) View tersimpan per user.** View terakhir (tipe, filter, grup, urutan, grup ter-collapse) disimpan server-side per `user × context` dan dipulihkan di perangkat mana pun.
- **FR-073 (P1) Command palette** (`D/11a`, `M/11a`) dengan `Ctrl/Cmd+K` dan `/`. Cari WO (nomor/judul), project (nama/RPO/klien), dan orang. Aksi: Buat WO, Buat project, Tulis logbook di WO terakhir, Ganti tema, Buka notifikasi. Hasil ≤ 150 ms dari server (Postgres trigram).
- **FR-074 (P1) Shortcut keyboard:** `G B` Beranda, `G P` Project, `G N` Notifikasi, `C` buat WO, `?` daftar shortcut, `Esc` tutup.

### 3.9 Notifikasi (Figma `D/08a–b`, `M/08a–b`, `D/12a–b`, `M/12`)
- **FR-080 (P0, revisi 1.6)** Inbox in-app berada di Beranda; URL lama `/notifikasi` diarahkan ke `/#notifikasi`. Inbox: tab Semua / Belum dibaca / Butuh bantuan / Disebut; dikelompokkan per hari; "Tandai semua dibaca"; badge jumlah di menu Beranda sidebar & bottom nav; pembaruan real-time via SSE.
- **FR-081 (P0)** Email & WA sesuai matriks §6. Template ada di §6.3.
- **FR-082 (P1)** Preferensi per user per event per kanal, jam tenang, penggabungan (batching), ringkasan harian, dan mute project (`D/08b`, `M/08b`).

### 3.10 Admin (Figma `D/10a–c`, `M/10`)
- **FR-090 (P0) Pengguna:** daftar dengan cari & filter (divisi, status); undang (nama, username, role; **email dan nomor WA opsional**); ubah role; nonaktifkan/aktifkan; kirim ulang undangan; impor CSV [P1]. Tanpa email, Admin membagikan tautan aktivasi secara langsung. Setelah aktivasi pengguna dapat menghubungkan WhatsApp, email, atau keduanya; minimal satu kontak harus terverifikasi untuk membuka aplikasi.
  - Status: `invited`, `active`, `wa_unverified`, `disabled`.
  - AC: user `disabled` langsung kehilangan semua sesi dan tidak menerima notifikasi.
- **FR-091 (P0)** Reset password (kirim tautan) & reset PIN semua perangkat.
- **FR-092 (P0) Role & izin:** buat/duplikat/ubah nama/hapus role (hanya jika 0 user), toggle permission + scope. Perubahan berlaku pada request berikutnya (cache izin ≤ 60 detik).
- **FR-093 (P0) Jenis WO:** tambah, ubah nama/kode/kategori, urutkan (drag), nonaktifkan. Jenis yang sudah dipakai tidak bisa dihapus. Seed ada di §4.2.
- **FR-094 (P1) Audit log viewer** dengan filter user, entitas, aksi, dan tanggal; ekspor CSV.

---

## 4. Model data

### 4.1 Konvensi
- PostgreSQL 16. Primary key `id uuid` (UUIDv7, agar bisa diurutkan). Kolom wajib di setiap tabel: `created_at timestamptz default now()`, `updated_at`. Soft delete memakai `deleted_at` hanya di tabel yang disebut.
- Zona waktu tampilan `Asia/Jakarta`. Simpan dalam UTC.
- **Tidak ada kolom bertipe uang** (validasi CI: lint skema menolak kolom bernama `*price*|*amount*|*nominal*|*invoice*|*payment*`).

### 4.2 Entitas & field

```text
users
  id, username (unique, citext), full_name, avatar_attachment_id?, role_id → roles,
  google_sub? (unique; diisi saat login Google pertama),
  status enum(invited, active, disabled), password_hash (argon2id), password_changed_at,
  failed_login_count, locked_until?, last_active_at
user_contacts
  id, user_id, kind enum(email, whatsapp), value (email lowercased / E.164),
  verified_at?, is_primary bool, pending bool
  unique(kind, value) where verified_at is not null
verification_codes
  id, user_id, contact_id, purpose enum(verify_email, verify_whatsapp, activate, reset_password),
  code_hash, token_hash?, expires_at, attempts, consumed_at?
devices
  id, user_id, device_id (random 128-bit, dibuat klien), label (UA ringkas), pin_hash?,
  pin_failed_count, pin_disabled_at?, trusted_until, last_seen_at, revoked_at?
sessions
  id, user_id, device_id?, token_hash, created_at, last_seen_at, expires_at, locked bool, revoked_at?
roles
  id, name (unique), division_label, is_system bool
role_permissions
  role_id, permission_key, scope enum(all, managed, member, own, none)   pk(role_id, permission_key)
clients
  id, name (unique citext), logo_attachment_id?
projects
  id, client_id → clients, rpo_number (unique), name, location?, start_date, end_date,
  description (≤500), logo_attachment_id?, banner_attachment_id?,
  status enum(active, on_hold, done) default 'active',   -- label UI: Berjalan, Ditunda, Selesai
  on_hold_reason?, handover_date?, done_at?, archived_at?, created_by, next_wo_seq int default 1, deleted_at?
project_members
  project_id, user_id, project_role (text ≤ 40), is_project_manager bool, added_by
  pk(project_id, user_id)
project_status_history
  id, project_id, from_status, to_status, changed_by, note?, changed_at
wo_types
  id, name (unique), code (2–4 huruf, unique),
  category enum(engineering, procurement, production, qc_testing, shipping_handover, general),
                -- label UI: Engineering, Pengadaan, Produksi, QC & Testing, Pengiriman & Serah Terima, Umum
  sort_order, active bool, is_punch_list bool default false
work_orders
  id, project_id, seq int, number_label (generated 'WO ' || lpad(seq,2,'0')), title,
  type_id → wo_types, assignee_id → users, created_by, status enum(backlog, todo,
  in_progress, review, done, canceled), urgent bool, planned_start date, deadline date,
  weight numeric(5,2)? (0–100), progress smallint 0–100, detail_json (rich text AST),
  completed_at?, canceled_reason?, deleted_at?
  unique(project_id, seq)
wo_references
  id, wo_id, kind enum(wo, attachment, url), target_wo_id?, attachment_id?, url?, label
wo_watchers
  wo_id, user_id   pk(wo_id, user_id)
logbook_entries
  id, wo_id, author_id, kind enum(note, comment, system, help_request, help_resolved),
  body (≤ 5.000), progress_from?, progress_to?, status_from?, status_to?,
  client_created_at?, client_uuid (idempotensi offline, unique per author), edited_at?, deleted_at?
progress_events
  id, wo_id, progress, status, recorded_at, source_entry_id?
help_requests
  id, wo_id, requested_by, status enum(open, resolved), show_flag bool,
  resolved_by?, resolved_at?
attachments
  id, owner_type enum(project, wo, logbook, user, client), owner_id, category
  enum(general, po_client, contract, bast, qc_doc, photo, drawing, purchase_doc),
  file_name, mime, size_bytes, sha256, storage_key, width?, height?,
  thumb_key?, display_key?, uploaded_by, deleted_at?
notifications
  id, user_id, event_key, entity_type, entity_id, title, body, url, read_at?, created_at
notification_deliveries
  id, notification_id, channel enum(email, whatsapp), status enum(queued, sent, failed,
  skipped), provider_message_id?, attempts, last_error?, scheduled_for, sent_at?
notification_preferences
  user_id, event_key, email bool, whatsapp bool        pk(user_id, event_key)
user_settings
  user_id pk, quiet_start time default '21:00', quiet_end time default '07:00',
  quiet_enabled bool default true, batching_enabled bool default true,
  daily_digest bool default true, theme enum(system, light, dark)
project_mutes
  user_id, project_id   pk
saved_views
  user_id, context_key ('projects' | 'project:<uuid>:worklist' | 'my-tasks'),
  view_type enum(table, kanban, timeline, scurve), config_json   pk(user_id, context_key)
audit_logs
  id, actor_id?, action, entity_type, entity_id, diff_json, ip, user_agent, created_at
```

**Relasi kunci:**
- Project 1—N WO 1—N Logbook entry 1—N Attachment.
- Attachment polymorphic via `owner_type/owner_id`, divalidasi di aplikasi plus trigger pemeriksa keberadaan owner.
- Index wajib:
  - `work_orders(project_id, status)`, `work_orders(assignee_id, status, deadline)`
  - `logbook_entries(wo_id, created_at desc)`
  - `notifications(user_id, read_at, created_at desc)`
  - trigram `gin` pada `projects(name, rpo_number)`, `clients(name)`, `work_orders(title)`

**Seed `wo_types`** (nama, kode, kategori), sesuai frame `D/10c`:

| Jenis | Kode | Kategori |
|---|---|---|
| Gambar Detail | GD | Engineering |
| Gambar Proses | GP | Engineering |
| Skematik | SK | Engineering |
| Manufaktur Internal | MI | Produksi |
| Manufaktur Vendor | MV | Produksi |
| Belanja | BL | Pengadaan |
| Machining | MC | Produksi |
| QC | QC | QC & Testing |
| Testing & Commissioning | TC | QC & Testing |
| Pengiriman | KR | Pengiriman & Serah Terima |
| Punch List (`is_punch_list = true`) | PL | Pengiriman & Serah Terima |
| Meeting | MT | Umum |

Kategori adalah daftar tetap (enum) dengan warna tetap:

| Kategori | Token | Light | Dark |
|---|---|---|---|
| Engineering | `--c-eng` | `#5E6AD2` | `#8B95F0` |
| Pengadaan | `--c-pro` | `#C9971C` | `#E3B341` |
| Produksi | `--c-prd` | `#D9733A` | `#F0945A` |
| QC & Testing | `--c-qct` | `#22A39A` | `#3CC3B8` |
| Pengiriman & Serah Terima | `--c-ship` | `#9B5DD6` | `#B98AEE` |
| Umum | `--c-umum` | `#8A8F98` | `#9EA3AB` |

Admin mengatur jenis WO dan memilih kategorinya; warna mengikuti kategori, bukan jenis.

### 4.3 Constraint penting
- `projects.end_date >= start_date`; `work_orders.deadline >= planned_start`.
- `work_orders.assignee_id` harus ada di `project_members` (dicek di service layer + trigger).
- Bobot: jika total bobot eksplisit dalam satu project > 100, UI memperingatkan, lalu S-Curve menormalisasi (§8.4).
- Hapus user tidak diizinkan. Gunakan status `disabled`; data historis tetap.

### 4.4 State machine — status project
Project **tidak punya tahapan**. Proses berjalan paralel sebagai kategori WO.
```text
active (Berjalan) ⇄ on_hold (Ditunda)
active/on_hold → done (Selesai)   done → active (buka kembali)
```
- Berjalan ⇄ Ditunda: `project.edit`; alasan wajib saat Ditunda (tampil di kolom "Kategori aktif", mis. "Menunggu konfirmasi klien").
- Masuk `done`: manual oleh pengguna dengan `project.close`, tanpa prasyarat otomatis. `done_at = now()`.
- Keluar dari `done` (buka kembali): hanya role dengan `project.close` scope `all`, catatan wajib.
- Tidak ada panel atau hint syarat penyelesaian otomatis.

### 4.5 State machine — status WO
```text
backlog ⇄ todo ⇄ in_progress ⇄ review → done
   ↘        ↘          ↘          ↘
                 canceled (dari status mana pun kecuali done)
done → in_progress   (buka kembali; hanya wo.edit.any, alasan wajib)
```
| Dari → Ke | Siapa | Efek samping |
|---|---|---|
| backlog/todo → in_progress | PIC (`wo.edit.own`) atau `wo.edit.any` | `progress_events`; notifikasi `wo.status_changed` ke pembuat/pengelola (batching) |
| in_progress → review | PIC | notifikasi ke pembuat WO (langsung) |
| review → done | pembuat WO atau `wo.edit.any` | `progress = 100`, `completed_at` |
| review → in_progress | pembuat WO atau `wo.edit.any` | entri `system` "Dikembalikan: {alasan}" |
| * → canceled | `wo.edit.any` | alasan wajib; dikeluarkan dari S-Curve |
| done → in_progress | `wo.edit.any` | alasan wajib |

Label UI: Backlog, Belum Mulai, Dikerjakan, Review, Selesai, Dibatalkan (ikon di `Status Badge`).

**Terlambat** = `deadline < today` dan status ∉ {done, canceled}. Tanggal tampil merah. Ini atribut turunan, bukan status.

---

## 5. Spesifikasi autentikasi & keamanan sesi

| Aspek | Spesifikasi |
|---|---|
| Hash password & PIN | argon2id (m=19 MiB, t=2, p=1), pepper dari env `AUTH_PEPPER` |
| Sesi | Token acak 256-bit; hanya hash yang disimpan. Cookie `rein_sid`: `HttpOnly; Secure; SameSite=Lax; Path=/`. Masa berlaku 30 hari (sliding) di perangkat trusted, 12 jam di perangkat non-trusted |
| Kunci sesi (PIN) | Sesi `locked=true` jika idle > 15 menit (dihitung server dari `last_seen_at`) atau jika app dibuka ulang dan `sessionStorage` kosong. Request API selain `/auth/pin/unlock` → 423 Locked → UI layar PIN |
| Device binding | `device_id` dibuat klien (crypto.randomUUID), disimpan di IndexedDB + cookie `rein_did` (HttpOnly). PIN unlock butuh keduanya cocok |
| CSRF | SameSite=Lax + header `X-Requested-With: rein` untuk mutasi; tolak mutasi tanpa header |
| Rate limit | Login (FR-001 AC3); OTP WA 5/24 jam per nomor; email kode 5/jam; PIN 5 salah per perangkat |
| Password policy | ≥ 10 karakter; cek daftar password umum; tanpa aturan komposisi rumit |
| Reset password | Tautan sekali pakai berlaku 30 menit; mencabut semua sesi |
| Login Google | OIDC Authorization Code + PKCE; redirect URI `https://rein.remula.co.id/auth/google/callback`. `users.google_sub` disimpan (unik). OAuth consent screen di-*publish* (status *In production*) dengan scope dasar saja, agar tidak ada batas 100 test user |
| Logout semua | Mencabut semua `sessions` + `devices.trusted_until = now()` |
| Header keamanan | CSP ketat (`default-src 'self'`; `img-src 'self' blob: data:`; tanpa inline script), HSTS, X-Content-Type-Options, Referrer-Policy `same-origin`, Permissions-Policy (camera hanya `self`) |
| Event audit | login sukses/gagal, lockout, PIN dibuat/direset, kontak diubah/diverifikasi, logout semua, perubahan role/izin |

---

## 6. Spesifikasi notifikasi

### 6.1 Matriks event → penerima → kanal default
"Langsung" = dikirim segera (melewati batching). Kolom WA/Email = default preferensi (user bisa mengubah, kecuali yang terkunci 🔒).

| Event key | Pemicu | Penerima | In-app | Email | WA | Pengiriman |
|---|---|---|---|---|---|---|
| `wo.assigned` | WO dibuat / PIC diganti | PIC baru | ✓🔒 | ✓ | ✓ | Langsung |
| `wo.unassigned` | PIC diganti | PIC lama | ✓🔒 | ✓ | — | Batching |
| `help.requested` | Butuh bantuan | Pengelola project + pembuat WO | ✓🔒 | ✓🔒 | ✓🔒 | Langsung, abaikan jam tenang & mute |
| `help.resolved` | Bantuan diselesaikan | Peminta | ✓🔒 | ✓ | ✓ | Langsung |
| `wo.deadline_h1` | Job 07:00, deadline besok | PIC | ✓🔒 | ✓ | ✓ | Jam 07:00 |
| `wo.overdue` | Job 07:00, lewat deadline (sekali per hari, maks 3 hari) | PIC + pengelola | ✓🔒 | ✓ | ✓ (PIC saja) | Jam 07:00 |
| `wo.updated` | Deadline/urgent/judul diubah | PIC + pengikut | ✓🔒 | ✓ | — | Batching 15 menit |
| `wo.status_changed` | Status berubah | Pembuat WO + pengikut | ✓🔒 | ✓ | — | Batching 15 menit (review → langsung ke pembuat) |
| `logbook.created` | Entri baru | Pengikut (kecuali penulis) | ✓🔒 | — | — | Ringkasan harian (email) |
| `comment.mention` [P1] | `@user` di logbook | User yang disebut | ✓🔒 | ✓ | — | Batching 15 menit |
| `project.member_added` | Ditambahkan ke project | User tsb | ✓🔒 | ✓ | ✓ | Langsung |
| `project.status_changed` | Status project berubah (Ditunda/Berjalan/Selesai) | Semua anggota | ✓🔒 | ✓ | — | Ringkasan harian (Selesai → langsung) |
| `digest.daily` | Job 07:00 hari kerja | User dengan `daily_digest` | — | ✓ | ✓ (opsional, default off; aktif untuk role Manager) | 07:00 |

### 6.2 Arsitektur pengiriman
1. Domain event → tabel `notifications` (in-app) dibuat **di transaksi yang sama** dengan perubahan data (outbox pattern).
2. Worker (pg-boss) membuat `notification_deliveries` per kanal berdasarkan preferensi, mute, jam tenang, dan status verifikasi kontak.
3. **Batching:** delivery `Batching` diberi `scheduled_for = now()+15m`. Jika delivery baru untuk user dan kanal yang sama datang sebelum jadwal, keduanya digabung menjadi satu pesan ringkasan ("3 perubahan di WO 01, WO 03").
4. **Jam tenang** (default 21:00–07:00 WIB): email/WA ditunda ke `quiet_end`, kecuali `help.requested`. In-app tetap real-time.
5. **Retry:** gagal → coba lagi 1 menit, 5 menit, 30 menit (3×). Jika WA tetap gagal → kirim fallback via email (jika email tidak dimatikan) dan tandai `failed`. Error 4xx permanen (nomor tidak valid, template ditolak) tidak di-retry.
6. **Idempotensi:** kunci `(notification_id, channel)` unik, sehingga satu notifikasi tidak terkirim dua kali.
7. **Tautan:** `https://rein.remula.co.id/w/{short_code}` (short code 5–6 karakter base32 untuk WO; `/p/{code}` untuk project). Hanya bisa dibuka dari jaringan kantor/VPN. Isi pesan dibatasi ringkasan; detail sensitif tidak dikirim.

### 6.3 Template pesan
Variabel `{{…}}` di-escape. WA memakai template resmi dengan kategori **Utility**, sedangkan email memakai HTML ringan + plain text.

**WA `rein_wo_assigned`** (frame `D/12a`, `M/12`):
```text
WO baru untuk Anda
*{{wo_label}} — {{wo_title}}*
Project: {{project_name}}
RPO: {{rpo}}
Jenis: {{wo_type}}{{#urgent}} · *URGENT*{{/urgent}}
Deadline: {{deadline_long}}
Dari: {{actor_name}}
[Tombol URL] Buka WO → {{short_url}}
```
**WA `rein_help_requested`:**
```text
*Butuh bantuan* di {{wo_label}}
{{wo_title}}
Dari: {{requester_name}}
"{{excerpt_140}}"
Project: {{project_name}}
[Tombol URL] Balas di REIN → {{short_url}}
```
**WA `rein_deadline_h1`:** `Pengingat deadline besok · *{{wo_label}} — {{wo_title}}* · Progres terakhir: {{progress}}% · {{status_label}} · Deadline: {{deadline_long}}` + tombol "Isi logbook".
**WA `rein_overdue`**, **`rein_member_added`**, **`rein_help_resolved`**, **`rein_daily_digest`**: pola sama (baris 1 = jenis kejadian, baris tebal = objek, maksimal 1.024 karakter).
**WA `rein_otp`** (kategori Authentication): `Kode verifikasi REIN Anda: {{code}}. Berlaku 5 menit. Jangan berikan kode ini kepada siapa pun.`

**Email `wo.assigned`** (frame `D/12b`):
- Subjek: `[REIN] {{wo_label}} — {{wo_title}}{{#urgent}} · Urgent{{/urgent}} · deadline {{deadline_short}}`
- Isi: kalimat pembuka (aktor + aksi), judul, badge Urgent, tabel (Project, No RPO, Klien, Jenis, Deadline, Lampiran), cuplikan detail ≤ 300 karakter, tombol "Buka WO di REIN", catatan "hanya dapat dibuka dari jaringan kantor atau VPN", footer "Atur notifikasi · Mute project ini".
- From: `REIN <notifikasi@remula.co.id>`. Header `List-Unsubscribe: <https://rein.remula.co.id/pengaturan/notifikasi>`. Ukuran HTML ≤ 30 KB, logo inline (CID/SVG), tanpa gambar eksternal.

### 6.4 Preferensi & anti-spam (frame `D/08b`, `M/08b`)
- Per event per kanal (email/WA). In-app selalu aktif. Event 🔒 tidak bisa dimatikan.
- Toggle global: Gabungkan notifikasi (default on), Jam tenang (default on, 21:00–07:00), Ringkasan harian (default on).
- Mute project: semua kanal kecuali in-app & `help.requested` dibisukan untuk project itu.
- Batas keras per user: maksimal 20 WA/hari. Kelebihannya digabung ke ringkasan berikutnya dan dicatat `skipped` dengan alasan `rate_cap`.

---

## 7. Spesifikasi unggah & lampiran

| Aspek | Spesifikasi |
|---|---|
| Tipe diizinkan | Gambar: jpg, jpeg, png, webp, heic/heif (dikonversi di klien ke JPEG/WebP). Dokumen: pdf, dwg, dxf, step/stp, xlsx, xls, docx, doc, csv, txt, zip. Validasi magic bytes di server, bukan hanya ekstensi |
| Ukuran maks | **50 MB per file** (dicek sebelum kompresi dan saat unggah); 10 file per entri logbook / form WO. Dicek di klien sebelum upload dan di server |
| Kompresi gambar (klien) | Resize sisi terpanjang ≤ 1920 px, WebP q=0.75 (fallback JPEG q=0.78 jika WebP tidak didukung), strip EXIF **kecuali** orientasi diterapkan dulu. Target ≤ 400 KB. Dijalankan di Web Worker (`OffscreenCanvas`, fallback `<canvas>`). Gambar ≤ 300 KB dan ≤ 1920 px tidak diproses ulang |
| Avatar / logo | Dipotong persegi 256×256 WebP. Banner 1600×400 WebP |
| Turunan | Foto: klien membuat `display` (≤ 1920 px) **dan** `thumb` (320 px WebP, ≤ 30 KB) lalu mengunggah keduanya, sehingga server tidak perlu memproses ulang. Fallback: worker `sharp` membuat thumb jika klien tidak mengirimnya |
| Unggah | Multipart ke `/api/attachments`; server **stream** langsung ke GCS (tanpa simpan di disk lokal), sambil cek magic bytes, ukuran, dan menghitung SHA-256. Unggah **resumable** [P1] untuk file > 8 MB |
| Penyimpanan | **Google Cloud Storage**: bucket privat `rein-attachments` (region `asia-southeast2` Jakarta, *uniform bucket-level access*, *public access prevention* aktif). Key objek: `{owner_type}/{yyyy}/{mm}/{uuid}/{original|display|thumb}`. Kode memakai abstraksi `StorageDriver` (`GcsDriver` default, `LocalDriver` untuk dev/test) |
| Akses | `GET /files/{id}/{variant}` → server cek izin project → balas **redirect 302 ke V4 Signed URL** GCS (berlaku 24 jam). Waktu tanda tangan dibulatkan ke awal hari, sehingga URL yang sama dipakai ulang sepanjang hari dan **cache browser tetap bekerja**. File tidak pernah publik |
| Foto profil, logo, banner | Disimpan di bucket yang sama: avatar 256×256 WebP (`owner_type = user`), logo klien 256×256, banner 1600×400. Dikompres di klien. Foto lama dihapus saat diganti. Tanpa foto → tampil inisial |
| Kredensial GCS | Service account khusus `rein-storage@…` dengan role **Storage Object Admin hanya pada bucket REIN** (bukan level project). Key JSON di secret Docker / env, tidak di-commit |
| Deduplikasi | SHA-256 sama di owner yang sama → pakai ulang objek; tampilkan "File yang sama sudah ada" |
| Penghapusan | Soft delete di database; objek GCS dihapus oleh job harian setelah 30 hari. GCS *soft delete policy* 7 hari sebagai pengaman tambahan |
| Biaya & kuota | Lifecycle rule: objek > 180 hari dipindah ke kelas **Nearline** (lebih murah, jarang dibuka). Dashboard Admin menampilkan total pemakaian storage [P1] |
| Antivirus | [USULAN] ClamAV opsional (butuh ±1 GB RAM, jadi default **off** sesuai batas RAM) |
| Offline | Lampiran yang dibuat saat offline disimpan sebagai Blob di IndexedDB (maks 200 MB total) dan diunggah saat online (§9.2) |

---

## 8. Spesifikasi view

Komponen Figma: `View Switcher`, `Filter Chip`, `Table Header`, `WO Row`, `Project Row`, `Kanban Card`, `Project Card`, `Progress`.

### 8.1 Table
- Daftar project (`D/03a`, `M/03a`): kolom Logo+Nama+Klien, RPO, Kategori aktif (ikon status project + kategori yang punya WO belum selesai, atau alasan Ditunda), Progres, Tim (avatar stack maks 3 + "+n"), Timeline, Jumlah urgent. Grup default per status. Baris 44 px (desktop) / item 2 baris (mobile).
- Worklist (`D/05a`, `M/05`): kolom WO, Judul (+ flag Butuh bantuan), Jenis, PIC, Deadline (merah jika terlambat), Progres. Grup default per status. Baris 40 px.
- Paginasi: keyset (cursor) 50 baris. Infinite scroll memakai IntersectionObserver. Virtualisasi jika > 200 baris dimuat.
- Keyboard: `↑↓` pindah baris, `Enter` buka, `X` pilih [P1], `S` ubah status [P1].

### 8.2 Kanban
- Daftar project: kolom = status project (Berjalan, Ditunda, Selesai). Worklist: kolom = 6 status WO (Dibatalkan disembunyikan default); opsi **swimlane per kategori** [P1].
- Drag & drop mengubah status sesuai izin (kartu project ke Selesai tetap melewati cek FR-024). Jika transisi tidak sah, kartu kembali ke posisinya + toast alasan. Alternatif aksesibel: menu kartu "Pindah ke…".
- Mobile: kolom 300 px, scroll horizontal dengan snap per kolom + pager dots (`M/03b`).
- Kolom memuat 30 kartu pertama + "Muat lagi".

### 8.3 Timeline
- Bar = `planned_start → deadline` (WO) atau `start_date → end_date` (project). Isi bar = progres (overlay 22% opacity aksen). Garis "hari ini" merah. Skala Minggu/Bulan.
- Bar WO terlambat diberi outline merah. WO Selesai abu-abu.
- [P1] Drag ujung bar mengubah tanggal (izin `wo.edit.any`/`project.edit`) dengan konfirmasi.
- Render SVG ringan (tanpa library gantt). Maksimal 300 bar per render.

### 8.4 S-Curve (rencana vs aktual)
Frame: `D/03d` (portofolio), `D/05d` (project), `M/03d`.

**Definisi untuk satu project P, pada tanggal t:**
1. **Himpunan WO:** semua WO P yang tidak dihapus dan tidak `canceled`.
2. **Bobot:** jika WO punya `weight` eksplisit, pakai itu. Sisa `100 − Σ eksplisit` dibagi rata ke WO tanpa bobot. Jika Σ eksplisit > 100 atau semua kosong, normalisasi: `w_i = weight_i / Σ weight` (semua kosong → `1/N`). Hasil: Σ w_i = 1.
3. **Rencana:** `Plan(t) = Σ w_i · clamp((t − s_i) / max(1, d_i − s_i), 0, 1)` dengan `s_i = planned_start`, `d_i = deadline` (hari kalender, inklusif).
4. **Aktual:** `Actual(t) = Σ w_i · p_i(t)`. `p_i(t)` = nilai `progress_events.progress` terakhir dengan `recorded_at ≤ t` (0 jika belum ada; 1 jika status done).
5. **Deviasi** = `Actual − Plan` (poin persen). **SPI** = `Actual / Plan` (tampil "—" jika Plan = 0).
6. **Prediksi selesai:** regresi linier `Actual` 14 hari terakhir. Jika kemiringan ≤ 0 → "Tidak dapat diprediksi".
7. **Progres project** (yang tampil di semua daftar) = `Actual(today)` dibulatkan ke integer. Contoh data Figma: Σ(bobot × progres) = 21,5% → tampil 22%.

**Progres per kategori** (strip di header `D/05a`, `M/05`): rumus yang sama dengan Actual, tetapi himpunan WO dibatasi ke satu kategori dan bobot dinormalisasi di dalam kategori itu. Chip menampilkan `selesai/total WO` + progres.

**Portofolio** (daftar project): `Plan_port(t) = rata-rata Plan_P(t)` dan `Actual_port(t) = rata-rata Actual_P(t)` untuk project aktif yang lolos filter (bobot project sama; lihat Asumsi A-05).

**Implementasi:**
- Endpoint `/api/scurve?project=…&from=…&to=…&interval=day|week` mengembalikan deret titik (maksimal 120 titik), dihitung di SQL (generate_series + lateral join) dan di-cache 5 menit (invalidate saat ada `progress_events` baru).
- Grafik digambar dengan SVG polyline manual (garis putus-putus = rencana abu-abu, garis solid = aktual biru, garis vertikal merah = hari ini).
- Tabel bobot di samping (`D/05d`): WO, Bobot, Progres, Kontribusi, Total.

### 8.5 Filter, grup & view tersimpan
- Konfigurasi view disimpan sebagai JSON:
  ```json
  {"type":"table","filters":{"type":["GD"],"assignee":["me"],"urgent":true,"status":["in_progress"],"deadline":"next7"},"groupBy":"status","sort":"deadline","collapsed":["done"]}
  ```
- Filter disinkronkan ke query string agar bisa dibagikan. Disimpan ke `saved_views` dengan debounce 1 detik.

---

## 9. Requirement non-fungsional

### 9.1 Performance budget (diukur di CI dengan Lighthouse CI + bundle analyzer)
| ID | Metrik | Target |
|---|---|---|
| NFR-001 | JS awal (route Beranda), gzip | ≤ 100 KB (batas keras 130 KB) |
| NFR-002 | CSS awal, gzip | ≤ 20 KB |
| NFR-003 | TTI di Lighthouse mobile (Slow 4G, CPU 4×) | ≤ 3,5 s (kunjungan pertama); ≤ 1,5 s (kunjungan ulang dengan SW) |
| NFR-004 | LCP Slow 4G | ≤ 2,5 s |
| NFR-005 | Respons API p95 (server, 200 user) | Daftar ≤ 300 ms; mutasi ≤ 400 ms; S-Curve ≤ 600 ms |
| NFR-006 | Payload JSON per halaman daftar (50 item) | ≤ 50 KB sebelum gzip |
| NFR-007 | Thumbnail di daftar | ≤ 30 KB, `loading="lazy"`, `decoding="async"`, dimensi eksplisit (CLS ≤ 0,05) |
| NFR-008 | Font | Inter variable subset Latin, `woff2` ≤ 60 KB, self-hosted, `font-display: swap` |

**Aturan implementasi:**
- Tidak memakai UI kit berat (MUI/Ant), library chart, atau moment.js.
- Code splitting per route. Timeline & S-Curve di-lazy-load.
- Skeleton loading muncul dalam ≤ 100 ms (`D/11c`, `M/11c`).
- HTTP compression `br`/`gzip`.
- `ETag` untuk GET daftar.

### 9.2 PWA & low-bandwidth / offline (frame `D/11e`, `M/11d`)
- Manifest (nama "REIN", ikon 192/512, `display: standalone`, `theme_color` aksen).
- Service worker:
  - precache app shell.
  - `stale-while-revalidate` untuk GET API yang aman (Beranda, Tugas saya, detail WO yang pernah dibuka; maksimal 50 WO terakhir).
  - `cache-first` untuk `/files/*/thumb`.
- **Outbox offline** (IndexedDB) untuk: entri logbook (+ lampiran), perubahan status/progres WO. Setiap item punya `client_uuid` untuk idempotensi.
- Sinkronisasi: Background Sync jika didukung, selain itu saat `online`/`visibilitychange`.
- Konflik: server menang. Jika WO berubah sejak dibuka (`updated_at` berbeda) dan item outbox mengubah status, server tetap menerima entri logbook. Perubahan status ditolak dengan label "Konflik — tinjau" di UI.
- Banner offline + jumlah antrean. Toast "Koneksi lambat" jika `navigator.connection.effectiveType ∈ {slow-2g, 2g}` atau RTT > 1.500 ms. Dalam mode itu, gambar yang dimuat hanya thumbnail (ketuk untuk versi penuh).
- Halaman error (`D/11d`): timeout 15 detik → "Coba lagi" + "Buka versi tersimpan" (data cache, mode baca).

### 9.3 Keamanan
- OWASP ASVS L2 sebagai acuan.
- Semua query memakai parameter (ORM).
- Otorisasi berbasis kebijakan terpusat (`can(user, permission, resource)`) dengan unit test untuk setiap baris matriks §2.4.
- Rich text disimpan sebagai AST JSON terbatas (paragraph, bold, italic, list, link, mention) dan dirender tanpa `innerHTML` mentah.
- Secret dari env/Docker secrets. Tidak ada secret di repo.
- Dependensi dipindai (npm audit / osv-scanner) di CI.
- Server hanya terikat ke jaringan internal. Koneksi keluar hanya ke Google API (OAuth, Gmail API, GCS) dan WhatsApp (via OpenWA).

### 9.4 Audit log
- Dicatat: auth events (§5), create/update/delete project/WO/anggota/status project/role/izin/jenis WO/pengguna, unduh lampiran kategori BAST/kontrak, dan perubahan preferensi notifikasi.
- Retensi 2 tahun. Append-only (role DB aplikasi tanpa izin `UPDATE/DELETE` pada `audit_logs`).

### 9.5 Backup & pemulihan
- RPO (Recovery Point Objective) ≤ 24 jam; RTO (Recovery Time Objective) ≤ 4 jam.
- Detail di §11.4.

### 9.6 Aksesibilitas
- WCAG 2.2 AA:
  - kontras teks ≥ 4.5:1 (token `text/tertiary` hanya untuk teks sekunder ≥ 12 px dan non-esensial),
  - fokus terlihat (`focus/ring` 3 px),
  - target sentuh ≥ 44×44 px di mobile,
  - semua aksi drag punya alternatif menu,
  - ikon status selalu disertai label/`aria-label`,
  - `prefers-reduced-motion` dihormati,
  - navigasi penuh dengan keyboard.

### 9.7 Kapasitas
- Target 200 user terdaftar, 60 aktif bersamaan, 10 request/detik puncak.
- Asumsi volume/tahun: 150 project, 6.000 WO, 60.000 entri logbook, 80.000 lampiran (±60 GB setelah kompresi).
- Uji beban (k6) wajib lulus NFR-005 dengan data sintetis 3× volume tahunan.

### 9.8 Kompatibilitas
- Chrome/Edge 2 versi terakhir, Safari iOS 16+, Chrome Android 10+.
- Lebar layar 360–1920 px. Breakpoint: < 768 (mobile layout), 768–1199 (sidebar collapsible), ≥ 1200 (desktop).

### 9.9 Tema
- Light & dark dari token Figma (collection `Color`, mode `Light`/`Dark`). Implementasi berupa CSS custom properties dengan nama sama: `var(--color-bg-app)`, dst.
- **Warna kategori** (§4.2) adalah satu-satunya pengecualian dari aturan "warna minim". Pemakaiannya dibatasi pada: titik 8 px di tag Jenis, garis kiri 3 px di kartu Kanban, bar Timeline, dan bar kategori di header project. Warna kategori tidak dipakai untuk teks, tombol, atau background besar. Merah tetap khusus Urgent/terlambat/Butuh bantuan, dan hijau tetap khusus Selesai.
- Default mengikuti sistem. Toggle tema ada di command palette [P1].

---

## 10. Rekomendasi arsitektur & stack

### 10.1 Batasan
Satu server on-prem, RAM terbatas dan dipakai bersama aplikasi lain. Jumlah service/container harus minimal. Tim kecil, dan kode dibangun oleh coding agent.

### 10.2 Rekomendasi: **monolit TypeScript + PostgreSQL** (2 container)

| Lapisan | Pilihan | Alasan | Trade-off |
|---|---|---|---|
| Frontend | **Svelte 5 + SvelteKit (mode SPA, `adapter-static`)**, CSS murni dari token | Bundle sangat kecil (runtime kompilasi), cocok untuk NFR-001; tanpa UI kit berat | Ekosistem lebih kecil dari React, tapi kebutuhan UI REIN sederhana |
| Backend | **Node.js 22 LTS + Hono** (REST JSON + SSE) | Ringan (≈60–120 MB RSS), TypeScript end-to-end, satu proses melayani API + file statis SPA | Single-threaded; cukup untuk 10 rps |
| ORM/migrasi | **Drizzle ORM** + drizzle-kit | Tipe kuat, SQL dekat ke permukaan (perlu untuk S-Curve), tanpa engine biner tambahan | Migrasi ditulis lebih manual dibanding Prisma |
| Database | **PostgreSQL 16** | Relasional, trigram search, `generate_series` untuk S-Curve, satu-satunya state | Butuh tuning RAM (shared_buffers 128–256 MB) |
| Antrean job | **pg-boss** (queue di Postgres) | Tanpa Redis/RabbitMQ; retry, schedule, cron (07:00) | Throughput terbatas, tapi lebih dari cukup |
| Realtime | **SSE** (Server-Sent Events) | Lebih sederhana dari WebSocket, lewat proxy apa pun | Satu arah (cukup untuk notifikasi) |
| Gambar | **sharp** (libvips) di worker dalam proses yang sama | Cepat & hemat memori untuk thumbnail | Dependensi native, tapi tersedia untuk image Alpine/Debian |
| Validasi | **Zod**, skema dibagi frontend–backend | Satu sumber kebenaran | — |
| Email | **Gmail API** (`users.messages.send`, scope `gmail.send`) dari akun pengirim khusus, adapter `MailProvider` (`GmailApiProvider` default, `SmtpProvider` cadangan, `NullProvider` dev) | User sudah punya project Google Cloud; tanpa server SMTP | Kuota harian akun Gmail/Workspace; refresh token harus dari OAuth app berstatus *In production* (status *Testing* membuat token kedaluwarsa 7 hari) |
| Storage | **Google Cloud Storage** (`@google-cloud/storage`), bucket privat Jakarta | Tidak memakan disk server; tahan lama; mudah di-backup | Butuh internet keluar; ada biaya per GB (kecil untuk ±60 GB/tahun) |
| Login | **Google OIDC** (tanpa library berat; `oslo`/`arctic` atau verifikasi JWT manual dengan JWKS) | Karyawan sudah punya akun Google | Consent screen harus di-publish |
| WA | Adapter `WhatsAppProvider` → **OpenWA** (self-host, engine `baileys`) — keputusan user, revisi 1.3 | Gratis, tanpa verifikasi Meta, ±30–80 MB/sesi | Tidak resmi: risiko blokir nomor (lihat §10.4); tanpa tombol, tautan ditulis di teks |
| Test | Vitest (unit), Playwright (E2E 6 alur Figma), k6 (beban) | — | — |

**Struktur repo (monorepo pnpm):**
```text
apps/web        SvelteKit SPA (routes, components dari Figma: Button, Input, StatusBadge, WORow, KanbanCard, ...)
apps/server     Hono API, auth, policy, jobs (pg-boss), notification adapters, file storage
packages/shared Zod schemas, permission keys, enums, formatters (tanggal WIB, label status)
packages/ui-tokens  CSS variables hasil ekspor variabel Figma (light/dark)
infra/          docker-compose.yml, Dockerfile, backup scripts, Caddy/Traefik labels
```

**Estimasi RAM:** app 150–250 MB + Postgres 300–500 MB ≈ **< 800 MB** total.

**Opsi lebih ringan [catatan]:** PocketBase (Go + SQLite, 1 binary). Paling hemat (< 100 MB), tetapi permission berbasis scope, S-Curve SQL, dan job terjadwal jadi lebih rumit. Opsi ini tidak dipilih.

### 10.3 Perbandingan dengan Plane sebagai base
| Aspek | Plane (self-host) | Build custom (rekomendasi) |
|---|---|---|
| Service | ±10+ container (web, space, admin, live, api, worker, beat, postgres, redis/valkey, rabbitmq, minio, proxy) | 2 container (app + postgres) |
| RAM | Rekomendasi resmi beberapa GB (≥ 4 GB) | < 1 GB |
| Kecocokan domain | Issue/cycle/module generik. Perlu kustomisasi untuk: hierarki Project→WO→Logbook, jenis WO, RPO, logo/banner klien, syarat BAST & punch list, S-Curve berbobot, verifikasi WA + PIN per perangkat, notifikasi WA | Dibangun persis sesuai brief |
| Notifikasi WA & PIN | Tidak ada; perlu fork | Native |
| Bahasa UI Indonesia | Perlu terjemahan & menjaga patch saat upgrade | Native |
| Upgrade | Fork Django + Next.js harus di-rebase terus | Sepenuhnya milik Remula |
| Lisensi | AGPL-3.0 (kewajiban membuka kode modifikasi jika didistribusikan/diakses jaringan) | Proprietary internal |
| Kecepatan awal | Cepat untuk demo | MVP ±8–10 minggu (§12) |

**Keputusan:** build custom. Plane terlalu berat untuk server bersama, dan sebagian besar nilai REIN (WA, PIN, logbook, S-Curve berbobot, gate BAST) justru harus ditambahkan sendiri ke Plane. Hasilnya beban fork permanen tanpa penghematan nyata.

### 10.4 Penyedia WhatsApp: resmi vs gateway tidak resmi
| | **WhatsApp Business Cloud API (resmi, Meta)** — langsung atau via BSP (mis. Twilio, Qontak, Wati) | **Gateway tidak resmi** (mis. layanan berbasis WhatsApp Web seperti Fonnte/Wablas, atau self-host Baileys/whatsapp-web.js) |
|---|---|---|
| Kepatuhan ToS | Patuh | **Melanggar** ketentuan WhatsApp |
| Risiko blokir nomor | Rendah (bergantung kualitas/rating) | **Tinggi**. Nomor bisa diblokir kapan saja, notifikasi berhenti total |
| Template | Wajib template yang disetujui Meta untuk pesan yang dimulai bisnis (Utility/Authentication) | Bebas teks |
| Biaya | Berbayar per percakapan/pesan sesuai tarif Meta (cek tarif kategori Utility & Authentication untuk Indonesia saat implementasi); BSP menambah biaya platform | Murah/flat |
| Keandalan | SLA, webhook status (sent/delivered/read/failed) | Sesi WA Web putus, perlu scan ulang QR; tanpa SLA |
| Keamanan | Token API | Kredensial sesi WA tersimpan di pihak ketiga / server sendiri |
| Setup | Verifikasi Meta Business, nomor khusus (bukan nomor WA personal aktif), display name "REIN · Remula" | Cepat (menit) |

**Keputusan (revisi 1.3):** user memilih **OpenWA** (https://github.com/rmyndharis/OpenWA, lisensi MIT, NestJS) dengan **nomor baru khusus REIN**. Engine `baileys` dipilih karena jauh lebih ringan daripada `whatsapp-web.js` (yang butuh Chromium). Mitigasi wajib:
- nomor khusus yang "dipanaskan" 1–2 minggu; OTP dikirim hanya atas permintaan pengguna (FR-003 AC2 revisi 1.5);
- `SEND_PACING_ENABLED=true`, batas 20 WA/user/hari, batching 15 menit, jam tenang;
- email selalu sebagai fallback; webhook `session.status` terputus → alert ke Admin dan semua WA dialihkan ke email;
- OpenWA hanya di jaringan Docker internal (`http://openwa:2785`, header `X-API-Key`), webhook diverifikasi HMAC;
- kirim teks via `POST /api/sessions/{sessionId}/messages/send-text`; tanpa tombol, tautan ditulis di teks.

Jika nomor diblokir atau volume naik, pindah ke Cloud API resmi cukup dengan mengganti adapter (`MetaCloudProvider`), tanpa mengubah logika notifikasi.

**Rekomendasi awal (sebelum revisi 1.3), tetap berlaku sebagai jalur migrasi:**
- Pakai **Cloud API resmi** dengan nomor khusus perusahaan. Kategori template: OTP (Authentication) dan semua notifikasi (Utility).
- Kode memakai interface `WhatsAppProvider { sendTemplate(to, template, vars, buttons) ; parseWebhook(req) }` dengan implementasi `MetaCloudProvider` (default) dan `NullProvider` (dev/test, menulis ke log).
- Jika perusahaan memutuskan memakai gateway tidak resmi untuk sementara, implementasinya dibuat sebagai adapter terpisah, **dengan persetujuan tertulis atas risikonya**, nomor terpisah dari nomor operasional, dan fallback email tetap aktif.
- Webhook status masuk lewat endpoint publik: lihat Asumsi A-10 (perlu reverse proxy terbatas atau polling).

---

## 11. Rencana deployment

### 11.1 Topologi
```text
[VPN WireGuard / LAN kantor] → rein.remula.co.id (DNS internal → IP privat server)
        → Coolify (Traefik) :443  →  rein-app (Node, :3000)  →  postgres (:5432; db rein + openwa)
                                         ├─ Google Cloud Storage (lampiran, foto, backup)
                                         ├─ Gmail API (email) · Google OAuth (login)
                                         └─ openwa (:2785, internal saja, ENGINE_TYPE=baileys) ⇄ WhatsApp
Keluar (egress saja): *.googleapis.com :443, accounts.google.com :443, server WhatsApp (via OpenWA)
Browser karyawan juga butuh akses ke storage.googleapis.com untuk membuka lampiran (Signed URL).
```

### 11.2 Langkah
1. Server Linux (Ubuntu 24.04 LTS) dengan Docker + **Coolify**.
2. Coolify memakai Docker Compose (`infra/docker-compose.yml`) dengan 2 service: `app` (image multi-stage, non-root, `NODE_ENV=production`) dan `postgres:16-alpine`. Batas memori Compose: app `mem_limit: 384m`, postgres `mem_limit: 768m`.
3. **HTTPS internal:**
   - Opsi A (disarankan): sertifikat Let's Encrypt via **DNS-01 challenge** pada domain `remula.co.id` (tanpa membuka port publik).
   - Opsi B: CA internal + distribusi root CA ke perangkat (lebih repot di HP).
   - PWA & service worker **wajib HTTPS**.
4. Akses hanya dari subnet LAN/VPN: firewall host (ufw) + Traefik middleware `ipAllowList` untuk subnet LAN & VPN.
5. **VPN:** WireGuard (atau yang sudah dipakai kantor). Profil WireGuard di HP lapangan dengan *on-demand* untuk domain `rein.remula.co.id`.
6. Variabel lingkungan: `DATABASE_URL`, `AUTH_PEPPER`, `APP_URL`, `TZ=Asia/Jakarta`,
   `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`,
   `GMAIL_SENDER`, `GMAIL_REFRESH_TOKEN` (refresh token akun pengirim, scope `gmail.send`),
   `GCS_BUCKET`, `GCS_BACKUP_BUCKET`, `GOOGLE_APPLICATION_CREDENTIALS` (path key service account),
   `OPENWA_URL`, `OPENWA_API_KEY`, `OPENWA_SESSION_ID`, `OPENWA_WEBHOOK_SECRET`, `REIN_WA_NUMBER`.
7. Migrasi DB dijalankan otomatis saat start (`drizzle-kit migrate`). Health check `/healthz` (DB ping) dan `/readyz`.
8. **CI/CD:** Git push → build image di CI → push ke registry → Coolify redeploy (atau Coolify build dari repo).

### 11.3 Observability
- Log JSON ke stdout (pino) → Coolify log. Simpan 14 hari.
- Metrik dasar: endpoint `/metrics` (Prometheus format) [USULAN].
- Uptime check internal tiap 1 menit dengan alert email ke admin.

### 11.4 Backup
| Data | Metode | Jadwal | Retensi |
|---|---|---|---|
| PostgreSQL | `pg_dump -Fc` terkompresi → upload ke bucket **`rein-backup`** (GCS, terpisah dari bucket lampiran) | Harian 01:00 + sebelum setiap deploy | 7 harian, 4 mingguan, 6 bulanan (lifecycle rule GCS) |
| Lampiran | Sudah di GCS (durabilitas tinggi). Ditambah **Object Versioning** + soft delete 7 hari pada `rein-attachments`. Salinan tambahan ke NAS kantor bersifat opsional | Kontinu | Versi lama dihapus otomatis setelah 30 hari |
| Konfigurasi | Repo infra (tanpa secret) + ekspor secret terenkripsi | Setiap perubahan | — |

Uji restore ke server staging **sebulan sekali** (checklist tercatat). Alert jika backup gagal.

---

## 12. Milestone

Estimasi untuk 1–2 engineer + coding agent.

| Milestone | Isi | Definition of Done |
|---|---|---|
| **M0 Fondasi** (minggu 1–2) | Monorepo, CI, Docker/Coolify staging, token CSS dari Figma, komponen dasar (Button, Input, Status Badge, Flag Badge, Tag, Avatar, Kbd, Checkbox, Toggle, Progress, Sidebar, Bottom Nav, Mobile App Bar), auth password + undangan + verifikasi email, model role & permission + policy test | Login→Beranda kosong berjalan di staging HTTPS internal; 100% baris matriks §2.4 punya unit test; Lighthouse CI aktif |
| **M1 MVP inti** (minggu 3–8) | Project CRUD + anggota + status + progres per kategori + syarat Selesai; WO CRUD + status machine; logbook + progres + lampiran (kompresi klien, thumbnail); Butuh bantuan; Beranda; Table & Kanban (project & worklist); notifikasi in-app (SSE) + email + **WA resmi** untuk `wo.assigned`, `help.*`, `wo.deadline_h1`, `wo.overdue`, `project.member_added`; verifikasi WA OTP; PIN + fast login; PWA app shell; Admin pengguna/role/jenis WO; audit log (tulis) | Alur Prototype `P1`–`P5` lulus E2E Playwright di desktop & mobile viewport; NFR-001–007 lulus; uji beban NFR-005 lulus; backup & restore teruji; UAT dengan 10 user pilot (2 project nyata) |
| **M2 Pemantauan** (minggu 9–12) | Timeline, S-Curve (project & portofolio), view tersimpan, preferensi notifikasi + batching + jam tenang + ringkasan harian + mute, command palette, shortcut, outbox offline, Tugas saya penuh, dark mode toggle | Alur `P6` lulus; perhitungan S-Curve cocok dengan fixture spreadsheet (selisih ≤ 0,1 poin); offline: entri logbook dibuat saat mode pesawat lalu tersinkron tanpa duplikat |
| **M3 Penyempurnaan** | Audit log viewer, impor CSV pengguna, drag tanggal di Timeline, `@mention`, resumable upload, metrik Prometheus [USULAN], push notification PWA [USULAN] | Sesuai AC per FR; tidak ada bug P1 terbuka |

**Urutan prioritas jika waktu terbatas:** auth+verifikasi → project/WO/logbook → notifikasi WA/email → Beranda → Kanban → PIN → offline → S-Curve/Timeline.

**Definition of Done umum (setiap fitur):**
- AC terpenuhi dan ada test.
- Tampilan cocok dengan frame Figma terkait di 390 px & 1440 px.
- Teks UI dalam Bahasa Indonesia.
- Izin dicek di server.
- Event audit tercatat.
- Tidak menambah JS awal > 5 KB tanpa justifikasi.
- Dokumentasi API (OpenAPI dihasilkan dari Zod) diperbarui.

---

## 13. Pemetaan layar Figma → fitur/komponen

File: https://www.figma.com/design/m6TD7AHjnmgljGiPNT00f7

| Frame (Desktop / Mobile) | Fitur / FR | Komponen utama |
|---|---|---|
| `D/01a Login` / `M/01a Login` | FR-001, FR-006 | Input, Button, Checkbox. Tombol "Masuk dengan Google" belum ada di frame: tambahkan di bawah tombol Masuk, dipisah garis "atau" |
| `D/01b Verifikasi Kontak` / `M/01b` | FR-003 | Onboarding: nomor WA → OTP dari bot → input kode. Email di Profil setelah masuk (revisi 1.5). |
| `D/01c Buat PIN` / `M/01c Buat PIN` (keypad) | FR-004 | Digit / PIN Dots, Keypad |
| `D/01d Fast Login PIN` / `M/01d` | FR-004 AC3–4 | Avatar 64, PIN Dots, pesan error |
| `D/02 Beranda` / `M/02 Beranda` | FR-010 | Stat Card, Callout Butuh bantuan, WO Row / WO List Item, Sidebar / Bottom Nav |
| `D/03a Project — Table` / `M/03a Project — List` | FR-025, §8.1 | View Switcher, Filter Chip, Project Row / Project List Item |
| `D/03b Project — Kanban` / `M/03b` | §8.2 | Project Card |
| `D/03c Project — Timeline` / `M/03c` | §8.3 | Bar timeline, garis hari ini |
| `D/03d Project — S-Curve` / `M/03d` | §8.4 portofolio | Chart SVG, KPI, Deviasi per project |
| `D/04a Buat Project — Info`, `D/04b … — Anggota` / `M/04 Buat Project` | FR-020 | Modal, Input, Dropzone, daftar anggota + peran |
| `D/05a Detail Project — Worklist Table` / `M/05 Detail Project` | FR-021–024, §8.1 | Banner, Logo Klien, Kategori Bar (bar + legenda berwarna, komponen `Category Dot`), Tabs, WO Row, Panel Detail (Anggota, Lampiran; tanpa Syarat Selesai pada revisi 1.6) |
| `D/05b … Kanban`, `D/05c … Timeline`, `D/05d … S-Curve` | §8.2–8.4 | Kanban Card, bar WO, tabel bobot |
| `D/06 Buat WO` / `M/06 Buat WO` | FR-030 | Modal, Input, Select, Toggle Urgent, Editor, Referensi, Attachment Thumb |
| `D/07a Detail WO + Logbook` / `M/07 Detail WO + Logbook` | FR-033, FR-040–042, FR-061 | Logbook Entry, Composer (unggah + kompresi), Properti, Status Badge |
| `D/07b WO — Minta Bantuan` / `M/07b Minta Bantuan (sheet)` | FR-050 | Modal / Bottom Sheet |
| `D/08a Notifikasi` / `M/08a Notifikasi` | FR-080, FR-051 | Notification Item, panel pratinjau + balas |
| `D/08b Pengaturan Notifikasi` / `M/08b` | FR-082, §6.4 | Matriks Checkbox / chip kanal, Toggle |
| `D/09 Profil & Keamanan` / `M/09` | FR-005 | Avatar, badge Terverifikasi, daftar perangkat |
| `D/10a Admin — Pengguna` / `M/10 Admin — Pengguna` | FR-090–091 | Tabel pengguna, status dot |
| `D/10b Admin — Role & Izin` | FR-092, §2 | Daftar role, Toggle per permission |
| `D/10c Admin — Jenis WO` | FR-093 | Tabel urut (drag handle), Toggle |
| `D/11a Command Palette` / `M/11a Cari & Perintah` | FR-073 | Command Palette, Kbd |
| `D/11b Empty State` / `M/11b Empty — Tugas saya` | Empty state umum | Pesan + CTA |
| `D/11c Loading Skeleton` / `M/11c` | NFR skeleton | Skeleton Row |
| `D/11d Error — Gagal Memuat` | §9.2 | Pesan error + kode |
| `D/11e Offline & Koneksi Lambat` / `M/11d Offline` | §9.2 | Banner Offline, Antrian, Toast |
| `D/12a Pratinjau WhatsApp`, `D/12b Pratinjau Email` / `M/12 Notifikasi WhatsApp & Email di HP` | §6.3 | Template pesan |
| Prototype `P1-*`, `P2-*` | Alur 1–2 (Manager: project → anggota → WO) | — |
| Prototype `P3-*`, `P4-*`, `P5-*` | Alur 3–5 (Engineer: WA → PIN → WO → logbook/status → bantuan) | — |
| Prototype `P6-*` | Alur 6 (Manager memantau) | — |

**Token:** halaman *Tokens & Components* → collection `Color` (mode Light/Dark), `Spacing` (`space/2…48`), `Radius` (`sm 4, md 6, lg 8, xl 12, full`), `Typography` (font-size), text style `Display/24 … Micro/11`, dan ikon `icon/*`, `status/*`, `priority/*`, `flag/help`. Setiap variabel punya code syntax WEB (`var(--color-bg-app)`, dst.) yang dipakai langsung di `packages/ui-tokens`.

---

## 14. Asumsi & pertanyaan terbuka

### 14.1 Asumsi (dipakai di dokumen ini; ubah jika keliru)
| ID | Asumsi |
|---|---|
| A-01 | Satu user = satu role global; peran per project hanya label + flag pengelola |
| A-02 | Punch list dimodelkan sebagai WO berjenis **Punch List** (`is_punch_list`, kategori Pengiriman & Serah Terima). Syarat "0 punch list" = semua WO jenis ini Selesai/Dibatalkan |
| A-03 | Tanggal serah terima diisi manual oleh pengelola saat serah terima dilakukan |
| A-04 | Bobot default WO = rata; bobot eksplisit opsional dan dinormalisasi (§8.4) |
| A-05 | Portofolio S-Curve = rata-rata project aktif (bobot project sama). Tidak ada nilai kontrak (non-goal keuangan) untuk pembobotan |
| A-06 | Project tidak punya tahapan; proses paralel = kategori WO. Status project hanya Berjalan / Ditunda / Selesai |
| A-07 | WO punya `planned_start` (opsional, default tanggal dibuat) agar Timeline & S-Curve rencana bisa dihitung. Field ini **belum ada di frame `D/06`/`M/06`** dan perlu ditambahkan |
| A-08 | Email user adalah akun Google pribadi. Pengiriman email memakai domain `remula.co.id` |
| A-09 | Domain internal `rein.remula.co.id`; HP lapangan memakai VPN untuk membuka tautan dari WA/email |
| A-10 | Webhook status WA (delivered/failed) membutuhkan endpoint yang bisa dijangkau Meta. Rekomendasi: route publik **tunggal** `/webhooks/wa` yang diverifikasi signature `X-Hub-Signature-256` lewat reverse proxy terbatas. Jika kebijakan kantor melarang inbound sama sekali, status hanya diambil dari respons kirim (tanpa delivered/read) |
| A-11 | Hari kerja Senin–Jumat untuk job 07:00 & ringkasan harian; hari libur nasional belum dihitung |
| A-12 | Retensi data project tanpa batas (tidak dihapus otomatis); lampiran soft-delete dihapus fisik setelah 30 hari |
| A-13 | Figma dibuat dengan font Inter. Tema gelap: mode `Dark` di collection `Color`, dan semua layar punya versi gelap di halaman **Desktop · Dark** dan **Mobile · Dark** |

### 14.2 Pertanyaan terbuka
1. Siapa yang berhak memindahkan project ke **Selesai**? Hanya Manager pengelola, atau perlu persetujuan atasan (mis. Direktur)?
2. Apakah nomor RPO mengikuti format baku (`RPO-YYYY-NNN`) yang harus divalidasi, atau bebas?
3. Apakah butuh **template WO per jenis project** (mis. paket standar WO untuk storage tank)? Saat ini di luar cakupan.
4. Nomor WhatsApp pengirim: apakah perusahaan siap memverifikasi Meta Business dan menyediakan nomor khusus? Siapa penanggung jawab biaya WA?
5. Apakah server boleh menerima **satu** endpoint inbound untuk webhook WA (A-10)?
6. Kapasitas disk & RAM aktual server on-prem, serta aplikasi lain yang berbagi resource?
7. Apakah ada SSO kantor (Google Workspace/AD) yang lebih disukai daripada password + PIN? (Brief meminta password + PIN; SSO = usulan masa depan.)
8. Apakah Produksi/QC memakai HP pribadi (BYOD)? Ini memengaruhi kebijakan PIN/perangkat dan profil VPN.
9. Apakah perlu ekspor laporan (PDF/Excel) progres project untuk klien? Saat ini tidak ada.
10. Kebijakan retensi: berapa lama data & lampiran project Selesai harus disimpan?
11. Apakah Admin perlu melihat semua project (audit), atau cukup audit log?
12. Hari libur nasional: perlu diperhitungkan untuk pengingat deadline dan S-Curve (hari kerja vs kalender)?

---

### Lampiran A — Ringkasan keputusan desain (Figma)
- **Gaya Linear:**
  - sidebar kiri 240 px, topbar 48 px dengan breadcrumb,
  - baris tabel 40–44 px, tipografi 11–14 px untuk UI dan 20–24 px untuk judul,
  - border 1 px, radius 4–12 px,
  - status sebagai ikon kecil (lingkaran kosong/setengah/penuh),
  - command palette `Ctrl/Cmd+K`.
- **Warna minim:** netral abu-abu + **satu aksen biru** `#4F6BED` (aksi utama, fokus, tautan, progres). **Merah** `#E5484D` hanya untuk Urgent, terlambat, Butuh bantuan, dan aksi destruktif. **Hijau redup** `#4E9A5E` hanya untuk Selesai/100%.
- **Mobile-first untuk kerja harian:** bottom nav 5 tab (Beranda, Tugas, Project, Notifikasi, Profil), FAB "Buat WO", composer logbook menempel di bawah dengan tombol kamera, PIN keypad, bottom sheet untuk aksi cepat.
- **Kepadatan informasi:** Beranda menjawab "apa yang harus saya kerjakan, apa yang urgent, siapa yang butuh bantuan" dalam satu layar. Detail WO menggabungkan konteks + logbook + properti tanpa pindah halaman.
- **Ringan:** tanpa ilustrasi/gambar dekoratif; banner & logo opsional; grafik S-Curve dan Timeline cukup dengan SVG garis.
