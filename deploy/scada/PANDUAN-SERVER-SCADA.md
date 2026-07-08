# Panduan Setup Server SCADA Monitor

> Dokumen ini untuk **siapa pun yang bisa klik mouse** — tidak perlu ngerti coding.
> Tujuannya: PC server yang selama ini menjalankan OBS bisa **menyiarkan tampilan SCADA ke REIN**, sehingga bisa ditonton dari mana saja (laptop, HP, luar kota) tanpa mengatur ulang OBS lagi.

---

## 1. Gambaran Besar — Seperti Stasiun TV Mini

```
┌───────────┐   ┌────────────┐   ┌──────────────┐   ┌──────────────┐
│  OBS      │──▶│  MediaMTX  │──▶│  Cloudflare  │──▶│ REIN di      │
│ (kamera-  │   │ (pemancar) │   │  Tunnel      │   │ browser mana │
│  nya)     │   │            │   │ (kabel aman) │   │ pun (TV-nya) │
└───────────┘   └────────────┘   └──────────────┘   └──────────────┘
     PC server ————————————————┘        internet
```

| Komponen | Fungsi | Analogi |
|---|---|---|
| **OBS** | Menggabungkan semua layar V-Net SCADA jadi satu tampilan | Kamera studio |
| **MediaMTX** | Menerima video dari OBS, menyiarkannya dalam format web (HLS) | Pemancar TV |
| **Cloudflare Tunnel** | Mengirim siaran keluar dengan aman, **tanpa buka port di router** | Kabel bawah tanah yang terkunci |
| **REIN (halaman SCADA Monitor)** | Menampilkan siaran + panel lain | TV di rumah penonton |

Semua komponen **hidup sendiri saat PC dinyalakan** dan **restart sendiri kalau macet**. Setelah setup sekali, tidak ada yang perlu diutak-atik lagi.

---

## 2. Yang Perlu Di-download (sekali saja)

Buat folder `C:\rein-scada\` lalu isi seperti ini:

| Software | Download dari | Taruh di |
|---|---|---|
| MediaMTX (versi 1.9 ke atas) | github.com/bluenviron/mediamtx/releases (pilih `windows_amd64.zip`) | `C:\rein-scada\mediamtx\` |
| cloudflared | github.com/cloudflare/cloudflared/releases (pilih `windows-amd64.exe`, rename jadi `cloudflared.exe`) | `C:\rein-scada\cloudflared\` |
| NSSM | nssm.cc/download | `C:\rein-scada\nssm\` (ambil `nssm.exe` dari folder `win64`) |
| OBS Studio | obsproject.com (kalau belum terpasang) | lokasi default |

Salin juga 2 file dari repo ini (folder `deploy/scada/`):

- `mediamtx.yml` → ke `C:\rein-scada\mediamtx\` — **buka dengan Notepad, ganti semua tulisan `GANTI_...`** (password bebas, yang penting panjang & dicatat)
- `install-services.ps1` → ke mana saja, misal `C:\rein-scada\`

---

## 3. Setup Cloudflare Tunnel (sekali saja, butuh akun Cloudflare)

Buka **Command Prompt** lalu jalankan satu per satu:

```
cd C:\rein-scada\cloudflared
cloudflared tunnel login
cloudflared tunnel create rein-scada
cloudflared tunnel route dns rein-scada scada-stream.NAMADOMAIN.com
```

- Perintah pertama membuka browser → login akun Cloudflare → pilih domain.
- Perintah kedua mencetak **Tunnel ID** (deretan huruf-angka) — catat.
- Salin `cloudflared-config.yml` dari repo ke `C:\Users\NAMAUSER\.cloudflared\config.yml`, lalu ganti `GANTI_USER`, `GANTI_TUNNEL_ID`, dan `GANTI_DOMAIN` di dalamnya.

---

## 4. Setting OBS (sekali saja)

Buka OBS → **Settings**:

**Stream:**
| Kolom | Isi |
|---|---|
| Service | Custom |
| Server | `rtmp://127.0.0.1:1935` |
| Stream Key | `scada?user=obs&pass=PASSWORD_PUBLISH_ANDA` |

(PASSWORD_PUBLISH_ANDA = yang tadi diisi di `mediamtx.yml` bagian user `obs`.)

Pilih **Output → Output Mode: Advanced → tab Streaming**. Setelan di bawah dibuat
untuk **delay serendah mungkin** (bukan kualitas maksimal). Dua baris ber-tanda 🔑
adalah yang paling sering kelewat dan jadi biang delay 6–10 detik.

**Kalau pakai x264 (CPU):**
| Kolom | Isi |
|---|---|
| Encoder | x264 |
| Rate Control | CBR |
| Bitrate | 4000–6000 Kbps (1080p) · 2500–4000 (720p) — sesuaikan upload internet |
| Keyframe Interval | **1 s** 🔑 ← WAJIB, jangan 0/auto (harus = `hlsSegmentDuration` di mediamtx.yml) |
| CPU Usage Preset | veryfast |
| Profile | main |
| Tune | **zerolatency** 🔑 ← ini yang memangkas delay paling banyak |
| x264 Options (kolom teks paling bawah) | `bframes=0` 🔑 |

**Kalau pakai NVENC (GPU NVIDIA — lebih ringan, disarankan bila ada):**
| Kolom | Isi |
|---|---|
| Encoder | NVIDIA NVENC H.264 |
| Rate Control | CBR |
| Bitrate | sama seperti di atas |
| Keyframe Interval | **1 s** 🔑 |
| Preset | P1 (Fastest) |
| Tuning | **Ultra Low Latency** 🔑 |
| Multipass Mode | Disabled |
| Profile | main |
| Look-ahead | **OFF** 🔑 |
| Psycho Visual Tuning | **OFF** 🔑 |
| Max B-frames | **0** 🔑 |

> ⚠️ **Kenapa B-frames & Look-ahead harus mati:** keduanya membuat encoder
> "menunggu beberapa frame ke depan" sebelum mengirim — itu menambah 2–4 detik
> delay sendiri. Mematikannya (`bframes=0` / Max B-frames 0 + tune zerolatency /
> Ultra Low Latency) adalah cara terbesar menurunkan delay, jauh lebih besar
> daripada mengutak-atik mediamtx.yml.
>
> ⚠️ **Keyframe Interval harus tepat 1 detik.** Kalau 0/auto, MediaMTX tak bisa
> memotong segmen tiap 1 detik → delay membengkak & video patah-patah.

**(Opsional) Settings → Advanced → Network:** centang **"Enable new networking code"**
dan (kalau ada) **"Low latency mode"**.

---

## 5. Pasang Semua Jadi Otomatis (sekali saja)

1. Klik kanan **PowerShell** → *Run as Administrator*
2. Jalankan:
   ```
   powershell -ExecutionPolicy Bypass -File C:\rein-scada\install-services.ps1
   ```
3. Script akan memasang MediaMTX & cloudflared sebagai *service* (hidup otomatis, restart sendiri) dan OBS sebagai *task* yang jalan + langsung streaming setiap PC logon.
4. **Aktifkan auto-logon Windows**: tekan `Win+R` → ketik `netplwiz` → hilangkan centang "Users must enter a user name and password" → OK → isi password. (Supaya setelah mati listrik, PC nyala → login sendiri → OBS jalan sendiri.)

---

## 6. Daftarkan Stream di REIN (sekali saja)

1. Login REIN sebagai admin → buka **SCADA Monitor**
2. Klik **Kelola Stream** → **Tambah Stream**:

| Kolom | Isi |
|---|---|
| Nama | SCADA Utama (bebas) |
| URL HLS | `https://scada-stream.NAMADOMAIN.com/scada/index.m3u8` |
| User (read) | `rein-viewer` |
| Password (read) | password viewer dari `mediamtx.yml` |

3. Buka halaman SCADA Monitor → video muncul. Selesai. 🎉

---

## 7. Checklist "Cabut-Colok" — WAJIB Diuji Sekali

Ini janji utama sistemnya: **pulih sendiri tanpa disentuh.**

| # | Uji | Hasil yang benar |
|---|---|---|
| 1 | Restart PC server, jangan sentuh apa pun | 2-3 menit kemudian video muncul lagi di REIN |
| 2 | Tutup paksa OBS (Task Manager → End Task) | REIN menampilkan "Stream terputus — menyambung ulang…"; setelah OBS dibuka lagi (atau logon ulang), video kembali sendiri |
| 3 | Buka `https://scada-stream.NAMADOMAIN.com/scada/index.m3u8` di browser biasa (tanpa password) | **Gagal / error** — artinya orang luar tidak bisa nonton |

---

## 8. Kalau Ada Masalah

| Gejala | Kemungkinan penyebab | Cara cek |
|---|---|---|
| Video hitam / "Stream terputus" terus | OBS tidak streaming | Buka OBS di PC server → tombol "Stop Streaming" harus terlihat (artinya sedang siaran). Kalau tertulis "Start Streaming", klik itu. |
| "Menghubungkan…" tidak selesai-selesai | cloudflared mati | PowerShell: `Get-Service rein-cloudflared` → harus `Running`. Kalau tidak: `Restart-Service rein-cloudflared` |
| Video muncul tapi patah-patah | Keyframe Interval bukan 1 s, atau bitrate kegedean | Cek Settings OBS bagian 4 di atas |
| Semua service jalan tapi tetap tidak ada video | MediaMTX mati / config salah | `Get-Service rein-mediamtx` → harus `Running`. Log: `C:\rein-scada\mediamtx\` |
| Setelah mati listrik tidak pulih sendiri | Auto-logon Windows belum aktif | Ulangi langkah 5 nomor 4 (`netplwiz`) |
| **Delay 6–10 detik (padahal target ~3 detik)** | B-frames/Look-ahead di OBS masih nyala, atau memang batas Cloudflare Tunnel | Terapkan setelan encoder low-latency di bagian 4 (tune zerolatency / Ultra Low Latency, B-frames 0). Lihat cara pisahkan penyebabnya di bawah. |

### Cara tahu delay-nya dari OBS atau dari internet (Cloudflare)

Delay total = **delay OBS/encoder** + **delay Cloudflare Tunnel**. Untuk tahu
yang mana biang keroknya, bandingkan di **PC server itu sendiri**:

1. Di PC server, buka `http://127.0.0.1:8888/scada/index.m3u8` lewat pemutar HLS
   lokal (mis. VLC → Open Network Stream), atau lihat langsung di REIN dari PC
   server. Ini **melewati Cloudflare** — murni OBS + MediaMTX.
2. Bandingkan delay-nya dengan yang terlihat saat dibuka dari **laptop lain via
   domain** (lewat Cloudflare).

- Kalau **di PC server pun sudah 6–10 detik** → biangnya **OBS** (B-frames/
  Look-ahead belum dimatikan). Perbaiki di bagian 4 → delay turun drastis.
- Kalau **di PC server ~1–3 detik tapi via domain 6–10 detik** → tambahan
  delay-nya dari **Cloudflare Tunnel** yang menahan potongan video LL-HLS.
  Ini **batas bawaan tunnel gratis**, tak bisa ditekan lewat config. Pilihan:
  terima ~4–6 detik (normal untuk HLS), atau pertimbangkan WebRTC nanti (butuh
  infrastruktur terpisah — sudah masuk rencana, dikerjakan setelah pondasi beres).

Kalau semua di atas buntu: **restart PC server** — semua komponen dirancang untuk bangun sendiri.
