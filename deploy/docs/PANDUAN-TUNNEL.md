# Panduan Named Tunnel Cloudflare (Mode Produksi)

> Supaya alamat stream/mirror **permanen** — diisi sekali di R-Net, tidak
> berubah tiap kali start. Dibuat sekali per PC, ±5 menit. Butuh domain
> `remula-inti.com` yang sudah ada di akun Cloudflare kamu.

## Kenapa named tunnel?

| | Quick Tunnel (tes) | Named Tunnel (produksi) |
|---|---|---|
| Alamat | acak, ganti tiap start | tetap (domain sendiri) |
| Isi di Kelola Screen | tiap start | **sekali seumur hidup** |
| Butuh service key Supabase di PC | ya | **tidak** (lebih aman) |
| Cocok untuk | coba-coba | dipakai beneran |

## Langkah (di dashboard Cloudflare, sekali per PC)

1. Buka **one.dash.cloudflare.com** → **Networks → Tunnels → Create a tunnel**.
2. Pilih **Cloudflared**, beri nama (mis. `pabrik1`), **Save**.
3. Di layar berikutnya kamu diberi **token** panjang
   (`eyJ...`). **Salin token itu** — ini yang masuk ke `config.env`.
   *(Abaikan perintah `cloudflared service install ...` — installer R-Net
   yang menjalankannya, bukan sebagai service.)*
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

## Masukkan ke PC

Saat `install.bat` bertanya, tempel:
- `TUNNEL_TOKEN` = token dari langkah 3
- `STREAM_HOSTNAME` = `stream-pabrik1.remula-inti.com`
- `MIRROR_HOSTNAME` = `mirror-pabrik1.remula-inti.com` (kalau pakai mirror)

Atau edit langsung `C:\rein-scada\config.env` bagian `[TUNNEL]`.

## Isi alamat di R-Net (sekali saja)

**R-Net > Data/Channel > Kelola Screen:**
- Sumber **Stream**, URL HLS: `https://stream-pabrik1.remula-inti.com/scada/index.m3u8`
- Sumber **VNC**, Alamat: `https://mirror-pabrik1.remula-inti.com`
  (R-Net mengubah `https://` jadi `wss://` sendiri) + Password view-only.

Karena alamatnya permanen, ini **tidak perlu diubah lagi** — tiap start cukup
`start.bat`, tunnel langsung menyambung ke hostname yang sama.

## Beberapa PC

Tiap PC = **tunnel sendiri** (token sendiri) dengan subdomain beda
(`stream-pabrik1`, `stream-pabrik2`, ...). Satu tunnel bisa melayani stream +
mirror sekaligus (dua public hostname → dua service lokal). Tidak ada lagi
`STREAM_NAME`/`VNC_SOURCE` yang saling menimpa seperti mode Quick Tunnel.

## Masih mau pakai mode tes?

Kosongkan `TUNNEL_TOKEN`. `start.bat` otomatis balik ke Quick Tunnel (URL acak)
dan — kalau `SUPABASE_URL`/`SUPABASE_SERVICE_KEY` diisi — menuliskan alamat baru
ke R-Net tiap start. Untuk coba-coba saja, jangan untuk dipakai beneran.
