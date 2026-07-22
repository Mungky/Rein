# deploy/ — R-Net di PC lokal (compact)

Semua yang jalan **di PC pabrik/site** ada di folder ini. Yang jalan **di cloud**
(web R-Net di Vercel, backend + mesin alarm di Coolify, database Supabase,
arsip Google Drive) tidak ada di sini — itu sudah berjalan sendiri.

## 5 tombol, 1 file kredensial

| File | Fungsi |
|---|---|
| `install.bat` | Pasang paket (menu: **stream / mirror / data / semua**). 1× jalan. |
| `start.bat`   | Nyalakan layanan (menu paket, atau `start.bat stream data`). |
| `stop.bat`    | Matikan layanan (menu paket, atau `stop.bat semua`). |
| `kredensial.bat` | **Perbaiki isian yang salah ketik** — token, hostname, DATABASE_URL, password MediaMTX/VNC. Tidak memasang apa pun. |
| `uninstall.bat` | Copot dari PC ini (opsional hapus kredensial). |
| `config.env`  | **SATU** file berisi semua kredensial PC ini (dibuat installer; git-ignored). |

> **Kenapa `kredensial.bat` terpisah dari `install.bat`?** Installer sengaja
> **tidak** menanyakan ulang nilai yang sudah terisi, supaya aman dijalankan
> berkali-kali (tambah paket, update komponen) tanpa menghapus password yang
> sedang bekerja. Konsekuensinya salah ketik tidak bisa dibetulkan dari sana —
> itu tugas tombol ini.

Tiap `.bat` cuma satu baris pemanggil `.ps1`-nya — langkah nyata ada di `.ps1`
(bisa dibaca). Fungsi bersama: `lib/common.ps1`.

## 3 paket

| Paket | Isi | Untuk |
|---|---|---|
| **stream** | OBS + MediaMTX + Cloudflare Tunnel | Siaran layar/HMI/kamera ke tab Monitor |
| **mirror** | TightVNC + websocat (+ tunnel yang sama) | Spion layar PC ini (channel "VNC (Layar PC)") |
| **data**   | Node-RED + bridge (Python) | Data sensor dari V-Box/PLC ke panel R-Net |

## Lokal vs cloud

```
PC SITE (folder ini)                          CLOUD (sudah jalan)
────────────────────                          ───────────────────
OBS ─┐                                         Vercel   : web R-Net
     ├─ MediaMTX ─┐                            Coolify  : backend API + alarm 24/7
TightVNC+websocat ┼─ Cloudflare Tunnel ──────► Supabase : database + realtime
Node-RED ─ bridge ───────────────────────────► VPS      : broker MQTT (Mosquitto)
                                               Google Drive : arsip bulanan
```

## Jalur DATA — 1 broker di VPS, 2 topik (BUKAN 2 broker)

Kebingungan umum: "perlu 2 broker?" **Tidak.** Satu broker = satu kantor pos;
yang membedakan surat adalah **topik**, bukan brokernya.

Brokernya ada **di VPS**, bukan di PC site — supaya V-Box di lokasi mana pun
bisa publish ke sana, dan jarak bukan lagi masalah.

```
V-Box ──publish topik  vbox/...   ─┐
                                    ├─►  Mosquitto di VPS (port 1883)
Node-RED ─subscribe vbox/... , olah/kalibrasi,
          ─publish topik  rnet/<site>/<device>/<metric> ─┘
                                                 │
Bridge ─subscribe rnet/...  ──►  database Supabase  ──►  panel R-Net
```

- **Broker (Mosquitto di VPS)** = papan pengumuman di RAM: pesan lewat lalu
  hilang, tidak kenal database. Tidak dipasang oleh `install.bat`.
- **Bridge** = kurir: berlangganan topik `rnet/...`, menuliskan angkanya ke
  database cloud (aturan ring 100 / interval simpan ada di bridge).
  Tanpa bridge, data mentok di broker dan panel R-Net kosong.
- Node-RED **opsional** — kalau V-Box sudah bisa publish langsung ke topik
  `rnet/...`, bridge saja cukup. Node-RED dipakai saat perlu olah/gabung/
  kalibrasi data dulu (mis. sumber Modbus/PLC).

Broker VPS didaftarkan di **R-Net > Data > Kelola Site** (host/port/akun broker
VPS) supaya bridge tahu harus dengar ke mana. Node-RED juga diarahkan ke sana,
bukan ke `localhost`.

## Tunnel

Stream & mirror keluar lewat **named tunnel Cloudflare** — satu tunnel per PC,
melayani kedua hostname sekaligus. Isi `TUNNEL_TOKEN` + `STREAM_HOSTNAME` /
`MIRROR_HOSTNAME` di `config.env` (ditanyakan `install.bat`). Alamatnya
**permanen**: diisi sekali di R-Net > Kelola Screen, tidak berubah tiap start.
Cara membuatnya: [`docs/PANDUAN-TUNNEL.md`](docs/PANDUAN-TUNNEL.md).

PC lapangan **tidak pernah menulis ke database R-Net** — tidak ada service key
Supabase yang disimpan di sini. Langkah terakhir (mengisi alamat di Kelola
Screen) memang manual, dan `start.bat` mencetak alamat lengkapnya tiap kali
dijalankan supaya tinggal disalin.

## Panduan

- [`docs/PANDUAN-RNET.md`](docs/PANDUAN-RNET.md) — panduan operator lengkap (awam).
- [`docs/PANDUAN-TUNNEL.md`](docs/PANDUAN-TUNNEL.md) — buat named tunnel (produksi).
- [`docs/PANDUAN-NODE-RED.md`](docs/PANDUAN-NODE-RED.md) — alur data Node-RED.

## Arsip

`_arsip/` = bahan yang tidak ikut dipasang di PC site:

- `_arsip/mosquitto-lokal/` — broker Mosquitto versi PC-lokal (config, passwd,
  `Pengaturan MQTT.bat`). **Sudah tidak dipakai**: brokernya pindah ke VPS.
  Disimpan sebagai rujukan saja.
- `_arsip/vps/`, `setup-vps.sh`, `*.service` — bahan sisi VPS/Linux.
- `_arsip/bridge-Dockerfile` — untuk menjalankan bridge di server Linux.
