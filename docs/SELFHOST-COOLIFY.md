# REIN v2 — self-host di Coolify

Target: `https://staff.remula.online`, repository `https://github.com/Mungky/Rein`, branch
`codex/rein-v2-coolify`. Keputusan deployment: **database baru**, tanpa impor data REIN lama
atau data simulasi lokal. App, PostgreSQL 16, dan OpenWA berjalan di server; lampiran di GCS,
email melalui Gmail API.

## 1. Yang perlu disiapkan

- Akses Coolify, SSH server, pengaturan DNS `staff.remula.online`, dan akses repository GitHub.
- Kapasitas praktis yang disarankan: 2 vCPU, RAM 4 GB, ruang kosong 30 GB; RAM 8 GB lebih
  nyaman bila build dan aplikasi lain berjalan di server yang sama. Ini perkiraan kapasitas,
  bukan hasil load test server Anda. Pastikan port publik 80/443 menuju proxy Coolify.
- Google Cloud project, bucket GCS **privat** khusus v2, service account, dan key JSON.
- Akun Gmail/Google Workspace pengirim, Gmail API aktif, OAuth web client dan refresh token.
- Nomor WhatsApp bot beserta HP untuk scan QR. OpenWA v2 memakai database dan sesi sendiri.
  Jika nomor sedang dipakai instance lama, hentikan instance lama saat memindahkan koneksi.
- Lima secret acak **berbeda**: `POSTGRES_PASSWORD`, `OPENWA_DB_PASSWORD`, `AUTH_PEPPER`,
  `OPENWA_API_KEY`, `OPENWA_WEBHOOK_SECRET`. Jalankan `openssl rand -hex 32` untuk setiap
  nilai. Password PostgreSQL dalam URL koneksi harus URL-safe; hasil hex memenuhi syarat.

Simpan `AUTH_PEPPER` permanen bersama backup secret. Mengganti/menghilangkannya membuat
password dan PIN yang sudah tersimpan gagal diverifikasi. Jangan kirim secret melalui chat
atau memasukkannya ke Git.

## 2. Google Cloud dan email

1. Buat bucket privat dengan Public Access Prevention. Beri service account akses
   `Storage Object Admin` hanya pada bucket tersebut. Key JSON dipakai server untuk akses
   objek dan menandatangani URL unduhan; jangan membuat bucket publik.
2. Upload key melalui SSH/SCP ke **host deployment** (server tempat container berjalan):
   `/data/rein-v2/secrets/gcs-key.json`. File harus sudah ada sebelum deploy.
   Lindungi direktori dengan mode `700`; file dimiliki UID `1000` (user container app), mode
   `400`. Simpan salinan terenkripsi terpisah untuk pemulihan. Bind mount bersifat read-only.
3. Aktifkan Gmail API. Buat OAuth client tipe **Web application**, daftarkan redirect URI
   persis `https://staff.remula.online/auth/google/callback`. Isi client ID dan secret di
   Coolify; konfigurasi ini sekaligus mengaktifkan tombol Login dengan Google, hanya untuk
   pengguna terdaftar.
4. Ambil refresh token untuk akun pengirim melalui skrip yang sudah tersedia:
   `pnpm gmail:token`. Skrip lokal menggunakan callback
   `http://localhost:3000/auth/google/callback`, jadi daftarkan URI lokal itu juga dan pastikan
   port lokal 3000 bebas saat menjalankan skrip. Isi konfigurasi OAuth lokal dari `.env`.
   Persetujuan akun Google dilakukan pemilik akun; token hasil skrip disimpan sebagai secret.
5. `GMAIL_SENDER` harus cocok dengan akun pemberi refresh token. Atur consent screen untuk
   penggunaan produksi sesuai jenis akun; token aplikasi OAuth berstatus Testing dapat
   kedaluwarsa. Uji pengiriman email nyata sebelum go-live.

`MAIL_PROVIDER=null` boleh digunakan sementara untuk pemeriksaan awal, tetapi email hanya
masuk log, **tidak terkirim**. Gunakan `gmail` saat go-live agar kanal cadangan tersedia.

## 3. Buat resource baru di Coolify

Gunakan resource baru, misalnya **REIN v2**, agar volume/database aplikasi lama tidak dipakai.

| Pengaturan | Nilai |
| --- | --- |
| Repository | `Mungky/Rein` |
| Branch | `codex/rein-v2-coolify` |
| Build pack | Docker Compose |
| Base Directory | `/infra` |
| Docker Compose Location | `/docker-compose.yml` |
| Preserve repository during deployment | **Aktif** (bind mount skrip init PostgreSQL) |
| Raw Compose Deployment | Nonaktif |
| Connect to predefined network | Tidak diperlukan |
| Service publik | `app`, port internal `3000` |

Direktori `/infra` penting: build context `..` menunjuk root repository dan bind
`./postgres/init` menunjuk skrip init yang benar. Coolify mengelola jaringan dan proxy.
Jangan tambahkan port publik untuk PostgreSQL atau OpenWA. Volume `pg-data` dan `openwa-data`
harus milik resource v2 yang baru; jangan sambungkan volume lama atau memakai external volume.

Salin variabel dari [`infra/coolify.env.example`](../infra/coolify.env.example) ke Environment
Variables di Coolify dan isi semuanya yang dibutuhkan. Template kosong belum siap dijalankan.
Variabel ini dipakai saat runtime/Compose interpolation, bukan ditempel ke Dockerfile.

- `APP_URL=https://staff.remula.online` tanpa port/trailing path.
- `GCS_BUCKET` nama bucket baru; `GCS_KEY_FILE` path absolut key di host di atas.
- Seluruh secret, Gmail/OAuth, dan nomor bot format internasional, misalnya `628…`.
- `SEED_ADMIN_EMAIL`, `SEED_ADMIN_PASSWORD` yang kuat, nama dan username untuk bootstrap.
  Email ini kontak Admin awal; email karyawan tetap opsional saat diundang.
- `OPENWA_IMAGE`: default tersedia di template. Setelah uji berhasil, pin image digest
  yang diuji agar upgrade berikutnya terkontrol. Jangan ganti tag secara otomatis saat cutover.

Untuk uji sebelum cutover, gunakan hostname sementara dengan HTTPS yang Anda miliki.
Atur `APP_URL`, redirect URI Google, dan domain service sesuai hostname sementara tersebut;
daftarkan juga callback itu pada OAuth client. Domain produksi tetap di aplikasi lama sampai
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

Mengubah password PostgreSQL pada env **tidak** mengubah password role pada volume yang
sudah terisi. Rotasi kredensial harus mengubah password database dan konfigurasi app/OpenWA
bersama-sama; jangan menghapus volume sebagai cara memperbaikinya.

## 5. Pemeriksaan sebelum pindah domain

- `/healthz` dan `/readyz` sehat; login dan navigasi SPA bekerja setelah refresh halaman.
- Undang akun, aktivasi, verifikasi WA (bot mengirim OTP → masukkan di app), lewati/buat PIN,
  isi nickname/foto, lalu hubungkan email lewat profil dan verifikasi email.
- Pastikan email nyata terkirim dan WhatsApp tetap tersambung setelah redeploy.
- Uji pengguna dengan cakupan akses berbeda; buat project → WO → logbook → lampiran.
- Uji unggah/unduh GCS, batas 50 MB per file, gabungan lampiran project, dan tandai project
  selesai secara manual. Pastikan live update berfungsi pada dua sesi browser.
- Pastikan app/database v2 tidak berisi 30 pengguna atau project dummy dari simulasi lokal.

## 6. Cutover staff.remula.online

1. Jadwalkan waktu peralihan dan backup database, file, serta konfigurasi aplikasi lama.
   Hentikan perubahan data di aplikasi lama selama pergantian.
2. Lepaskan domain `staff.remula.online` dari resource lama, lalu pasang ke service `app`
   resource v2 (port internal `3000`). Hindari dua resource melayani hostname yang sama.
3. Ubah `APP_URL` dan `GOOGLE_OAUTH_REDIRECT_URI` ke domain produksi, lalu redeploy.
   Jika IP server sama, DNS yang sudah benar tidak perlu berubah. Jika server berbeda,
   ubah A/AAAA sesuai IP baru; pastikan tidak ada AAAA lama yang menuju server lain.
4. Pastikan TLS valid, lalu ulangi uji login, OTP, email, unggah/unduh, dan pembuatan project.
   Pertahankan backup dan volume lama sampai masa retensi yang disepakati berakhir.

Rollback: hentikan penulisan v2, lepaskan domain dari v2, kembalikan route/domain ke aplikasi
lama, dan sambungkan kembali bot jika dipindahkan. Data baru yang ditulis di v2 **tidak**
otomatis masuk ke database lama; simpan/export untuk rekonsiliasi sebelum rollback.

## 7. Backup operasional

Backup **belum otomatis** hanya dengan deploy Compose. `GCS_BACKUP_BUCKET` pada template
pengembangan lama bukan pekerjaan backup yang sudah terimplementasi.

Contoh backup melalui SSH host (isi nama container PostgreSQL **v2** dari Coolify):

```sh
DB_CONTAINER='ganti-nama-container-postgres-v2-dari-Coolify'
mkdir -p /data/rein-v2/backups
umask 077
docker exec "$DB_CONTAINER" sh -c 'PGPASSWORD="$POSTGRES_PASSWORD" pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > "/data/rein-v2/backups/rein-$(date +%Y%m%d-%H%M%S).dump"
```

Jadwalkan backup database, salinan off-site, serta uji restore ke database terpisah. Cadangkan
juga sesi/config OpenWA, `AUTH_PEPPER`, env rahasia dan key GCS secara terenkripsi. Atur
perlindungan pemulihan/versioning objek GCS sesuai kebutuhan retensi. Backup yang hanya
berada di server yang sama belum melindungi dari kerusakan server.

## Verifikasi paket sebelum push — 17 November 2026

- Lint dan typecheck lulus; 332 test lulus (181 shared, 141 server, 10 web).
- Build Docker Node 22 Alpine berhasil. Image read-only/non-root diuji dengan PostgreSQL
  baru yang terisolasi: migrasi, 19 role, satu Admin, seed berulang, login, cookie Secure,
  SPA beserta asset/CSP, `/healthz` dan `/readyz` lulus. Tidak ada project dummy.
- Init database OpenWA diuji dengan password mengandung apostrof. Compose diperiksa untuk
  path build, mount key read-only, dan tidak adanya port publik.
- Budget frontend lulus: JS awal 61,5 KB gzip dan CSS 8,0 KB gzip. Audit dependensi produksi
  tidak menemukan kerentanan yang diketahui.
- Belum menguji server Coolify Anda, DNS/TLS produksi, GCS, Gmail, atau WhatsApp nyata dalam
  paket deployment ini. Uji container memakai provider lokal/null; checklist go-live di atas
  tetap perlu dijalankan dengan kredensial dan nomor sebenarnya.

## Referensi operator

- [Coolify Docker Compose](https://coolify.io/docs/applications/builds/docker-compose)
- [Coolify domain dan port container](https://coolify.io/docs/core/networking/domains)
- [Coolify persistent storage](https://coolify.io/docs/applications/configuration/persistent-storage)
- [GCS Signed URLs](https://cloud.google.com/storage/docs/access-control/signing-urls-with-helpers)
- [Google OAuth web server](https://developers.google.com/identity/protocols/oauth2/web-server)
- [Gmail API pengiriman](https://developers.google.com/workspace/gmail/api/guides/sending)
