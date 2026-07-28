# Arsip flow Node-RED — titik pulang

Isi folder ini **bukan** untuk diedit. Ini rekaman apa adanya dari Node-RED
yang sedang jalan di lapangan, disimpan sebelum flow-nya diganti.

Kalau flow baru bermasalah dan Anda perlu kembali seperti semula:

> Node-RED (`http://127.0.0.1:1880`) → menu **☰** → **Import** →
> pilih file di folder ini → **Import** → **Deploy**.
>
> Lalu **isi ulang username & password broker** (dobel-klik kotak mqtt ungu →
> ikon pensil → tab Security). Node-RED sengaja tidak ikut mengekspor
> password, jadi file ini tidak pernah berisi rahasia — tapi artinya
> password harus diketik ulang tiap kali impor.

---

## `2026-07-27-produksi-lombok-SEBELUM.json`

Diekspor 27 Juli 2026 dari Node-RED PC lapangan Lombok, sebelum perombakan
flow generik.

    sha256  b7c2b274aa39ef8109b0633a6ff592cb582f14e6601e447f57b851823861ac53
    node    36

### Isinya

Satu tab bernama **GBS**, berisi 2 gateway V-Box → 14 sensor:

    fikri/vnet/lombok1  ─┬─► 7 kotak function ─► 7 topik rnet/lombok/line1/*
    fikri/vnet/lombok2  ─┴─► 7 kotak function ─► 7 topik rnet/lombok/line2/*

Tiap sensor memakai dua kotak yang diketik manual: satu menyebut nama field
(`msg.payload.data.waterlevel1`), satu menyebut topik tujuannya.

### Peta lengkap field → sensor

Diverifikasi terhadap `scada_tags` di database pada tanggal ekspor.
**14 topik yang dikirim flow = 14 tag di database**, tanpa sisa di kedua sisi.

| Gateway | Field | Topik R-Net | Sensor | Line |
|---|---|---|---|---|
| `fikri/vnet/lombok1` | `waterlevel1`  | `rnet/lombok/line1/level1`  | Premix   | Line 1 |
| `fikri/vnet/lombok1` | `waterlevel2`  | `rnet/lombok/line1/level2`  | Mixing   | Line 1 |
| `fikri/vnet/lombok1` | `waterlevel3`  | `rnet/lombok/line1/level3`  | Holding  | Line 1 |
| `fikri/vnet/lombok1` | `waterlevel4`  | `rnet/lombok/line1/level4`  | Balance  | Line 1 |
| `fikri/vnet/lombok1` | `temperature1` | `rnet/lombok/line1/heating` | Heating  | Line 1 |
| `fikri/vnet/lombok1` | `temperature2` | `rnet/lombok/line1/holding` | Holding  | Line 1 |
| `fikri/vnet/lombok1` | `temperature3` | `rnet/lombok/line1/cooling` | Cooling  | Line 1 |
| `fikri/vnet/lombok2` | `waterlevel1`  | `rnet/lombok/line2/level1`  | Premix   | Line 2 |
| `fikri/vnet/lombok2` | `waterlevel2`  | `rnet/lombok/line2/level2`  | Mixing   | Line 2 |
| `fikri/vnet/lombok2` | `waterlevel3`  | `rnet/lombok/line2/level3`  | Holding  | Line 2 |
| `fikri/vnet/lombok2` | `waterlevel4`  | `rnet/lombok/line2/level4`  | Balance  | Line 2 |
| `fikri/vnet/lombok2` | `temperature1` | `rnet/lombok/line2/tt01`    | 1TT01    | Line 2 |
| `fikri/vnet/lombok2` | `temperature2` | `rnet/lombok/line2/tt02`    | 1TT02    | Line 2 |
| `fikri/vnet/lombok2` | `temperature3` | `rnet/lombok/line2/tt03`    | 1TT03    | Line 2 |

> Perhatikan Line 2: kotaknya masih bernama `heating`/`holding`/`cooling`
> (disalin dari Line 1) tetapi mengirim ke `tt01`/`tt02`/`tt03`. Nama kotak
> dan tujuannya tidak nyambung. Tidak merusak apa pun — tapi ini persis jenis
> kesalahan yang muncul kalau pemetaan disalin-tempel dengan tangan, dan
> alasan pemetaannya dipindah ke R-Net.

### Koneksi broker yang dipakai flow ini

    host   mqtt.remula-inti.com
    port   8883  (TLS menyala)
    verifikasi sertifikat: TIDAK menyala

Sertifikat asli broker diterbitkan untuk `mqtt.remula.online` saja.
`mqtt.remula-inti.com` menunjuk ke server yang sama (76.13.22.142) tetapi
**tidak tercantum di sertifikat** — sambungan ini hanya berhasil karena
verifikasi sertifikat dimatikan. Diperbaiki di flow baru.

### Catatan lain tentang kondisi ini

- Tab produksi bernama "GBS" tetapi **teks keterangannya masih milik pabrik
  simulasi** — menyebut boiler dan tangki yang tidak ada di sini.
- Kotak `debug 1` menyala dan menerima 6 dari 7 sensor Line 1 tanpa henti.
  `debug 2` (Line 2) mati. Tidak konsisten, dan tidak ada yang membacanya.
- Sensor `waterlevel4` tidak tersambung ke debug, sedangkan 6 lainnya iya.
