# Revisi project — 18 November 2026

Permintaan pengguna ini menggantikan pembatasan Logbook pada revisi sebelumnya.
PRD revisi 1.9 menjadi sumber kebenaran. Draf `LOGBOOK-DIRECTION.md` tetap usulan.

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
  opsional, dan Note. Dapat ditambah manual, diubah, dihapus, dicari dan difilter. Mengelola
  mengikuti izin `wo.create` dan membaca mengikuti `project.view`; override server berlaku.
- Impor `.xlsx` maksimal 10 MB / 500 item sekaligus. Parser dimuat saat diperlukan.
  Header Description dan QTY dikenali meski bukan baris pertama; sheet tanpa tabel
  material, judul kelompok, dan baris kosong dilewati. Mendukung satuan pada kolom
  setelah QTY pada contoh Platform, atau kolom Unit/Satuan, serta QTY gabungan.
  Header STOCK, PO, RECIVED/RECIEVED/RECEIVED, STATUS dan Note dibaca jika ada.
  Status kosong menjadi Not available, kecuali kolom STOCK/PO menunjukkan ketersediaan.
  Tidak ada evaluasi rumus, pengambilan tautan eksternal, atau pembacaan kolom keuangan.
  Tabel hasil dan kesalahan bernomor baris ditampilkan sebelum simpan. Satu baris invalid
  membatalkan seluruh impor. Pengulangan request dengan ID sama idempoten. Duplikat pada
  input manual, edit, pemulihan, dalam satu file, maupun impor ulang dicegah server.
  Identitas = Part No. + Description + Material + Spesifikasi + Satuan, huruf kecil dan
  spasi dirapikan. Jumlah, status, tanggal dan note tidak membuat item baru. Impor melewati
  duplikat, menampilkan hitungan sebelum simpan dan melaporkan hasil server; jumlah/note
  lama tidak ditimpa atau dijumlah otomatis. Semua penulisan diserialkan dengan kunci
  baris project. Duplikat lama dipertahankan agar riwayat tidak hilang; dapat dihapus manual.
- Hapus Material memakai `deleted_at`, versi `expectedUpdatedAt`, audit, dan tombol
  Batalkan pada notifikasi. Item terhapus tidak tampil di project maupun WO. Pemulihan
  mengembalikan hubungan WO sebelumnya; ditolak jika sudah ada material aktif yang sama.
- Attach Material menyimpan hubungan banyak-ke-banyak dengan WO dalam project yang sama,
  dicek server dengan `wo.create`. Hubungan tampil pada tab Material dan detail WO,
  dapat dilepas dari tab Material, dan tidak digandakan saat request diulang.
- Tab Lampiran menjadi Dokumen. Kategori lama tidak lagi ditampilkan atau dipilih;
  file dan metadata lama dipertahankan. Attach membuat referensi ke WO dalam project
  yang sama dengan izin `attachment.upload`. File tetap di pemilik asal, dapat dirujuk
  beberapa WO, dan muncul di detail WO. Referensi identik tidak digandakan. Sumber/WO
  dihapus tidak ditampilkan; endpoint file tetap memeriksa akses sumbernya.

## Deployment dan pemeriksaan

Migrasi `0008_project_materials.sql` hanya menambah tabel `project_materials` dan kolom
nullable `logbook_entries.category`; tidak mengubah atau menghapus data lama. Produksi
menjalankan migrasi saat startup seperti sebelumnya. Untuk dev: `pnpm db:migrate`.
Migrasi `0009_material_links.sql` menambah `project_materials.deleted_at` dan tabel
`work_order_materials`, tanpa menghapus atau menggabungkan material lama.

Pengujian mencakup validasi, parser layout Platform, izin/override dan isolasi project,
impor atomik/idempoten, benturan update progres, audit, progres S-Curve, serta referensi
Dokumen. Uji browser memakai database test dan provider notifikasi null.
