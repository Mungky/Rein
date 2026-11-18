# Revisi project — 18 November 2026

Permintaan pengguna ini menggantikan pembatasan Logbook pada revisi sebelumnya.
PRD revisi 1.8 menjadi sumber kebenaran. Draf `LOGBOOK-DIRECTION.md` tetap usulan.

## Perilaku

- WO tetap mengikuti alur Belum Mulai → Dikerjakan → Review → Selesai. Minimal satu
  Logbook non-sistem diperlukan untuk Review. PIC/pemegang `wo.edit.any` mengirim ke
  Review; pembuat WO/pemegang `wo.edit.any` menyetujui Selesai. UI menjelaskan syaratnya.
- Logbook menerima progres integer 0–100% dan status catatan Aktivitas/Dokumen/Kendala,
  keduanya opsional. Status catatan tidak mengubah status WO atau otomatis meminta bantuan.
  Progres hanya untuk PIC dengan `wo.edit.own` atau pemegang `wo.edit.any`, pada WO aktif.
  Pembaruan progres memerlukan versi WO; perubahan bersamaan ditolak 409, catatan tidak
  disimpan sebagian. Snapshot, progres WO, `progress_events` S-Curve, dan audit satu transaksi.
- Material per project: Part No., Description, Material, Size or Specification, QTY
  positif (maksimal tiga desimal) + satuan, In stock/Not available/PO, tanggal diterima
  opsional, dan Note. Dapat ditambah manual, diubah, dicari dan difilter. Mengelola
  mengikuti izin `wo.create` dan membaca mengikuti `project.view`; override server berlaku.
- Impor `.xlsx` maksimal 10 MB / 500 item sekaligus. Parser dimuat saat diperlukan.
  Header Description dan QTY dikenali meski bukan baris pertama; sheet tanpa tabel
  material, judul kelompok, dan baris kosong dilewati. Mendukung satuan pada kolom
  setelah QTY pada contoh Platform, atau kolom Unit/Satuan, serta QTY gabungan.
  Header STOCK, PO, RECIVED/RECIEVED/RECEIVED, STATUS dan Note dibaca jika ada.
  Status kosong menjadi Not available, kecuali kolom STOCK/PO menunjukkan ketersediaan.
  Tidak ada evaluasi rumus, pengambilan tautan eksternal, atau pembacaan kolom keuangan.
  Tabel hasil dan kesalahan bernomor baris ditampilkan sebelum simpan. Satu baris invalid
  membatalkan seluruh impor. Pengulangan request dengan ID sama idempoten; memilih dan
  mengimpor file lagi menambahkan baris baru, sesuai pemberitahuan pada pratinjau.
- Tab Lampiran menjadi Dokumen. Kategori lama tidak lagi ditampilkan atau dipilih;
  file dan metadata lama dipertahankan. Attach membuat referensi ke WO dalam project
  yang sama dengan izin `attachment.upload`. File tetap di pemilik asal, dapat dirujuk
  beberapa WO, dan muncul di detail WO. Referensi identik tidak digandakan. Sumber/WO
  dihapus tidak ditampilkan; endpoint file tetap memeriksa akses sumbernya.

## Deployment dan pemeriksaan

Migrasi `0008_project_materials.sql` hanya menambah tabel `project_materials` dan kolom
nullable `logbook_entries.category`; tidak mengubah atau menghapus data lama. Produksi
menjalankan migrasi saat startup seperti sebelumnya. Untuk dev: `pnpm db:migrate`.

Pengujian mencakup validasi, parser layout Platform, izin/override dan isolasi project,
impor atomik/idempoten, benturan update progres, audit, progres S-Curve, serta referensi
Dokumen. Uji browser memakai database test dan provider notifikasi null.
