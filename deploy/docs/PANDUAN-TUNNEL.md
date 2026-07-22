# Panduan Named Tunnel Cloudflare

> Pintu keluar internet untuk **stream** dan **mirror**. Dibuat sekali per PC,
> ±5 menit, di dashboard Cloudflare. Butuh domain yang sudah ada di akun
> Cloudflare kamu (mis. `remula-inti.com`).
>
> **Tanpa tunnel ini, stream/mirror tidak akan pernah muncul di R-Net** —
> layanannya hidup, tapi hanya bisa dilihat dari PC itu sendiri.

## Kenapa lewat tunnel?

PC lapangan tidak punya IP publik dan tidak boleh dibuka ke internet. Tunnel
membuat PC yang **menelepon keluar** ke Cloudflare, lalu Cloudflare yang
melayani penonton. Tidak ada port yang perlu dibuka di router.

Alamatnya permanen, jadi **diisi sekali seumur hidup** di R-Net > Kelola
Screen. PC tidak pernah menulis apa pun ke database R-Net — tidak ada
kredensial database yang perlu disimpan di PC lapangan.

## Langkah (di dashboard Cloudflare, sekali per PC)

1. Buka **one.dash.cloudflare.com** → **Networks → Tunnels → Create a tunnel**.
2. Pilih **Cloudflared**, beri nama (mis. `pabrik1`), **Save**.
3. Di layar berikutnya muncul perintah pemasangan seperti ini:

   ```
   cloudflared service install eyJhIjoiMWEyYjNj...   (sangat panjang)
   ```

   Yang kamu butuhkan adalah **bagian `eyJ...`-nya saja** — itulah tokennya.
   Panjangnya ratusan karakter; pastikan tersalin **utuh sampai ujung**.
   *(Perintah `service install`-nya sendiri tidak usah dijalankan — installer
   R-Net yang menjalankan tunnel, dan bukan sebagai service. Kalau kamu
   terlanjur menyalin seluruh baris, installer R-Net memotongnya sendiri.)*

   > **Jangan tertukar.** Ada tiga nilai berbeda yang mirip-mirip perannya:
   >
   > | Nilai | Bentuknya | Diisi di |
   > |---|---|---|
   > | Token tunnel | `eyJ...`, ratusan karakter | `config.env` → `TUNNEL_TOKEN` |
   > | Hostname publik | `mirror-pabrik1.remula-inti.com` | `config.env` → `MIRROR_HOSTNAME` |
   > | Nama sumber | `Server-Remula` | **R-Net > Kelola Screen** — tidak pernah masuk `config.env` |
4. Buka tab **Public Hostname → Add a public hostname**. Isi sesuai paket
   yang dipasang di PC ini:

   **STREAM (video):**
   - Subdomain: `stream-pabrik1` · Domain: `remula-inti.com`
   - Service **Type**: `HTTP` · **URL**: `localhost:8888`
   - → hostname jadi `stream-pabrik1.remula-inti.com`

   **MIRROR (VNC), kalau dipakai — Add a public hostname lagi:**
   - Subdomain: `mirror-pabrik1` · Domain: `remula-inti.com`
   - Service **Type**: `HTTP` · **URL**: `localhost:6080`
   - → hostname jadi `mirror-pabrik1.remula-inti.com`

5. **Save**. Selesai di dashboard.

> **Satu tunnel, dua hostname.** Jangan buat tunnel terpisah untuk mirror.
> Satu proses `cloudflared` di PC melayani kedua hostname sekaligus.

> ### Service **HTTP**, dan itu bukan salah ketik
>
> Kolom **Type** di atas mengatur cara `cloudflared` bicara ke program **di
> dalam PC** — bukan alamat yang dibuka penonton. MediaMTX dan websocat
> mendengar HTTP polos di localhost; keduanya tidak punya TLS.
>
> Alamat publiknya **tetap `https://`** apa pun isi kolom itu, karena TLS
> diterminasi di tepi Cloudflare. Jadi keduanya benar bersamaan:
>
> | Tempat | Nilai |
> |---|---|
> | Dashboard → Service Type | **HTTP** → `localhost:6080` |
> | R-Net → Kelola Screen → Alamat | **https://**`mirror-....` |
>
> Kalau Type diganti HTTPS, cloudflared mencoba jabat tangan TLS ke socket
> polos dan gagal — gejalanya **502 Bad Gateway**, atau di R-Net
> `WebSocket ... failed` dengan `code: 1006`.

## Masukkan ke PC

Saat `install.bat` bertanya, tempel:
- `TUNNEL_TOKEN` = token dari langkah 3
- `STREAM_HOSTNAME` = `stream-pabrik1.remula-inti.com`
- `MIRROR_HOSTNAME` = `mirror-pabrik1.remula-inti.com` (kalau pakai mirror)

Hostname ditulis **tanpa** `https://` dan tanpa garis miring — installer
membersihkannya sendiri kalau kamu terlanjur menempel alamat lengkap.

Atau edit langsung `C:\rein-scada\config.env` bagian `[TUNNEL]`.

## Isi alamat di R-Net (sekali saja, manual)

**R-Net > Data/Channel > Kelola Screen:**
- Sumber **Stream**, URL HLS: `https://stream-pabrik1.remula-inti.com/scada/index.m3u8`
  + username/password **viewer** MediaMTX yang dicatat installer.
- Sumber **VNC**, Alamat: `https://mirror-pabrik1.remula-inti.com`
  (R-Net mengubah `https://` jadi `wss://` sendiri) + password **view-only**.

`start.bat` mencetak ulang kedua alamat ini tiap kali dijalankan, jadi tidak
perlu dihafal. Karena alamatnya permanen, isian di R-Net **tidak perlu diubah
lagi** — tiap start cukup `start.bat`.

## Beberapa PC

Tiap PC = **tunnel sendiri** (token sendiri) dengan subdomain beda
(`stream-pabrik1`, `stream-pabrik2`, ...). Satu tunnel melayani stream +
mirror sekaligus (dua public hostname → dua service lokal).

## Kalau mirror/stream tetap kosong di R-Net

Periksa berurutan — hampir selalu berhenti di salah satu dari empat ini:

| # | Periksa | Cara |
|---|---|---|
| 1 | `TUNNEL_TOKEN` benar-benar terisi | Buka `C:\rein-scada\config.env`. Kalau barisnya `TUNNEL_TOKEN=` saja, tunnel tidak pernah jalan. `start.bat` juga memperingatkan ini. |
| 2 | Tunnel tersambung | `start.bat` harus mencetak "Named tunnel tersambung ke Cloudflare". Kalau ditolak, tokennya salah/kedaluwarsa — ambil baru di dashboard. |
| 3 | Layanan lokalnya hidup | Lihat daftar status di akhir `start.bat`: mirror butuh **TightVNC + websocat** hidup; stream butuh **MediaMTX** hidup. |
| 4 | Alamat di R-Net sama persis | Kelola Screen harus berisi hostname dari langkah 4, bukan alamat lama. |

Log mentah tunnel ada di `C:\rein-scada\cloudflared\tunnel.log`.
