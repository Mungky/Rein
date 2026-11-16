# Pengaturan pengguna — 16 November 2026

Perubahan atas permintaan user, melengkapi PRD §2, FR-090/092, dan keputusan M1 sebelumnya:

- Email undangan opsional; undangan tanpa kontak tetap menghasilkan tautan aktivasi 72 jam. Admin membagikan tautan sendiri. Akun baru memverifikasi WhatsApp setelah aktivasi; email dikonfigurasi dari Profil setelah masuk.
- Pengguna dan Admin dapat memilih WhatsApp, email, atau keduanya per akun. Pilihan ini mengesampingkan fallback kanal default; WhatsApp saja tidak mengirim email. Notifikasi dalam aplikasi tetap aktif. Event yang tersedia pada setiap kanal mengikuti matriks M1.
- Delivery diperiksa terhadap preferensi terbaru dan kontak terverifikasi. Gmail API tetap memakai konfigurasi yang ada; `MAIL_PROVIDER=null` menandai delivery email dilewati tanpa pengiriman. Worker email memakai antrean yang sama dengan retry 1/5/30 menit dan jam tenang.
- Izin efektif = izin role ditambah override khusus pengguna. `none` menolak izin, sedangkan tidak ada override berarti mengikuti role. Scope tetap all/managed/member/own sesuai permission. Admin yang mempunyai `admin.roles` dapat mengubah override; `admin.users` mengatur kanal pengguna lain. Akses administrasi Admin bawaan tidak dapat dicabut lewat override.
- Role bawaan selain Admin boleh dihapus hanya jika tidak digunakan. Penanda penghapusan di `system_state` mencegah seed membuatnya ulang. Role dan pengguna lain tidak dihapus otomatis.
- Migrasi `0006_user_access_channels` menambahkan `user_permissions` dan dua flag kanal pada `user_settings`, tanpa mengubah izin default role atau data kontak yang sudah ada.

## Revisi onboarding — 16 November 2026

Permintaan pengguna mengganti FR-003 AC2 dan kewajiban PIN FR-004:

1. Pengguna mengisi nomor WhatsApp. Bot mengirim OTP 6 digit lewat provider OpenWA yang sudah terhubung; pengguna memasukkan OTP di aplikasi.
2. Setelah WA sah, pengguna membuat PIN 6 digit atau memilih **Lewati dulu**. Pilihan disimpan dan tidak ditanyakan lagi saat login berikutnya.
3. Pengguna mengisi nama panggilan dan memilih foto profil (opsional), lalu **Mulai**. Nama resmi tidak berubah.
4. Email, kanal notifikasi, dan perubahan kontak berada di **Profil → Kontak & notifikasi**. Aktivasi tidak otomatis mengirim kode email.

OTP berlaku 10 menit, maksimal 5 kode per hari per akun/nomor, jeda kirim ulang 60 detik, maksimal 5 kode salah per tantangan. Kode di-hash dengan HMAC, terikat akun, dikonsumsi atomik, tidak dikirim dalam respons API atau log aplikasi. Pengiriman gagal membatalkan tantangan. Pesan masuk ke bot tidak lagi memverifikasi nomor. Admin tetap dapat memverifikasi manual.

Migrasi `0007_onboarding_whatsapp` mempertahankan akses akun aktif lama yang sudah mempunyai kontak terverifikasi, termasuk Admin bootstrap. Akun baru wajib WA; email terverifikasi lewat Google tidak melewati tahap ini. PIN perangkat yang sudah dibuat tetap mengunci sesi seperti sebelumnya. Saat menguji alur lengkap gunakan undangan akun baru.
