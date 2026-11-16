# Pengaturan pengguna — 16 November 2026

Perubahan atas permintaan user, melengkapi PRD §2, FR-090/092, dan keputusan M1 sebelumnya:

- Email undangan opsional; undangan tanpa kontak tetap menghasilkan tautan aktivasi 72 jam. Admin membagikan tautan sendiri. Pengguna memilih kontak setelah aktivasi, dan minimal satu kontak harus terverifikasi untuk masuk.
- Pengguna dan Admin dapat memilih WhatsApp, email, atau keduanya per akun. Pilihan ini mengesampingkan fallback kanal default; WhatsApp saja tidak mengirim email. Notifikasi dalam aplikasi tetap aktif. Event yang tersedia pada setiap kanal mengikuti matriks M1.
- Delivery diperiksa terhadap preferensi terbaru dan kontak terverifikasi. Gmail API tetap memakai konfigurasi yang ada; `MAIL_PROVIDER=null` menandai delivery email dilewati tanpa pengiriman. Worker email memakai antrean yang sama dengan retry 1/5/30 menit dan jam tenang.
- Izin efektif = izin role ditambah override khusus pengguna. `none` menolak izin, sedangkan tidak ada override berarti mengikuti role. Scope tetap all/managed/member/own sesuai permission. Admin yang mempunyai `admin.roles` dapat mengubah override; `admin.users` mengatur kanal pengguna lain. Akses administrasi Admin bawaan tidak dapat dicabut lewat override.
- Role bawaan selain Admin boleh dihapus hanya jika tidak digunakan. Penanda penghapusan di `system_state` mencegah seed membuatnya ulang. Role dan pengguna lain tidak dihapus otomatis.
- Migrasi `0006_user_access_channels` menambahkan `user_permissions` dan dua flag kanal pada `user_settings`, tanpa mengubah izin default role atau data kontak yang sudah ada.
