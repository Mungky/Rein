# ROADMAP R-NET — "NVR untuk Segalanya"

> Dinding monitor fleksibel ala aplikasi CCTV, tapi sel-selnya bukan cuma
> kamera: **HMI Wecon, kamera, grafik, tabel, alarm, halaman web** — diatur
> per halaman, target **±137 layar** bertahap. Penonton: ruang monitor head
> office (24/7), laptop staf, HP bos, dan klien terbatas. HMI = lihat-saja
> (kontrol tetap di V-Net).

## Keputusan arsitektur (SSOT — jangan dilanggar tanpa alasan kuat)

| Jenis sumber | Jalur | Kenapa |
|---|---|---|
| HMI Wecon (web) | **Panel Web-Embed (iframe)** — tanpa OBS/MediaMTX | Tajam, real-time, nol infra. Syarat: V-Net lolos tes iframe |
| Kamera CCTV/RTSP | RTSP → **MediaMTX langsung** (tanpa OBS) → panel Video | OBS tidak perlu; MediaMTX menelan RTSP native |
| Gabungan banyak kamera | OBS mosaic → 1 stream → **Video Wall** (crop channel) | 1 decode utk N kotak; hemat bandwidth penonton |
| Data sensor/PLC | MQTT → bridge → historian → panel Grafik/Tabel/Gauge/Bar/Alarm | Pengganti data historian Wecon yang jelek |

**Aturan skala (penting):** 1 halaman = maksimal ±9–16 sel "hidup"
(video/iframe). 137 layar = banyak halaman + auto-rotate, BUKAN 137 sel
sekaligus — tidak ada browser/TV yang sanggup, di produk komersial mana pun.

## Checklist

### Fase 0 — Fondasi ✅ (selesai)
- [x] DB pooler 6543 + prepared-statement fix; RLS 32 tabel; session-expiry fix
- [x] Layout default admin (publish/injeksi read-only)
- [x] MQTT historian + scaling + panel data + export Excel + alarm
- [x] Video Wall (mosaic→channel, crop canvas) + edit in-place + fit Penuh/Utuh
- [x] Halaman (pages) + dropdown kiri + fullscreen flipper + auto-rotate
- [x] Panel Aktivitas (presence), panel Web-Embed (iframe), ping ms badge
- [x] Fix multi-sumber streaming (STREAM_NAME per mesin, install.ps1 ikut tanya)

### Fase 0.5 — Restrukturisasi Channel ✅ (2026-07-10)
- [x] R-Net = 3 tab: **Monitor | Channel | Data**
- [x] Tabel `scada_channels`: nomor unik + nickname + 1 sumber
      (video[+kotak mosaic] / web / grafik / tabel / angka / bar / alarm / aktivitas)
- [x] Tambah Panel = pilih channel dari daftar (bukan jenis panel);
      layout lama tetap jalan (kompatibel)
- [x] Maximize per-channel (tombol di bar judul / hover saat fullscreen; Esc)
- [x] Web-embed: kontrol Geser Kiri/Atas (px) — buang navbar HMI tanpa fullscreen

### Fase 0.6 — Kanvas Tetap ala OBS ✅ (2026-07-10)
- [x] Layout v2: kanvas resolusi tetap per halaman (default 1920×1080;
      1280/2560/4K) + rect piksel per panel → zoom/device apa pun TIDAK reflow
- [x] Editor OBS-style: drag bebas + snap (tepi/tengah/panel lain) + garis
      bantu + inspector X/Y/W/H + Susun Cepat (1, 2×2, 3×3, 4×4, 1+2)
- [x] Channel web punya resolusi native (mis. 1920×1080) — fullscreen milik
      situs hanya mengisi panelnya (OBS-style), + interact toggle (default
      click-through) + reload per panel
- [x] **Keep-alive iframe**: pindah page TIDAK reload web embed → tampilan
      V-Net tidak menduplikat (alasan terakhir pakai OBS — tumbang)
- [x] Layar Maintenance/Standby (RePhot orbit) utk channel kosong / error
      (+ penyebab error); video connecting/error pakai layar yang sama
- [x] install.ps1: + Mosquitto opsional (akun, conf, port 1883) — satu saklar
      start/stop-scada utk stream + tunnel + MQTT; STREAM_NAME ditanya

### Fase 1 — Validasi sumber (SEKARANG — butuh tes lapangan user)
- [ ] Tes 2 stream dari 2 mesin (STREAM_NAME diisi beda) — tidak saling timpa
- [ ] **Tes iframe V-Net Wecon** di panel Web-Embed → menentukan arah HMI!
  - [ ] Lolos → HMI pakai web-embed; OBS hanya untuk kamera/mosaic
  - [ ] Gagal (kosong/X-Frame-Options) → HMI tetap via OBS; fokus ke crop-lines
- [ ] Tes kamera RTSP langsung ke MediaMTX (tanpa OBS)
- [ ] Tes 1 halaman berisi 9 sel hidup di PC ruang monitor — ukur CPU/RAM

### Fase 2 — Audit besar (performa + keamanan + codebase + UI)
- [ ] Ukur & dokumentasikan batas nyata: maks sel hidup per halaman, maks user
- [ ] Security sweep: kredensial stream di API (read_pass terlihat semua user
      scada:view — perlu dipersempit?), rate-limit, header, RLS ulang, repo→private
- [ ] Codebase: rapikan duplikasi, komponen dropdown seragam (keluhan "AI generik")
- [ ] UI polish menyeluruh (dropdown custom, empty-state, dark mode konsisten)
- [ ] Laporan bahasa awam: apa yang aman, apa batasnya, apa risikonya

### Fase 3 — Infrastruktur streaming serius (untuk 137 layar)
- [ ] MediaMTX pusat di VPS/server (bukan laptop) + domain tetap
      (named tunnel / reverse proxy — URL tidak ganti tiap restart)
- [ ] Auth per stream rapi; per-site publisher
- [ ] Evaluasi WebRTC (latensi <1 dtk) vs LL-HLS utk ruang kontrol
- [ ] Draggable crop-lines mosaic (kalibrasi geser garis di Kelola Stream)

### Fase 4 — Data & alarm matang
- [ ] Bridge MQTT jalan sebagai service di server + tes V-Box asli
- [ ] Notifikasi alarm (bunyi di ruang monitor; nanti WA/telegram?)
- [ ] Retensi & downsampling historian (data tahunan tetap ringan)

### Fase 5 — Produk & akses luar
- [ ] Akses klien terbatas (role viewer per-halaman?)
- [ ] Tampilan mobile khusus (HP bos): halaman ringkas, hemat kuota
- [ ] Template halaman & duplikasi cepat utk site baru

---
*Update file ini tiap fitur selesai. Prinsip: satu fase tuntas & teruji
di lapangan sebelum lanjut; fitur baru harus jelas masuk fase mana.*
