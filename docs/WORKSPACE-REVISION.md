# Revisi ruang kerja — 16 November 2026

Permintaan pengguna memperbarui PRD FR-011/023/024/025/040/070/080. Figma **REIN — UI/UX** tetap menjadi acuan visual: file `m6TD7AHjnmgljGiPNT00f7`.

- D/02 `12:37`: statistik, callout bantuan, dan tugas berurutan terlambat → urgent → deadline. Notifikasi ditambahkan di bawahnya, memakai pola baris/tab D/08a `20:4101`. Menu Tugas dan Notifikasi dihapus; bookmark lama diarahkan ke bagian Beranda yang sesuai.
- D/10b `21:4857`, Dark `41:10536`: daftar role di kiri, kelompok Project/Logbook & lampiran/WO/Admin di kanan; toggle dan cakupan akses. Di ponsel daftar role bergulir mendatar dan kelompok izin menjadi satu kolom.
- Project Card `35:6596`: padding 12, border/radius dari token, logo/RPO, judul/klien, progres, avatar dan deadline. Daftar project memakai grid Card dengan pencarian/filter status; tidak mempunyai view switcher.
- D/05c `17:3222`: Timeline jadwal rencana → deadline, overlay progres, warna kategori pada bar, garis hari ini; skala minggu/bulan dan maksimal 300 bar per halaman.
- D/05d `17:3666`: S-Curve rencana putus-putus dan aktual biru, KPI rencana/aktual/deviasi/prediksi, SPI dan tabel bobot/kontribusi. API `/api/projects/:id/scurve` memvalidasi filter kategori/PIC/urgent dan izin project. Grafik maksimal 120 titik, aktual berhenti pada hari ini (akhir hari WIB), bobot memakai rumus bersama, canceled/deleted dikecualikan. Prediksi memakai regresi 14 hari. Penghitungan dilakukan saat view/filter berubah; cache M2 belum ditambahkan.
- Project Selesai ditentukan manual sesuai `project.close`; punch list, tanggal serah terima, dan BAST tidak menghalangi. Kolom historis tanggal serah terima tidak dihapus dari database; UI/API edit tidak menawarkannya.
- Composer logbook hanya teks dan lampiran. Payload progres/status ditolak server. Histori lama dan properti status WO tetap ada; status Selesai WO tetap menghasilkan progres 100 dan event grafik.
- Lampiran project mencakup WO/logbook yang masih aktif dan mencantumkan asal. File entitas yang dihapus dikecualikan; endpoint unduh memeriksa kepemilikan dan akses project.
- Batas 50 MB/file diperiksa sebelum kompresi, sebelum unggah, serta oleh streaming multipart server. Berkas yang terlalu besar tampil sebagai error per file. WO/logbook tetap maksimal 10 berkas per entri.
- Kartu akun sidebar menjadi dropdown **Konfigurasi profil / Keluar akun** dengan dukungan Escape dan klik di luar. Tombol tema sidebar dihapus; tombol topbar dan shortcut yang sudah ada dipertahankan. Topbar menampilkan kalender bulanan dan jam WIB, termasuk versi ringkas di ponsel.

Validasi: unit rumus S-Curve, batas unggah di klien, transisi status project; integrasi penutupan manual/izin, logbook idempoten, agregasi file/penghapusan, histori/filter S-Curve, serta tugas setelah keanggotaan dicabut. Verifikasi visual memakai database test dan provider pesan tiruan; data akun/project asli tidak dipakai untuk pengujian.
