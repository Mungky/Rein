# REIN v2 — self-host di Coolify

Target: `https://staff.remula.online`, repository `https://github.com/Mungky/Rein`, branch
`main`. Keputusan deployment: **database baru**, tanpa impor data REIN lama
atau data simulasi lokal. App, PostgreSQL 16, OpenWA, foto, dan lampiran berjalan/disimpan di
server sendiri. **Gmail/email ditunda**; Google Cloud bukan syarat deployment saat ini.

## 1. Yang perlu disiapkan

- Akses Coolify, SSH server, pengaturan DNS `staff.remula.online`, dan akses repository GitHub.
- Kapasitas praktis yang disarankan: 2 vCPU, RAM 4 GB, ruang kosong 30 GB; RAM 8 GB lebih
  nyaman bila build dan aplikasi lain berjalan di server yang sama. Ini perkiraan kapasitas,
  bukan hasil load test server Anda. Pastikan port publik 80/443 menuju proxy Coolify.
- Nomor WhatsApp bot beserta HP untuk scan QR. OpenWA v2 memakai database dan sesi sendiri.
  Jika nomor sedang dipakai instance lama, hentikan instance lama saat memindahkan koneksi.
- Lima secret acak **berbeda**: `POSTGRES_PASSWORD`, `OPENWA_DB_PASSWORD`, `AUTH_PEPPER`,
  `OPENWA_API_KEY`, `OPENWA_WEBHOOK_SECRET`. Jalankan `openssl rand -hex 32` untuk setiap
  nilai. Password PostgreSQL dalam URL koneksi harus URL-safe; hasil hex memenuhi syarat.

Simpan `AUTH_PEPPER` permanen bersama backup secret. Mengganti/menghilangkannya membuat
password dan PIN yang sudah tersimpan gagal diverifikasi. Jangan kirim secret melalui chat
atau memasukkannya ke Git.

## 2. Penyimpanan dan kanal aktif

Compose memasang volume permanen `app-uploads` pada `/app/uploads` di service `app`.
Foto dan lampiran tersimpan di disk server; container app berjalan sebagai UID 1000 dan
direktori ini disiapkan writable oleh image. File dibaca melalui API yang memeriksa izin.
Jangan menghapus volume saat redeploy. Volume `pg-data` dan `openwa-data` juga dipertahankan.

Isi **`MAIL_PROVIDER=null`** di Coolify. Jika pernah terisi `gmail`, ubah secara eksplisit
karena Coolify dapat mempertahankan nilai environment lama setelah konfigurasi dimuat ulang.
Kosongkan variabel Google/Gmail untuk tahap ini; tidak perlu bucket, key JSON, atau OAuth.
Email tidak terkirim. Gunakan WhatsApp dan salin tautan undangan dari Admin. Pengiriman
email, verifikasi kontak email dan pemulihan melalui email menunggu Gmail diaktifkan.
Provider null dapat mencatat pesan/tautan verifikasi ke log; batasi akses log kepada Admin.

## 3. Buat resource baru di Coolify

Gunakan resource baru, misalnya **REIN v2**, agar volume/database aplikasi lama tidak dipakai.

| Pengaturan | Nilai |
| --- | --- |
| Repository | `Mungky/Rein` |
| Branch | `main` |
| Build pack | Docker Compose |
| Base Directory | `/` |
| Docker Compose Location | `/docker-compose.yml` |
| Preserve repository during deployment | **Aktif** (bind mount skrip init PostgreSQL) |
| Raw Compose Deployment | Nonaktif |
| Connect to predefined network | Tidak diperlukan |
| Service publik | `app`, port internal `3000` |

Compose produksi berada di root repository: build context `.` dan bind
`./infra/postgres/init` menunjuk skrip init yang benar. Coolify mengelola jaringan dan proxy.
Jangan tambahkan port publik untuk PostgreSQL atau OpenWA. Volume `pg-data` dan `openwa-data`
harus milik resource v2 yang baru; jangan sambungkan volume lama atau memakai external volume.

Salin variabel dari [`infra/coolify.env.example`](../infra/coolify.env.example) ke Environment
Variables di Coolify dan isi semuanya yang dibutuhkan. Template kosong belum siap dijalankan.
Variabel ini dipakai saat runtime/Compose interpolation, bukan ditempel ke Dockerfile.

- `APP_URL=https://staff.remula.online` tanpa port/trailing path.
- Seluruh lima secret dan nomor bot format internasional, misalnya `628…`.
- `MAIL_PROVIDER=null`; Google/Gmail boleh kosong. Penyimpanan server sudah diatur Compose.
- `SEED_ADMIN_EMAIL`, `SEED_ADMIN_PASSWORD` yang kuat, nama dan username untuk bootstrap.
  Email ini kontak Admin awal; email karyawan tetap opsional saat diundang.
- `OPENWA_IMAGE`: default tersedia di template. Setelah uji berhasil, pin image digest
  yang diuji agar upgrade berikutnya terkontrol. Jangan ganti tag secara otomatis saat cutover.

Untuk uji sebelum cutover, gunakan hostname sementara dengan HTTPS yang Anda miliki.
Atur `APP_URL` dan domain service sesuai hostname sementara tersebut.
Domain produksi tetap di aplikasi lama sampai
pengujian selesai. Di kolom domain service Coolify, akhiran `:3000` memilih port container,
misalnya `https://hostname-sementara:3000`; URL pengguna tetap HTTPS port 443.

## 4. Deploy dan buat Admin

1. Deploy. Migrasi tabel, enam role sistem, dan jenis WO berjalan otomatis saat app start.
   PostgreSQL membuat database `rein` dan `openwa` hanya saat volume pertama dibuat.
2. Buka terminal **service app**, lalu jalankan sekali:

   ```sh
   node dist/seed-cli.js
   ```

   CLI menambahkan 13 role organisasi dan Admin awal, tanpa menimpa data/izin yang sudah
   ada. Hasil yang diharapkan: `Admin dibuat.`; jika dilewati, periksa tiga variabel seed
   email/password/pepper. Menjalankan ulang aman, tetapi tidak mereset password Admin.
3. Login menggunakan username/password bootstrap. Kosongkan `SEED_ADMIN_PASSWORD` di
   Coolify, lalu redeploy agar password bootstrap tidak terus tersimpan di env container.
4. Atur **Admin → Role & izin**, lalu **Pengguna → Akses & notifikasi** bila butuh
   pengecualian per orang. Admin bawaan tidak memiliki izin membuat project; aktifkan
   **Membuat project** pada role yang memang bertugas membuat project.
5. Sebagai Admin, buka `/admin/whatsapp`, siapkan sesi lalu scan QR dari HP bot. Halaman ini
   memanggil OpenWA melalui API internal; dashboard/port OpenWA tidak perlu dibuka publik.
   Periksa status siap dan uji pengiriman OTP ke nomor karyawan.

### Jika OpenWA gagal masuk database

Error `password authentication failed for user "openwa"` dapat berarti password berbeda
atau role belum dibuat. Perubahan environment tidak menjalankan ulang init pada volume yang
sudah terisi. Di Terminal **container postgres**, jalankan skrip pemulihan yang idempoten:

```sh
sh /docker-entrypoint-initdb.d/01-databases.sh
```

Skrip memakai `OPENWA_DB_PASSWORD` container, membuat role/database OpenWA hanya bila belum
ada, dan menyamakan password. Tabel/data REIN tidak dihapus. Pastikan environment password
OpenWA memakai nilai yang sama, lalu restart service `openwa`. Jika skrip tidak ditemukan,
aktifkan Preserve repository during deployment dan muat ulang/redeploy Compose terlebih dahulu.

Di REIN buka **Admin → WhatsApp → Hubungkan WhatsApp**, lalu scan QR. Mengisi
`REIN_WA_NUMBER` hanya memberi informasi nomor bot, tidak menghubungkan sesi. Setelah status
**Terhubung**, barulah pengguna meminta OTP. Kegagalan layanan tidak menghabiskan kuota
harian; percobaan berulang dibatasi 5/menit, sedangkan kode berhasil dikirim tetap 5/24 jam.

Mengubah password PostgreSQL pada env **tidak** mengubah password role pada volume yang
sudah terisi. Rotasi kredensial harus mengubah password database dan konfigurasi app/OpenWA
bersama-sama; jangan menghapus volume sebagai cara memperbaikinya.

## 5. Pemeriksaan sebelum pindah domain

- `/healthz` dan `/readyz` sehat; login dan navigasi SPA bekerja setelah refresh halaman.
- Undang akun lewat tautan aktivasi, verifikasi WA (bot mengirim OTP → masukkan di app),
  lewati/buat PIN, lalu isi nickname/foto. Email menunggu layanan Gmail diaktifkan.
- Pastikan WhatsApp tetap tersambung setelah redeploy.
- Uji pengguna dengan cakupan akses berbeda; buat project → WO → logbook → lampiran.
- Uji unggah/unduh file, batas 50 MB per file, gabungan lampiran project, dan tandai project
  selesai secara manual. Pastikan live update berfungsi pada dua sesi browser.
- Pastikan app/database v2 tidak berisi 30 pengguna atau project dummy dari simulasi lokal.

## 6. Cutover staff.remula.online

1. Jadwalkan waktu peralihan dan backup database, file, serta konfigurasi aplikasi lama.
   Hentikan perubahan data di aplikasi lama selama pergantian.
2. Lepaskan domain `staff.remula.online` dari resource lama, lalu pasang ke service `app`
   resource v2 (port internal `3000`). Hindari dua resource melayani hostname yang sama.
3. Ubah `APP_URL` ke domain produksi, lalu redeploy.
   Jika IP server sama, DNS yang sudah benar tidak perlu berubah. Jika server berbeda,
   ubah A/AAAA sesuai IP baru; pastikan tidak ada AAAA lama yang menuju server lain.
4. Pastikan TLS valid, lalu ulangi uji login, OTP, unggah/unduh, dan pembuatan project.
   Pertahankan backup dan volume lama sampai masa retensi yang disepakati berakhir.

Rollback: hentikan penulisan v2, lepaskan domain dari v2, kembalikan route/domain ke aplikasi
lama, dan sambungkan kembali bot jika dipindahkan. Data baru yang ditulis di v2 **tidak**
otomatis masuk ke database lama; simpan/export untuk rekonsiliasi sebelum rollback.

## 7. Backup operasional

Backup **belum otomatis** hanya dengan deploy Compose. `GCS_BACKUP_BUCKET` pada template
pengembangan lama bukan pekerjaan backup yang sudah terimplementasi.

Contoh backup melalui SSH host (isi nama container PostgreSQL dan app **v2** dari Coolify;
hentikan sementara perubahan data/unggahan agar pasangan backup konsisten):

```sh
DB_CONTAINER='ganti-nama-container-postgres-v2-dari-Coolify'
APP_CONTAINER='ganti-nama-container-app-v2-dari-Coolify'
mkdir -p /data/rein-v2/backups
umask 077
docker exec "$DB_CONTAINER" sh -c 'PGPASSWORD="$POSTGRES_PASSWORD" pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > "/data/rein-v2/backups/rein-$(date +%Y%m%d-%H%M%S).dump"
docker exec "$APP_CONTAINER" tar -C /app/uploads -czf - . > "/data/rein-v2/backups/uploads-$(date +%Y%m%d-%H%M%S).tar.gz"
```

Jadwalkan backup database **dan lampiran**, salinan off-site, serta uji restore ke resource
terpisah. Cadangkan juga sesi/config OpenWA, `AUTH_PEPPER`, dan env rahasia secara terenkripsi.
Backup yang hanya
berada di server yang sama belum melindungi dari kerusakan server.

## Verifikasi paket sebelum push — 17 November 2026

- Lint dan typecheck lulus; 332 test lulus (181 shared, 141 server, 10 web).
- Build Docker Node 22 Alpine berhasil. Image read-only/non-root diuji dengan PostgreSQL
  baru yang terisolasi: migrasi, 19 role, satu Admin, seed berulang, login, cookie Secure,
  SPA beserta asset/CSP, `/healthz` dan `/readyz` lulus. Tidak ada project dummy.
- Init database OpenWA diuji dengan password mengandung apostrof. Compose diperiksa untuk
  path build dan tidak adanya port publik.
- Perbaikan Compose root diuji tanpa kredensial Google: unggah/unduh melalui API sebagai
  user non-root, hapus dan buat ulang container dengan volume yang sama, lalu unduh ulang
  file dengan sesi yang sama. File tetap utuh dan akses tanpa login ditolak.
- Budget frontend lulus: JS awal 61,5 KB gzip dan CSS 8,0 KB gzip. Audit dependensi produksi
  tidak menemukan kerentanan yang diketahui.
- Belum menguji server Coolify Anda, DNS/TLS produksi, atau WhatsApp nyata dalam
  paket deployment ini. Uji container memakai provider lokal/null; checklist go-live di atas
  tetap perlu dijalankan dengan kredensial dan nomor sebenarnya.

## Referensi operator

- [Coolify Docker Compose](https://coolify.io/docs/applications/builds/docker-compose)
- [Coolify domain dan port container](https://coolify.io/docs/core/networking/domains)
- [Coolify persistent storage](https://coolify.io/docs/applications/configuration/persistent-storage)
