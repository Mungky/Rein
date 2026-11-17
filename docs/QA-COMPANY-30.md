# QA perusahaan simulasi REIN — 17 November 2026

## Hasil

Profil desktop dipadatkan: navigasi akun horizontal, identitas sejajar dengan nama panggilan, kontak/notifikasi berdampingan, dan keamanan dua kolom. Susunan mobile tetap ditumpuk.

Simulasi memakai database khusus **rein_company_qa**, aplikasi **http://localhost:3100**, penyimpanan lokal, serta provider WA/email dalam memori. Data utama aplikasi tidak dipakai untuk simulasi.

- 30 akun aktif: 1 Admin bootstrap dan **29 akun diundang serta diaktifkan melalui UI**.
- Undangan dilakukan oleh Admin IT dan Admin HR yang hanya diberi izin mengelola pengguna.
- 3 project: QA Storage Tank 50L, QA Mixing Tank 2000L, QA Panel Kontrol.
- 20 WO: **19 Selesai**, **1 Dibatalkan** setelah pengujian penutupan manual.
- Ketiga project berstatus **Selesai**.
- Pemeriksaan database akhir: 10 lampiran aktif, file terbesar 52.428.800 byte, 514 peristiwa audit.
- **98 pemeriksaan UI akhir lulus**. Empat reproduksi bug terpisah dilakukan sebelum perbaikan.
- **332 tes otomatis lulus**: server 141, shared 181, web 10. Typecheck, lint file yang berubah, dan pemeriksaan format lulus.
- Budget awal: JS 61,5 KB gzip / 100 KB; CSS 8,0 KB gzip / 20 KB.

## Bug yang diperbaiki

| ID | Tingkat | Temuan | Perbaikan dan bukti |
| --- | --- | --- | --- |
| QA-01 | Tinggi | Admin dengan admin.users, tanpa admin.roles, dapat menaikkan akun lain menjadi Admin penuh. | Server menolak pemberian role berkewenangan admin.roles dan pengelolaan akun administrator oleh admin terbatas. Daftar role dan aksi UI mengikuti batas ini. Reproduksi UI, uji ulang UI, dan tes server mencakup role salinan serta izin khusus pengguna. |
| QA-02 | Tinggi | Izin attachment.upload yang dimatikan bisa dilewati melalui staging lampiran WO/logbook. | Izin dicek ulang saat file ditautkan ke WO/logbook. Kontrol unggah mengikuti izin; catatan teks tetap bisa dibuat. Foto profil sendiri tetap bisa diubah. Dibuktikan dari UI dan tes negatif server. |
| QA-03 | Sedang | File tepat pada batas 50 MB ikut ditolak sebagai terpotong. | Penghitung stream menolak ukuran di atas batas; limit parser membedakan batas sah dan overflow. Tes server mencakup batas minus satu, tepat batas, dan plus satu. UI menerima 50 MiB dan menolak 51 MiB sebelum upload. |
| QA-04 | Sedang | Kegagalan mengambil jenis WO meninggalkan dropdown kosong tanpa pesan atau cara mencoba ulang. | Form menampilkan status pemuatan, pesan kegagalan, dan Coba lagi; pengiriman dinonaktifkan sampai data tersedia. Satu request sengaja diputus, kemudian UI berhasil memuat ulang enam kategori. |
| QA-05 | Rendah | Project Selesai masih menawarkan Buat WO, padahal server menolak pembuatan. | Kemampuan createWo mempertimbangkan status project. Tombol hilang setelah Selesai; tes server dan UI menegaskannya. |
| QA-06 | Rendah | Tombol Kirim logbook aktif saat catatan dan lampiran kosong. | Tombol nonaktif sampai ada teks atau file yang siap dikirim. Diperiksa dengan akun biasa serta akun tanpa izin unggah. |

Tidak ada migrasi data atau dependensi aplikasi baru.

## Cakupan UI

| Area | Pemeriksaan |
| --- | --- |
| Akun | Undang dengan/tanpa email dan nomor WA awal; aktivasi password; WA saja pada onboarding; OTP dari provider uji diinput di aplikasi; PIN dibuat pada satu akun dan dilewati pada akun lain; nama panggilan. |
| Admin berbeda | Admin IT mengelola role/izin; Admin HR dapat mengundang pengguna tetapi tidak membuka Role & Izin, memberi role Admin penuh, atau mengelola akun administrator. |
| Role | Role baca saja dibuat melalui UI dan ditugaskan; role yang sedang dipakai tidak dapat dihapus; Engineering/Drafting yang tidak dipakai berhasil dihapus. |
| Izin per orang | Finance/Accounting baca saja; Direktur dibatasi; seorang engineer dilarang unggah tetapi tetap dapat menulis catatan; Auditor tidak dapat melihat S-Curve. |
| Project | Tiga pengelola membuat project dan memilih anggota; foto/logo dan banner diunggah dari form; tambah/cabut anggota diuji lewat akses halaman berikutnya. |
| WO | Enam kategori, PIC anggota, tanggal, detail, Urgent, lampiran, serta perubahan detail melalui UI. |
| Pelaksanaan | PIC mulai bekerja, menulis hasil, mengirim Review; pengelola meminta revisi dengan alasan dan menyetujui hasil. PIC yang bukan pembuat/pengelola tidak dapat menyetujui Review sendiri. |
| Bantuan/realtime | Permintaan bantuan terlihat di Beranda pengelola tanpa muat ulang manual; balasan dan penyelesaian bantuan terlihat di halaman PIC. |
| Lampiran | PDF/foto, kompresi dan thumbnail, penolakan ukuran 51 MiB, penerimaan tepat 50 MiB, penolakan tipe executable, serta gabungan asal Project/WO/Logbook di tab Lampiran. |
| Worklist | Table, Kanban, Timeline, S-Curve; filter kategori, PIC, dan Urgent. Daftar project memakai Card dan filter Selesai. |
| Privasi | Anggota biasa tidak dapat membuka URL project lain. Pencabutan anggota menghilangkan akses. Manager yang hanya anggota tidak mendapat aksi pengelola. |
| Penyelesaian | Ditunda dengan alasan, dilanjutkan, Selesai; pengguna berizin global membuka kembali dengan alasan. Penutupan manual diterima meski ada WO terbuka; WO pengujian kemudian dibatalkan dengan alasan dan project ditutup kembali. |
| Kontak/notifikasi | Email opsional ditambahkan dan diverifikasi setelah login; kanal email saja dan WA saja tersimpan berbeda per akun. Inbox/tugas berada di Beranda. |
| Sesi | Nonaktif akun mencabut sesi; aktif kembali mempertahankan pekerjaan. Keluar semua perangkat diuji pada dua sesi browser. |
| Profil | Avatar sendiri tetap dapat diganti saat izin unggah project dimatikan. Lebar 320, 390, 768, 1024, 1101, 1280, 1440 px diuji pada terang/gelap tanpa overflow. Pemeriksaan akhir independen juga memakai Chrome DevTools. |

## Daftar akun

Semua nama dan kontak adalah data simulasi. Kredensial bootstrap hanya tersimpan lokal pada .data/company-qa/bootstrap.json, tidak disertakan dalam commit.

| No | Username | Role akhir | Dibuat oleh |
| --- | --- | --- | --- |
| 00 | qa.admin | Admin | Bootstrap |
| 01 | qa.karyawan01 | Human Resources | Admin IT |
| 02 | qa.karyawan02 | Direktur | Admin HR |
| 03 | qa.karyawan03 | Engineering Manager | Admin HR |
| 04 | qa.karyawan04 | Production Manager | Admin HR |
| 05 | qa.karyawan05 | Warehouse Manager | Admin HR |
| 06 | qa.karyawan06 | Finance | Admin HR |
| 07 | qa.karyawan07 | Accounting | Admin HR |
| 08 | qa.karyawan08 | Human Resources | Admin HR |
| 09 | qa.karyawan09 | Purchasing Procurement | Admin HR |
| 10 | qa.karyawan10 | Purchasing Procurement | Admin HR |
| 11 | qa.karyawan11 | Safety Man | Admin HR |
| 12 | qa.karyawan12 | Safety Man | Admin HR |
| 13 | qa.karyawan13 | Mechanical Engineer | Admin HR |
| 14 | qa.karyawan14 | Mechanical Engineer | Admin HR |
| 15 | qa.karyawan15 | Mechanical Engineer | Admin IT |
| 16 | qa.karyawan16 | Mechanical Engineer | Admin IT |
| 17 | qa.karyawan17 | Process Engineer | Admin IT |
| 18 | qa.karyawan18 | Process Engineer | Admin IT |
| 19 | qa.karyawan19 | Electrical Engineer | Admin IT |
| 20 | qa.karyawan20 | Electrical Engineer | Admin IT |
| 21 | qa.karyawan21 | Electrical Engineer | Admin IT |
| 22 | qa.karyawan22 | Civil Engineer | Admin IT |
| 23 | qa.karyawan23 | Civil Engineer | Admin IT |
| 24 | qa.karyawan24 | QC | Admin IT |
| 25 | qa.karyawan25 | QC | Admin IT |
| 26 | qa.karyawan26 | Produksi | Admin IT |
| 27 | qa.karyawan27 | Produksi | Admin IT |
| 28 | qa.karyawan28 | Purchasing Procurement | Admin IT |
| 29 | qa.karyawan29 | Auditor Proyek QA | Admin IT |

## Bukti dan pengulangan lokal

Folder .data/company-qa menyimpan hasil per langkah, trace jaringan untuk diagnosis, screenshot desktop/mobile, roster, dan state simulasi. Seluruhnya diabaikan Git karena mengandung data uji dan tautan aktivasi.

Harness lokal .data/company-server.ts menyalakan app QA; .data/company-ui.mjs menjalankan browser Chrome otomatis. Akun, project, WO, lampiran, dan perubahan akses dijalankan lewat formulir/aksi UI. Query database hanya dipakai untuk bootstrap, diagnosis, dan pengecekan akhir. Perbaikan penting juga memiliki tes regresi dalam suite server yang dapat dijalankan dengan pnpm --filter @rein/server test.

HTTP 401 pada halaman login/akun yang sesinya dicabut, 404 untuk project terlarang, 409/422 pada validasi undangan, 415 untuk executable, dan pemutusan jaringan yang disengaja adalah hasil yang diharapkan. Pemeriksaan browser akhir tidak menunjukkan galat console.

## Batas pengujian

Pengiriman nyata OpenWA/Gmail, Google OIDC, GCS, perangkat kamera/HEIC fisik, offline/PWA, serta beban 200 pengguna tidak diuji dalam simulasi ini. WA/email menggunakan provider memori dan lampiran memakai LocalDriver. Hasil ini memverifikasi alur dan izin pada dataset perusahaan simulasi, bukan jaminan bebas bug untuk seluruh kombinasi atau integrasi produksi.
