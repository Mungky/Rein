# Tutorial Tes Lokal SCADA Monitor — Dari Nol Sampai Video Muncul

> Panduan langkah demi langkah untuk **mencoba SCADA Monitor di PC development**,
> tanpa Cloudflare Tunnel, tanpa server. Semua berjalan di satu PC.
> (Untuk setup server produksi, lihat `PANDUAN-SERVER-SCADA.md`.)

**Catatan penting sebelum mulai:** yang perlu di-install hanya **MediaMTX** (satu
file .exe, tanpa installer). "HLS" bukan software — itu format video yang otomatis
dihasilkan MediaMTX, dan pemutarnya (hls.js) sudah tertanam di REIN.

---

## Bagian A — Install MediaMTX (sekali saja, ±3 menit)

> ✅ **Di PC development ini semua langkah Bagian A SUDAH DIKERJAKAN** —
> MediaMTX v1.19.2 terpasang di `C:\rein-scada\mediamtx\` lengkap dengan config
> tes lokal. Langsung lompat ke Bagian B. Langkah di bawah dicatat untuk PC lain.

1. Buka https://github.com/bluenviron/mediamtx/releases → unduh file
   `mediamtx_vX.X.X_windows_amd64.zip`
2. Buat folder `C:\rein-scada\mediamtx\`, ekstrak isi zip ke sana
   (isinya cuma `mediamtx.exe` + `mediamtx.yml`)
3. Ganti `mediamtx.yml` bawaan dengan config tes lokal (contoh yang dipakai di
   PC ini):

```yaml
logLevel: info

rtsp: no
webrtc: no
srt: no
moq: no
api: no
metrics: no
pprof: no
playback: no

rtmp: yes
rtmpAddress: 127.0.0.1:1935

hls: yes
hlsAddress: 127.0.0.1:8888
hlsVariant: lowLatency
hlsSegmentDuration: 1s
hlsPartDuration: 200ms
hlsSegmentCount: 7
hlsAllowOrigins: ["http://localhost:3000"]

authMethod: internal
authInternalUsers:
  - user: obs
    pass: obs-lokal-123
    ips: ["127.0.0.1", "::1"]
    permissions:
      - action: publish
        path: scada
  - user: rein-viewer
    pass: rein-lokal-123
    permissions:
      - action: read
        path: scada

paths:
  scada:
    source: publisher
```

---

## Bagian B — Nyalakan MediaMTX

Dobel-klik `C:\rein-scada\mediamtx\mediamtx.exe` (atau jalankan dari terminal).
Jendela hitam muncul dengan tulisan seperti:

```
INF [RTMP] started with listener on 127.0.0.1:1935
INF [HLS] started with listener on 127.0.0.1:8888
```

Biarkan jendela itu terbuka — itu "pemancarnya". Tutup jendela = siaran mati.

---

## Bagian C — Kirim Video ke MediaMTX

**Pilihan 1 — OBS (cara yang sama dengan produksi):**

Buka OBS → Settings → **Stream**:

| Kolom | Isi persis |
|---|---|
| Service | Custom |
| Server | `rtmp://127.0.0.1:1935` |
| Stream Key | `scada?user=obs&pass=obs-lokal-123` |

Settings → **Output** (Mode: Advanced) → tab Streaming:

| Kolom | Isi |
|---|---|
| Encoder | x264 |
| Rate Control | CBR, Bitrate 4000 Kbps |
| Keyframe Interval | **1 s** ← paling sering kelewat, wajib 1 |

Klik **Start Streaming**. Di jendela MediaMTX akan muncul
`stream is available and online`.

**Pilihan 2 — ffmpeg (video tes color bars, tanpa OBS):**

```
ffmpeg -re -f lavfi -i testsrc2=size=1280x720:rate=30 -c:v libx264 -preset veryfast -tune zerolatency -g 30 -b:v 2000k -an -f flv "rtmp://127.0.0.1:1935/scada?user=obs&pass=obs-lokal-123"
```

(ffmpeg juga sudah terpasang di PC ini via winget.)

---

## Bagian D — Daftarkan Stream di REIN

1. Jalankan REIN (`bun run dev`), login sebagai **admin**
2. Buka menu **SCADA Monitor** → klik **Kelola Stream** → **Tambah Stream**:

| Kolom | Isi persis (untuk tes lokal) |
|---|---|
| Nama | SCADA Lokal |
| URL HLS | `http://127.0.0.1:8888/scada/index.m3u8` |
| User (read) | `rein-viewer` |
| Password (read) | `rein-lokal-123` |
| Stream aktif | ✔ |

3. Klik **Simpan** → tutup dialog
4. Klik **Atur Layout** → **Tambah Panel** → pilih stream "SCADA Lokal" →
   **Tambah Panel** → **Simpan**
5. Video muncul dengan badge hijau **LANGSUNG**. Selesai. 🎉

> Kalau kamu buka `/scada` **sebelum** stream terdaftar, sistem otomatis
> membuatkan layout "Default" kosong. Tinggal Atur Layout → Tambah Panel
> setelah stream ada.

---

## Bagian E — Uji Janji "Pulih Sendiri"

| Uji | Cara | Hasil yang benar |
|---|---|---|
| Stream putus | Stop streaming di OBS (atau Ctrl+C ffmpeg) | Overlay "Stream terputus — menyambung ulang…" muncul ≤ 20 detik |
| Stream kembali | Start streaming lagi | Video kembali sendiri tanpa refresh browser |
| Keamanan | Buka `http://127.0.0.1:8888/scada/index.m3u8` langsung di tab browser | Ditolak (minta login) — tanpa password tidak bisa nonton |

---

## Troubleshooting Lokal

| Gejala | Penyebab umum | Solusi |
|---|---|---|
| "Menghubungkan…" terus | MediaMTX belum jalan | Nyalakan `mediamtx.exe` |
| "Stream terputus" terus | OBS/ffmpeg belum streaming | Cek jendela MediaMTX: harus ada `stream is available and online` |
| Video error hanya di browser (curl bisa) | CORS: URL frontend bukan `http://localhost:3000` | Samakan `hlsAllowOrigins` di `mediamtx.yml`, restart MediaMTX |
| Patah-patah / delay > 10 dtk | Keyframe Interval OBS bukan 1 s | Ubah ke 1 s, restart streaming |

**Catatan teknis (untuk developer):** MediaMTX modern (≥ v1.12) hanya menerima
kredensial pembacaan HLS lewat header `Authorization: Basic` — pemutar REIN
sudah mengirimkannya otomatis di setiap request. Query param `?user=&pass=`
hanya berlaku untuk publish RTMP (stream key OBS).
