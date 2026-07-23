# db/certs — CA Supabase untuk verifikasi sertifikat database

`db/session.py` memverifikasi sertifikat server Supabase memakai file CA di
folder ini. Tanpa file ini koneksi tetap terenkripsi tapi **tidak
terverifikasi** (rentan MITM) — session.py menulis warning tiap start.

## Cara unduh (sekali)

1. Supabase Dashboard → project REIN → **Project Settings → Database**.
2. Bagian **SSL Configuration** → tombol **Download certificate**.
3. File yang terunduh bernama `prod-ca-2021.crt` — simpan **di folder ini**
   (`db/certs/prod-ca-2021.crt`).

File CA ini **publik** (bukan rahasia) — aman ikut di-commit ke git, dan
memang sebaiknya di-commit supaya backend di Coolify otomatis membawanya
saat build dari repo.

## Di server (Coolify)

Tidak ada langkah tambahan kalau CA sudah di-commit: path default
`db/certs/prod-ca-2021.crt` relatif ke root repo, ikut ter-copy saat build.
Kalau cert ingin ditaruh di tempat lain (mis. mount volume), set env:

```
DB_SSL_ROOT_CERT=/path/ke/prod-ca-2021.crt
```

## Verifikasi aktif?

Start backend dan pastikan **tidak ada** warning
"CA Supabase tidak ditemukan" di log. Tes negatif: ganti nama file CA lalu
start ulang — warning harus muncul lagi.
