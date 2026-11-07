# Project — tahap pertama

Catatan historis tahap pertama. Semua tahap lanjutan kini selesai; rujuk [FINAL-DELIVERY.md](FINAL-DELIVERY.md) untuk cakupan, cara aktivasi, dan hasil uji terbaru.

## Yang tersedia

Workspace memiliki papan tahap kerja yang independen dari lifecycle Work Order. Pengelola proyek dapat membuat, mengganti nama, mengurutkan, meringkas, dan menghapus tahap kosong. Kartu dapat dipindahkan melalui drag/keyboard atau pilihan tahap pada kartu. Urutan kartu tersimpan di server. Assignee dapat memindahkan kartu miliknya; pengelola dapat memindahkan semua kartu pada proyek yang bisa diakses.

Setiap mutasi papan membawa `expected_version`. Server mengunci baris papan dalam transaksi, menolak versi lama dengan HTTP 409, dan menaikkan versi ketika berhasil. UI memulihkan posisi kartu jika penyimpanan gagal dan menyediakan tombol Muat ulang.

Pemindahan tahap tidak mengubah status, deadline, laporan atau data review WO. Persetujuan tetap melalui detail WO. API update umum menolak penggantian status langsung. Endpoint completion lama kini mengirim laporan ke `pending_review`, bukan langsung `done`. Laporan membutuhkan foto atau catatan; review memerlukan laporan dan permission review/manage. Mutasi lifecycle mengunci task agar request bersamaan tidak menimpa hasil review.

Pemeriksaan akses proyek juga berlaku untuk fase, task dan riwayat laporan yang diakses langsung melalui ID.

## Penyimpanan dan migrasi

Migrasi `ws_20261106_01`, setelah `q7r8s9t0u1v2`, menambah tiga tabel dengan Row Level Security:

- `workspace_boards`: versi papan per proyek.
- `workspace_task_stages`: nama, urutan, status ringkas dan proyek pemilik.
- `workspace_task_placements`: task, tahap dan urutan kartu.

Tabel dan kolom WO lama tidak diubah. Migrasi membuat empat tahap awal per proyek dan memetakan semua task lama, termasuk `overdue`, ke tahap awal yang sesuai. Status task tidak diubah. Setelah migrasi, keterlambatan dan status legacy tetap dipertahankan; pengubahan seluruh model overdue menjadi indikator turunan belum termasuk tahap ini.

Proyek baru dapat diinisialisasi melalui tombol Buat tahap awal. Task baru masuk tahap pertama tanpa mengubah status. Penempatan disimpan sebelum tahap diurutkan ulang. Downgrade menghapus tiga tabel papan; WO, laporan, fase dan proyek lama tetap ada. Susunan tahap khusus hilang ketika downgrade.

API papan berada di `/api/workspace/projects/{project_id}/board` dengan rute `initialize`, `stages`, `stages/{stage_id}` dan `tasks/{task_id}`. Penghapusan tahap berisi WO atau tahap terakhir ditolak.

## Mencoba secara lokal

Preview berjalan di [localhost:3000/project-preview](http://localhost:3000/project-preview). Contoh lokal menggunakan API port **8001**, database **rein_workspace_preview**, dan PostgreSQL Docker port **55439**. Data ini berbeda dari data layanan produksi pada `.env` aplikasi.

Frontend development perlu `WORKSPACE_LOCAL_PREVIEW=1`. Preview tidak memakai sesi Supabase, dan unggah foto dinonaktifkan agar tidak menulis storage produksi. API preview hanya mendaftarkan router Workspace, memakai profil admin contoh lokal, dan proses launcher mengikat server ke `127.0.0.1`. Jangan menjalankan launcher ini dengan bind publik. Halaman frontend mengembalikan 404 pada build production atau ketika flag preview tidak diaktifkan.

Untuk memulai ulang dari PowerShell:

```powershell
# Jalankan Docker Desktop terlebih dahulu. Container dibuat sekali.
docker start rein-workspace-preview-db

# Terminal backend, dari folder backend/
python scripts/workspace_preview.py

# Terminal frontend, dari folder frontend/
$env:WORKSPACE_LOCAL_PREVIEW = '1'
bun run dev --hostname 127.0.0.1 --port 3000
```

Jika membuat ulang container di komputer lain:

```powershell
docker run --name rein-workspace-preview-db --label app=rein-workspace-preview `
  -e POSTGRES_USER=rein -e POSTGRES_PASSWORD=rein_preview_local `
  -e POSTGRES_DB=rein_workspace_preview -p 127.0.0.1:55439:5432 -d postgres:17-alpine
```

Kredensial di atas hanya untuk database contoh di loopback. Launcher menolak host nonlokal atau nama database di luar daftar khusus preview/test. Launcher tidak memakai `DATABASE_URL` sebagai target seeding dan tidak menjalankan pekerja otomatis produksi.

## Mengaktifkan pada Workspace utama

Fitur papan baru default **mati** sehingga database yang belum dimigrasikan tetap dapat memakai API WO lama. Setelah migrasi pada lingkungan tujuan:

1. Backend: set `WORKSPACE_STAGES_ENABLED=1`.
2. Frontend: set `NEXT_PUBLIC_WORKSPACE_STAGES_ENABLED=1` lalu rebuild/restart frontend.
3. Masuk Workspace → Kanban → pilih proyek. Proyek baru menawarkan inisialisasi tahap.

Penguatan permission dan lifecycle berlaku juga ketika fitur papan baru mati. Klien lama yang mengirim status langsung harus beralih ke endpoint Mulai/Kirim Laporan/Review.

**Database produksi tidak dimigrasikan dalam pekerjaan ini.** Migrasi diterapkan dan diuji hanya pada database preview/test lokal. Preview menggunakan subset tabel Workspace; ini bukan pengganti uji deployment seluruh ERP.

## Verifikasi

- 36 tes backend: migrasi/backfill, downgrade, RLS tabel baru, akses proyek, persetujuan WO, kartu baru/proyek baru, versi lama dan dua request perubahan bersamaan.
- 58 tes frontend lulus, termasuk penempatan kartu yang mempertahankan metadata review dan snapshot rollback.
- TypeScript, lint pada berkas frontend yang diubah, dan build production berhasil.
- Browser desktop/ponsel: papan dimuat, tahap ditambah, kartu dipindahkan lewat pilihan tahap dan bertahan setelah muat ulang, laporan disetujui tanpa memindahkan kolom, lebar halaman ponsel tetap sesuai viewport.

Pengujian backend lokal dapat diulang dengan database khusus test, bukan database preview yang sedang dipakai:

```powershell
docker exec rein-workspace-preview-db createdb -U rein rein_workspace_preview_test
# Dari backend/
$env:WORKSPACE_TEST_DATABASE_URL = 'postgresql+asyncpg://rein:rein_preview_local@127.0.0.1:55439/rein_workspace_preview_test'
$env:SENTRY_DSN = ''
python -m pytest tests/test_workspace_board.py tests/test_workspace_workflow.py tests/test_app_routes.py -q
```

Tes integrasi melakukan reset **hanya** database bernama `rein_workspace_preview_test` di loopback; tes dilewati jika URL khusus tidak disediakan.

## Berikutnya

Subtasks, task dependencies, milestones, multi-assignee, recurrence, timesheet, dan portal customer diselesaikan pada tahap lanjutan yang dicatat di [FINAL-DELIVERY.md](FINAL-DELIVERY.md).
