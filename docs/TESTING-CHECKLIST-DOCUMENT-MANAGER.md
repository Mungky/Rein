# User Testing Checklist — Document Manager V2

**Pra-syarat:**
- `alembic upgrade head` sudah dijalankan
- Backend & frontend sudah di-restart
- Anda login sebagai admin

---

## ☐ Bagian 1 — Permission Overhaul

### 1.1 Admin Dashboard — folder permission matrix punya 6 kolom
- [ ] Buka `/admin` → tab "Permission Role"
- [ ] Expand role apa saja (misal Director)
- [ ] Pastikan tabel "Akses Folder Dokumen" punya 6 header: **View · Upload · Download · Rename · Hapus · Pindah**
- [ ] Centang/uncenter beberapa kotak, klik **Simpan Perubahan**, refresh — perubahan tersimpan

### 1.2 Director tidak lagi bypass
- [ ] Login sebagai user dengan role `director`
- [ ] Sebelumnya: Director bisa lihat semua folder
- [ ] Sekarang: hanya folder yang dicentang **View** di matrix yang muncul
- [ ] Jika admin uncheck View untuk Director di folder Engineering → Director tidak melihat folder Engineering lagi

### 1.3 Granular rename / delete / move
- [ ] Login sebagai role yang dapat View tapi tidak Rename
- [ ] Klik kebab menu (3 titik) di file — "Ganti nama" tetap muncul jika user adalah uploader file itu sendiri
- [ ] Klik "Ganti nama" di file orang lain — gagal dengan pesan "Tidak memiliki izin rename"
- [ ] Centang Rename di admin dashboard untuk role itu — sekarang berhasil

### 1.4 Sidebar:* perms hilang
- [ ] Buka admin dashboard → Permission Role → expand role
- [ ] Pastikan tidak ada group **"Sidebar & Modul"** lagi
- [ ] Pastikan group lain (Dashboard, Document Manager, Workspace, Administrasi) tetap ada

---

## ☐ Bagian 2 — Batch Upload

### 2.1 Upload 10+ file sekaligus
- [ ] Drop 10–20 file ke main area (atau sidebar UploadZone)
- [ ] Modal detection muncul, deteksi metadata berjalan
- [ ] Klik **Mulai Upload N File**
- [ ] Modal tertutup, panel pojok kanan-bawah muncul (kecil)
- [ ] Panel menampilkan "Mengunggah X/N" + bar progress
- [ ] Klik panel — expand, lihat status per file
- [ ] **Maksimum 3 file** upload bersamaan (lihat icon spinner) — sisanya queue
- [ ] Semua selesai → panel berubah jadi "N/N selesai" dengan tombol Tutup

### 2.2 Auto-retry saat gagal
- [ ] Putuskan internet sebentar saat ada upload berjalan
- [ ] Item akan masuk status "akan mencoba lagi"
- [ ] Setelah internet kembali → otomatis retry sampai 2x
- [ ] Setelah 3 total percobaan → status "Gagal" + tombol manual retry (RotateCw)

### 2.3 Drop folder rekursif
- [ ] Drop seluruh folder (yang isinya file)
- [ ] Semua file di dalam folder + subfolder masuk antrian (struktur folder diabaikan — semua masuk folder yang sedang dipilih)
- [ ] File dengan ekstensi tidak didukung di-filter otomatis

### 2.4 Mini UI tidak menutupi layar
- [ ] Pastikan panel hanya 340px lebar di pojok
- [ ] Saat collapsed: 1 baris header dengan progress bar
- [ ] Saat expanded: scrollable max 300px tinggi

---

## ☐ Bagian 3 — View Request (Pustakawan Inbox)

### 3.1 Konfigurasi email
- [ ] Buka folder "Riwayat & Sementara" → tombol "Email" di header
- [ ] Modal tampilkan: SMTP terkonfigurasi (✓), LIBRARIAN_EMAILS diset (✓), recipient list ter-redact
- [ ] Klik **Kirim Tes** → semua recipient menerima email tes
- [ ] Jika gagal → error spesifik muncul di modal

### 3.2 Banner peringatan
- [ ] Hapus `LIBRARIAN_EMAILS` di `.env`, restart
- [ ] Buka "Riwayat & Sementara" → banner merah muncul: "SMTP atau LIBRARIAN_EMAILS belum diset"

### 3.3 Inbox Pustakawan via UI
- [ ] Login sebagai user biasa (bukan admin / director / manager) yang TIDAK punya can_download di suatu folder
- [ ] Klik "Minta Akses" pada file di folder itu → status "Menunggu…"
- [ ] Logout, login sebagai director / manager / admin
- [ ] Navigate ke `/dcc/access` (Inbox Pustakawan)
- [ ] Permintaan tadi muncul di "Permintaan Menunggu"
- [ ] Klik **Setujui** → status berubah jadi "approved"
- [ ] Logout, login balik sebagai user biasa → status berubah dari "Menunggu…" jadi tombol "Buka" hijau

### 3.4 Auto-approve via can_download
- [ ] Admin centang `can_download` untuk role tertentu di folder tertentu
- [ ] Login dengan role itu, klik "Minta Akses" pada file di folder tsb
- [ ] Langsung approved tanpa perlu Pustakawan — link Drive langsung terbuka

---

## ☐ Bagian 4 — Drive Trash Sync

### 4.1 Delete file → masuk Trash Drive
- [ ] Hapus 1 file lewat kebab menu → "Hapus"
- [ ] Konfirmasi muncul: "Akan dipindahkan ke Trash Google Drive (dapat dipulihkan 30 hari)"
- [ ] Setujui — file hilang dari list
- [ ] Buka Google Drive → Trash → file ada di sana

### 4.2 Delete folder rekursif → semua isi ke Trash
- [ ] Buat folder uji + upload 2-3 file ke dalamnya
- [ ] Hapus folder dari sidebar (icon trash)
- [ ] Folder + semua file masuk Drive Trash sekaligus

### 4.3 Rename → tetap sync (verifikasi tidak rusak)
- [ ] Rename folder → nama berubah di Drive
- [ ] Rename file → nama berubah di Drive

---

## ☐ Bagian 5 — Move File

### 5.1 UI Move
- [ ] Pilih file mana saja → kebab menu → "Pindahkan"
- [ ] Modal tree picker muncul
- [ ] Pilih folder tujuan → klik "Pindahkan"
- [ ] File hilang dari folder asal, muncul di folder tujuan
- [ ] Buka Drive → file pindah ke folder Drive yang sesuai

### 5.2 Permission check
- [ ] Login sebagai role tanpa can_move → menu "Pindahkan" tidak muncul (admin saja melihat menu tsb saat ini)
- [ ] Untuk role lain, opsi "Pindahkan" akan muncul jika admin centang can_move di folder asal

---

## ☐ Bagian 6 — Activity Timeline

### 6.1 Layout sesuai mockup
- [ ] Buka folder "Riwayat & Sementara"
- [ ] Setiap row: icon kiri (Upload/Download/Hapus/dll) + nama file + uploader di bawah
- [ ] Kanan: waktu + 3 dot (hanya untuk file in-progress: propose · process · audit)
- [ ] Hover row → tombol trash di paling kanan untuk record gagal/stuck

### 6.2 Search
- [ ] Ketik nama file di search bar → debounce 350ms, list ter-filter
- [ ] Ketik nama uploader → juga ter-filter
- [ ] Klik X → reset

### 6.3 Filter aksi
- [ ] Dropdown filter → pilih "Upload" → hanya entry upload
- [ ] Pilih "Permintaan akses" → hanya itu
- [ ] Pilih "Semua aksi" → reset

### 6.4 Pagination
- [ ] Jika > 50 entry → tombol pagination di footer
- [ ] Klik next/prev — list update

### 6.5 Stuck handler
- [ ] Cari file dengan status "uploading" sangat lama → muncul tombol "N stuck" di header
- [ ] Klik → semua di-flip ke "failed"
- [ ] Background task otomatis flip file > 10 menit ke failed setiap 5 menit

### 6.6 Hapus record permanen
- [ ] Hover entry dengan status uploading/in_audit/failed → tombol trash kanan
- [ ] Klik → konfirmasi → record hilang dari DB + Drive (kalau ada orphan)

---

## ☐ Bagian 7 — Breadcrumb & Navigation

### 7.1 Tombol back/forward
- [ ] Buka folder A → folder B → folder C
- [ ] Tombol `←` aktif → kembali ke B → `←` ke A
- [ ] Tombol `→` aktif → maju ke B
- [ ] Setelah back lalu klik folder D → forward stack ter-truncate

### 7.2 Breadcrumb clickable
- [ ] Buka folder dalam (mis. "Engineering / Klien / MBP")
- [ ] Klik "Engineering" di breadcrumb → langsung navigate
- [ ] Klik "Klien" → navigate naik 1 level
- [ ] Segmen terakhir (current) bold, tidak terlihat clickable tapi tetap bisa diklik

---

## ☐ Bagian 8 — Public Index (Sheets)

### 8.1 Format kolom baru
- [ ] Upload file baru
- [ ] Buka Google Sheets "Index Publik"
- [ ] Header A1:H1 = `Tanggal | Tipe | Nomor | Nama File | Departemen | Folder | Diunggah Oleh | Link Drive`
- [ ] **Jika header lama masih ada**, kosongkan A1:H1 manual lalu upload lagi — auto-create header baru

### 8.2 Frontend Public Index match
- [ ] Buka folder "Index Publik" di app
- [ ] Tampil: Nama File · Diunggah Oleh · Waktu (subset Sheets)

---

## ☐ Bagian 9 — Cross-Department

### 9.1 Folder restricted tidak lagi muncul sebagai summary
- [ ] Login sebagai role yang tidak ada akses ke folder Engineering
- [ ] Buka sidebar → folder Engineering **tidak muncul** sama sekali
- [ ] Tidak ada lagi tampilan "X file (terbatas)" summary

---

## ☐ Bagian 10 — Smoke Test End-to-End

### 10.1 Skenario migrasi 100 file
- [ ] Drag-drop folder berisi 100 file ke main area
- [ ] Approve all di modal
- [ ] Panel pojok-bawah menjalankan 3 paralel sampai habis
- [ ] Tidak ada file stuck setelah 15 menit
- [ ] Semua 100 muncul di list + di Drive folder yang sesuai
- [ ] Sheets Public Index ter-update

---

## Kalau ada yang gagal

Saat melaporkan, sertakan:
1. **Bagian** mana yang gagal (mis. "Bagian 3.3 step 4")
2. **Pesan error** di UI atau di console browser (F12)
3. **Backend log** kalau ada (cari `ERROR` di output `uvicorn`)
4. **Network tab** untuk endpoint yang dipanggil saat aksi tersebut
