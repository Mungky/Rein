# Project — hasil akhir implementasi

Semua tahap pada rencana adaptasi telah dibuat di Rein. Implementasi memakai FastAPI, SQLAlchemy dan React/Next.js yang sudah digunakan Rein. Ini adaptasi fitur Project ke model Rein; tidak memasang server Odoo atau mengimpor kode Odoo ke aplikasi.

Preview: [http://localhost:3000/project-preview](http://localhost:3000/project-preview).

## Cakupan yang selesai

| Area | Perilaku yang tersedia |
|---|---|
| Workflow | Tahap dinamis terpisah dari status WO; drag/keyboard/pilihan tahap; urutan tersimpan; konflik versi ditolak |
| WO | Tambah WO dan fase, edit detail, mulai, kirim laporan, review, revisi dan persetujuan |
| Perencanaan | Tugas induk/subtugas, banyak penanggung jawab, prasyarat, prioritas, tag dan estimasi menit |
| Validasi | Menolak self-link, relasi lintas proyek, siklus prasyarat dan siklus gabungan induk/subtugas; prasyarat menahan eksekusi; subtugas menahan persetujuan induk |
| Milestone | Buat, edit, hapus jika tidak dipakai, tandai tercapai jika semua WO selesai, dan buka kembali |
| Tampilan | Papan, daftar dengan paginasi server, kalender deadline, timeline berdasarkan estimasi hari dan deadline |
| Filter | Nama, status, penanggung jawab termasuk assignee tambahan, tag, prioritas, terhambat dan terlambat; API juga menerima milestone |
| Kolaborasi | Komentar internal/eksternal, mention anggota proyek, lampiran dan aktivitas perubahan |
| Lampiran | Unggah/unduh/hapus PDF, PNG, JPEG dan TXT sampai 5 MB; scope proyek; unduhan sebagai attachment; tidak memakai storage produksi pada preview |
| Timesheet | Catat menit dan deskripsi per tanggal, edit/hapus berdasarkan kepemilikan/izin, batas 24 jam per pengguna per hari dan ID permintaan untuk mencegah pencatatan ganda |
| Notifikasi | Inbox internal untuk assignment/lifecycle, komentar/mention, perkembangan proyek dan WO berulang; tanda sudah dibaca hanya oleh pemilik |
| Kesehatan proyek | Ringkasan perkembangan dengan kondisi sesuai rencana, perlu perhatian, terkendala, ditunda atau selesai |
| Laporan | Progres, status, terlambat, terhambat, estimasi vs waktu aktual, pivot beban per orang, milestone dan burndown 30 hari |
| Pengulangan | Harian/mingguan/bulanan, interval, tanggal berikutnya/akhir, aktif/nonaktif, worker otomatis dan pemrosesan manual jadwal jatuh tempo |
| Template | Salin proyek beserta fase, tahap, WO, subtugas, prasyarat, tag, milestone dan assignee sebagai pekerjaan baru |
| Pesanan | Buat proyek dan WO dari referensi pesanan layanan, nama pelanggan dan rincian pekerjaan; referensi yang sama tidak membuat proyek ganda |
| Pelanggan | Portal baca-saja melalui token acak, kedaluwarsa 1–90 hari dan dapat dicabut; hanya item yang ditandai untuk pelanggan yang ditampilkan |
| Keamanan data | Scope proyek di API, assignment tambahan masuk pemeriksaan akses, RLS pada tabel baru, token portal disimpan sebagai hash |

Inbox adalah notifikasi di aplikasi; implementasi tidak otomatis mengirim email atau pesan keluar. Integrasi pesanan adalah penerimaan referensi dan rincian pesanan, bukan sinkronisasi dengan sistem penjualan eksternal atau modul akuntansi baru.

Portal tidak menampilkan identitas staf, waktu kerja, komentar internal, task yang tidak dibagikan, atau lampiran internal. Progres portal dihitung dari pekerjaan yang memang dibagikan dan diberi label demikian.

Timeline adalah tampilan perencanaan native Rein. Tidak mengklaim menyalin fitur Gantt Enterprise Odoo.

## Migrasi dan penyimpanan

1. `ws_20261106_01`: tiga tabel papan; backfill tahap dan penempatan WO lama.
2. `ws_20261106_02`: 16 tabel perencanaan, kolaborasi, waktu, aktivitas, jadwal, portal dan pesanan.

Kedua migrasi berada setelah head lama `z0a1b2c3d4e5`. Migrasi kedua menyimpan SQL schema yang tetap, sehingga perubahan model di masa depan tidak mengubah definisi migrasi yang sudah terbit. Semua tabel baru mengaktifkan RLS dan diakses melalui backend, bukan akses anonim langsung.

Tabel WO/proyek/fase/laporan lama dipertahankan. `assigned_to` tetap menjadi assignee utama; tabel tambahan menampung semua assignee. Penggantian assignee utama melalui editor lama menyelaraskan tabel tambahan tanpa menghapus assignee sekunder.

Downgrade migrasi kedua menghapus data fitur lanjutan, tetapi mempertahankan proyek, fase, WO dan laporan lama. Downgrade migrasi pertama menghapus susunan papan khusus. Keduanya telah diuji pada database lokal khusus test.

## Pengaktifan

**Database produksi belum dimigrasikan atau diubah dalam pekerjaan ini.** Sumber, migrasi dan fitur tersedia untuk deployment terpisah setelah peninjauan.

Setelah kedua migrasi diterapkan pada lingkungan tujuan:

```env
# Backend
WORKSPACE_STAGES_ENABLED=1
WORKSPACE_PROJECT_SUITE_ENABLED=1
WORKSPACE_RECURRENCE_WORKER_ENABLED=1

# Frontend .env.local / environment build
NEXT_PUBLIC_WORKSPACE_STAGES_ENABLED=1
NEXT_PUBLIC_WORKSPACE_PROJECT_SUITE_ENABLED=1
```

Rebuild frontend dan restart backend setelah mengubah flag. Semua flag baru default mati pada contoh konfigurasi agar database yang belum dimigrasikan tetap dapat menjalankan modul lama. Penguatan scope akses dan lifecycle WO berlaku juga ketika flag fitur lanjutan mati.

Worker memakai tanggal Asia/Jakarta, memeriksa jadwal setiap menit, dan membuat maksimal 25 kejadian per proyek per siklus. Penguncian proyek dan pasangan unik `(recurrence_id, scheduled_for)` mencegah duplikasi saat worker/manual run berjalan bersamaan. Interval bulanan mempertahankan tanggal acuan, termasuk tanggal 31 setelah Februari.

WO berulang adalah pekerjaan baru independen: Todo, tanpa laporan/review lama, dan tidak otomatis dibagikan ke pelanggan. Estimasi, assignee, tag dan prasyarat disalin; hubungan induk tidak disalin. Milestone yang sudah tercapai tidak diwariskan ke WO baru. Jadwal yang tertinggal diproses bertahap pada siklus berikutnya.

Salinan template mereset lifecycle, tanggal, review, diskusi, waktu, jadwal berulang dan akses pelanggan. Struktur perencanaan tetap disalin. Referensi pesanan dinormalisasi ke huruf besar dan dilindungi dari request pembuatan bersamaan.

## Menjalankan preview

Preview menggunakan:

- Frontend development: port 3000, halaman `/project-preview`.
- API terisolasi: port 8001.
- PostgreSQL khusus: container `rein-workspace-preview-db`, loopback port 55439, database `rein_workspace_preview`.
- Test integrasi: database terpisah `rein_workspace_preview_test`.

```powershell
docker start rein-workspace-preview-db

# Terminal 1, dari backend/
python scripts/workspace_preview.py

# Terminal 2, dari frontend/
$env:WORKSPACE_LOCAL_PREVIEW = '1'
bun run dev --hostname 127.0.0.1 --port 3000
```

Launcher preview mengikat API ke loopback, memvalidasi host/nama database khusus, memakai admin contoh lokal, memigrasikan hanya subset Workspace lokal, dan menyalakan worker pengulangan. Data contoh yang sudah diubah pengguna tidak direset saat restart. Halaman preview tidak tersedia di build production. Launcher preview tidak boleh dipakai sebagai server publik/production.

Cara membuat container pertama kali dicatat di [IMPLEMENTATION.md](IMPLEMENTATION.md). Tautan portal preview memakai `?preview=1`; pengalihan ke API preview diabaikan pada build production.

## Verifikasi akhir

- **69 tes backend lulus**: perencanaan, akses multi-assignee, konflik versi, siklus tugas, subtugas/persetujuan, timesheet termasuk pencatatan bersamaan dan idempotensi payload, lampiran, notifikasi assignment, portal/revokasi/kedaluwarsa, recurrence, template, pesanan bersamaan, pencarian, RLS, downgrade/upgrade dan matriks permission.
- **61 tes frontend lulus**: termasuk filter assignee tambahan, indikator terhambat/terlambat yang independen dari lifecycle, dan penempatan kartu yang mempertahankan metadata review.
- TypeScript, lint pada berkas frontend yang diubah dan build production lulus.
- Browser: referensi pesanan membuat proyek dengan dua WO; satu WO diberi dua assignee, dicatat waktu 30 menit, dikirim laporannya dan disetujui; portal menampilkan hanya WO yang dibagikan.
- Laporan menampilkan progres, beban kerja, estimasi dan jam aktual dari data server.
- Worker otomatis terverifikasi membuat tepat satu kejadian baru tanpa tombol proses manual; kejadian baru berstatus Todo dan tidak terlihat oleh pelanggan.
- Halaman utama Project dan portal diuji pada viewport ponsel 390 px tanpa melebar di luar viewport.

Riwayat burndown tidak dapat merekonstruksi tanggal penyelesaian WO lama yang tidak pernah dicatat. API mengembalikan `history_complete=false` dan UI menampilkan penjelasan ketika riwayat tersebut belum lengkap.

Untuk mengulang test backend dari folder `backend/`:

```powershell
$env:WORKSPACE_TEST_DATABASE_URL = 'postgresql+asyncpg://rein:rein_preview_local@127.0.0.1:55439/rein_workspace_preview_test'
$env:SENTRY_DSN = ''
python -m pytest tests/test_workspace_project.py tests/test_workspace_project_rules.py tests/test_workspace_board.py tests/test_workspace_workflow.py tests/test_app_routes.py tests/test_permission_matrix.py -q
```

Database test direset oleh fixture; pemeriksa URL menolak host nonlokal atau nama database selain database khusus test. Jangan menggantinya dengan URL database operasional.
