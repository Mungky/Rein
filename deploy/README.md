# deploy/ — R-Net di PC lokal (compact)

Semua yang jalan **di PC pabrik/site** ada di folder ini. Yang jalan **di cloud**
(web R-Net di Vercel, backend + mesin alarm di Coolify, database Supabase,
arsip Google Drive) tidak ada di sini — itu sudah berjalan sendiri.

## 4 tombol, 1 file kredensial

| File | Fungsi |
|---|---|
| `install.bat` | Pasang paket (menu: **stream / mirror / data / semua**). 1× jalan. |
| `start.bat`   | Nyalakan layanan (menu paket, atau `start.bat stream data`). |
| `stop.bat`    | Matikan layanan (menu paket, atau `stop.bat semua`). |
| `uninstall.bat` | Copot dari PC ini (opsional hapus kredensial). |
| `config.env`  | **SATU** file berisi semua kredensial PC ini (dibuat installer; git-ignored). |

Tiap `.bat` cuma satu baris pemanggil `.ps1`-nya — langkah nyata ada di `.ps1`
(bisa dibaca). Fungsi bersama: `lib/common.ps1`.

## 3 paket

| Paket | Isi | Untuk |
|---|---|---|
| **stream** | OBS + MediaMTX + Cloudflare Tunnel | Siaran layar/HMI/kamera ke tab Monitor |
| **mirror** | TightVNC + websocat (+ tunnel yang sama) | Spion layar PC ini (channel "VNC (Layar PC)") |
| **data**   | Mosquitto + Node-RED + bridge (Python) | Data sensor dari V-Box/PLC ke panel R-Net |

## Lokal vs cloud

```
PC SITE (folder ini)                          CLOUD (sudah jalan)
────────────────────                          ───────────────────
OBS ─┐                                         Vercel   : web R-Net
     ├─ MediaMTX ─┐                            Coolify  : backend API + alarm 24/7
TightVNC+websocat ┼─ Cloudflare Tunnel ──────► Supabase : database + realtime
Mosquitto ─ Node-RED ─ bridge ───────────────► Google Drive : arsip bulanan
```

## Jalur DATA — 1 broker, 2 topik (BUKAN 2 broker)

Kebingungan umum: "perlu 2 broker?" **Tidak.** Satu Mosquitto = satu kantor pos;
yang membedakan surat adalah **topik**, bukan brokernya.

```
V-Box ──publish topik  vbox/...   ─┐
                                    ├─►  Mosquitto (1 broker, port 1883)
Node-RED ─subscribe vbox/... , olah/kalibrasi,
          ─publish topik  rnet/<site>/<device>/<metric> ─┘
                                                 │
Bridge ─subscribe rnet/...  ──►  database Supabase  ──►  panel R-Net
```

- **Broker (Mosquitto)** = papan pengumuman di RAM: pesan lewat lalu hilang,
  tidak kenal database.
- **Bridge** = kurir: berlangganan topik `rnet/...`, menuliskan angkanya ke
  database cloud (aturan ring 100 / interval simpan ada di bridge).
  Tanpa bridge, data mentok di broker dan panel R-Net kosong.
- Node-RED **opsional** — kalau V-Box sudah bisa publish langsung ke topik
  `rnet/...`, bridge saja cukup. Node-RED dipakai saat perlu olah/gabung/
  kalibrasi data dulu (mis. sumber Modbus/PLC).

Broker ini didaftarkan di **R-Net > Data > Kelola Site** (host = IP PC ini,
port 1883, akun MQTT dari installer) supaya bridge tahu harus dengar ke mana.

## Tunnel: produksi vs tes

- **Produksi** — isi `TUNNEL_TOKEN` di `config.env` (named tunnel, domain
  sendiri). Alamat stream/mirror **permanen**: diisi sekali di Kelola Screen,
  tidak berubah tiap start. Cara buat: [`docs/PANDUAN-TUNNEL.md`](docs/PANDUAN-TUNNEL.md).
- **Tes** — `TUNNEL_TOKEN` kosong → Quick Tunnel (URL acak tiap start). Isi
  `SUPABASE_URL`/`SUPABASE_SERVICE_KEY` supaya alamat baru ditulis otomatis ke
  R-Net. Hanya untuk coba-coba.

## Panduan

- [`docs/PANDUAN-RNET.md`](docs/PANDUAN-RNET.md) — panduan operator lengkap (awam).
- [`docs/PANDUAN-TUNNEL.md`](docs/PANDUAN-TUNNEL.md) — buat named tunnel (produksi).
- [`docs/PANDUAN-NODE-RED.md`](docs/PANDUAN-NODE-RED.md) — alur data Node-RED.

## Arsip

`_arsip/` = relay VPS + unit systemd Linux + installer lama. **VPS dilupakan
dulu** (dipakai lagi kalau site sudah pakai LAN/kabel, bukan WiFi). Bahan bridge
Docker (`_arsip/bridge-Dockerfile`, `_arsip/rnet-mqtt-bridge.service`) untuk
menjalankan bridge di server Linux — bukan di PC site.
