# Modul 02 — R-Net (Cloud SCADA Remula)

Modul paling matang di repo. Menampilkan data sensor pabrik (MQTT dari V-Box /
Wecon) dan video stream di kanvas HMI yang bisa diatur per pengguna, dengan
alarm, riwayat, dan arsip bulanan ke Google Drive.

> Diagram alur data end-to-end (sensor → broker → bridge → Supabase → browser)
> ada di [`../ARSITEKTUR.md`](../ARSITEKTUR.md). Dokumen ini fokus ke pemetaan
> layer per fitur.

## Peta layer

| Fitur | Database | Backend | API Route | Frontend |
|---|---|---|---|---|
| Perspektif (layout HMI) | `scada_perspectives` | validasi skema `Panel` | `/perspectives*` | `scada-view.tsx`, `store.ts`, `grid/canvas-stage.tsx` |
| Panel & palet komponen | *(JSONB `layout`)* | `schemas/scada.py` (1125 baris) | — | `panels/*`, `component-palette.tsx`, `panel-inspector.tsx` |
| Sumber stream | `scada_streams` | `_validate_effective_source` | `/streams*` | `manage-streams-dialog.tsx`, `panels/video-panel.tsx` |
| Kanal layar | `scada_channels` | `validate_channel_config` | `/channels*` | `channels-view.tsx`, `channel-form.tsx` |
| Site MQTT | `scada_sites` | — | `/sites*` | `manage-sites-dialog.tsx` |
| Tag & sheet | `scada_tags`, `scada_sheets` | `rnet_settings.py` | `/tags*`, `/sheets*` | `analysis/analysis-view.tsx` |
| Nilai live | `scada_tag_latest` | bridge + `historian.latest_loop` | `/latest` + **Supabase Realtime** | `analysis/use-live-samples.ts`, `panels/use-tag-value.ts` |
| Riwayat & chart | `scada_ring`, `scada_samples` | bucketing SQL | `/history`, `/tags/{id}/recent`, `/samples` | `panels/chart-panel.tsx`, `analysis/riwayat-view.tsx` |
| Ringkasan & sparkline | idem | cache TTL + single-flight | `/summary`, `/sparklines` | `analysis/tag-sparkline.tsx`, `panels/summary-batch.ts` |
| Kolom formula | `scada_workbench_columns` | — | `/workbench/columns*` | `analysis/formula.ts`, `column-editor.tsx` |
| Alarm | `scada_alarm_events`, `scada_alarm_settings` | `alarm_engine.py`, `notifier.py` | `/alarms/*`, `/alarm-settings` | `alarm-bell.tsx`, `use-alarm-events.ts`, `panels/alarm-panel.tsx` |
| Arsip & reset siklus | `scada_tag_archives`, `scada_archives` | `archiver.py` | `/archives`, `/archives/run` | `analysis/export-range-dialog.tsx` |
| Ekspor Excel | — | — | `/tags/{id}/samples` | `analysis/export-excel.ts` |
| Kesehatan sistem | `scada_bridge_status` | `health_monitor.py` | *(tanpa endpoint)* | — |
| Pengaturan penyimpanan | `scada_settings` | `rnet_settings.py` | `/settings` | `features/admin/rnet-tab.tsx` |
| Jejak audit config | `scada_audit_log` | `scada_audit.py` | *(tanpa endpoint baca)* | — |
| Pemantau akses data | `scada_data_access_log` | `data_access_monitor.py` | *(tanpa endpoint baca)* | — |

Semua endpoint berprefiks `/api/scada`.

---

## Layer 1 — Database

### Konfigurasi

| Tabel | Isi | Catatan |
|---|---|---|
| `scada_sites` | Broker MQTT per site | `mqtt_password` **diredaksi** di API jadi `has_password: bool` |
| `scada_streams` | Sumber tampilan: `stream` (HLS/WebRTC), `web`, `vnc` | `read_pass` & `secret` **dikirim mentah** (K-4) |
| `scada_channels` | Kanal layar bernomor (`number` unik) | `config` JSONB, divalidasi per `kind` |
| `scada_sheets` | Lembar pengelompokan tag | `position` untuk urutan |
| `scada_tags` | Satu besaran terukur | `source` (`sim`/`mqtt`), `device_key`, `sheet_id`, `config` + `meta` JSONB |
| `scada_perspectives` | Layout HMI per pemilik | `layout` JSONB v2 (kanvas 1920×1080 + `panels[]`), `is_default`, `is_published` |
| `scada_workbench_columns` | Kolom formula bersama per sheet | `kind`, `formula`, `unit`, `decimals`, `position` |
| `scada_settings` | Satu baris | durasi 4 level sampling + retensi |
| `scada_alarm_settings` | Satu baris | email/telegram on-off, penerima, `cooldown_min`, `sound_enabled` |

**`scada_settings`** adalah sumber kebenaran untuk seluruh timing:

| Kolom | Arti |
|---|---|
| `level_fastest_s` / `level_fast_s` / `level_slow_s` / `level_slowest_s` | durasi 4 level sampling (default 2 / 5 / 30 / 60 detik) |
| `ring_window_h` | jendela ring buffer (default 24 jam) |
| `store_months` | panjang siklus historian sebelum reset (default 1 bulan) |
| `reset_warn_days` | berapa hari sebelum reset mulai memperingatkan |

### Data deret waktu — empat tabel, empat peran

Ini bagian yang paling mudah salah paham. Redesign penyimpanan
(migrasi `e5f6g7h8i9j0`) memisahkan:

| Tabel | Isi | Umur | Ditulis oleh |
|---|---|---|---|
| `scada_tag_latest` | **satu baris per tag** — nilai sekarang | selalu ditimpa | bridge (~1 detik), `historian.latest_loop` |
| `scada_ring` | riwayat pendek untuk tag "tanpa simpan" | dipangkas ke `ring_window_h` (24 jam) | bridge |
| `scada_samples` | riwayat panjang untuk tag "simpan data" | sampai reset siklus (`store_months`) | bridge, `historian.sample_once` |
| `scada_samples_all` | **VIEW** gabungan ring + samples | — | — (baca saja) |

Semua endpoint baca (`/history`, `/summary`, `/sparklines`) query
`ScadaSampleAll` — jadi kode pembacaan tidak perlu tahu tag ini mode ring atau
mode simpan.

`scada_bridge_status` — heartbeat per site (`connected`, `changed_at`,
`updated_at`), ditulis bridge tiap ~15 detik.

### Alarm

**`scada_alarm_events`** — event terbuka = baris dengan `cleared_at IS NULL`.

Yang membuatnya aman dari duplikat: **partial unique index**
`uq_scada_alarm_open (tag_id, kind) WHERE cleared_at IS NULL`. Membuka event
memakai `INSERT ... ON CONFLICT DO NOTHING`; menutupnya
`UPDATE ... WHERE cleared_at IS NULL RETURNING`. Dua backend yang berbagi satu
database (laptop dev + server) tidak bisa saling menduplikasi notifikasi —
yang kalah race melihat nol baris dan diam.

Kolom `notified_at` berfungsi sebagai klaim kedua khusus notifikasi.

### Arsip

| Tabel | Isi |
|---|---|
| `scada_tag_archives` | per-tag per-siklus: `cycle_start`, `cycle_end`, `file_name`, `drive_file_id`, `web_link`, `row_count` |
| `scada_archives` | per-bulan (skema lama), PK `month` |

### Jejak

| Tabel | Isi |
|---|---|
| `scada_audit_log` | perubahan konfigurasi: `action`, `target_type`, `target_label`, `changes` JSONB (diff field-level) |
| `scada_data_access_log` | pembacaan besar: `profile_id`, `kind` (`recent`/`samples`/`history`), rentang, jumlah baris |

---

## Layer 2 — Backend (service & worker)

Lima loop latar, semua dijalankan `lifespan` di `main.py`, semua bisa
dimatikan lewat env.

### `historian.py` — sampler + simulator

| Konstanta | Default | Env |
|---|---|---|
| `INTERVAL_S` | 60 | `HISTORIAN_INTERVAL_S` |
| `LATEST_INTERVAL_S` | 5 | `HISTORIAN_LATEST_INTERVAL_S` |
| `ENABLED` | on | `HISTORIAN_ENABLED` |
| `SIM_ENABLED` | **off** | `HISTORIAN_SIMULATOR` |
| `BACKFILL_DAYS` | 7 | — |

`sim_value(tag, at)` adalah **fungsi murni** dari (id tag, waktu):
base + dua gelombang sinus + noise ber-seed hash. Karena `value = f(t)`,
riwayat bisa di-backfill instan saat tag simulator dibuat — tidak perlu
menunggu berhari-hari agar chart terlihat nyata.

Timestamp diselaraskan ke menit, `INSERT ... ON CONFLICT DO NOTHING` — jadi dev
lokal dan server yang men-sample database yang sama tetap idempoten.

`latest_loop` hanya jalan kalau simulator aktif: tag MQTT dapat nilai live
dari bridge, tidak perlu lajur ini.

### `alarm_engine.py` — deteksi tanpa penonton

| Konstanta | Default | Env |
|---|---|---|
| `INTERVAL_S` | 5 | `ALARM_INTERVAL_S` |
| `SILENT_FACTOR` | 3 | `ALARM_SILENT_FACTOR` |
| `SILENT_FLOOR_S` | 60 | — |

Tiap siklus: **satu** `SELECT` dari `scada_tag_latest` untuk semua tag, lalu
evaluasi tiga kondisi per tag:

| Jenis | Syarat |
|---|---|
| `high` | `latest.value > config.alarm_max` |
| `low` | `latest.value < config.alarm_min` |
| `silent` | tidak ada data > `max(3 × interval, 60 s)`; otomatis untuk setiap tag MQTT |

### `notifier.py` — dispatcher alarm eksternal

In-app tidak perlu dispatcher: baris `scada_alarm_events` masuk publikasi
Supabase Realtime, jadi browser langsung dapat. Modul ini hanya
**email + Telegram**, masing-masing di balik flag di `scada_alarm_settings`.

### `email_notifier.py` — Resend

Terpisah dari `email.py` (SMTP Gmail milik Document Manager) karena Resend
memakai API HTTP sederhana dan mendukung attachment (dibutuhkan job backup
Excel). Tanpa `RESEND_API_KEY` → fallback SMTP → kalau itu pun kosong, email
hanya dicatat dan dilewati (dev lokal tidak butuh akun Resend).

### `archiver.py` — reset siklus

| Konstanta | Default | Env |
|---|---|---|
| `CHECK_EVERY_S` | 6 jam | `ARCHIVE_CHECK_EVERY_S` |
| `ROOT_FOLDER_NAME` | `R-Net Arsip` | — |

Tiap tag "simpan data" mengakumulasi jendela tetap (`store_months`) mulai dari
`config.store_cycle_start`. Setelah jendela lewat: seluruh siklus diekspor ke
satu `.xlsx` di Drive (`R-Net Arsip/<tahun>/<label>-<dari>-<sampai>.xlsx`),
**baru kemudian** dihapus dari `scada_samples`, lalu jam dimulai ulang.

Aturan keselamatan yang tegas: **tidak ada arsip selesai → tidak ada
penghapusan.** Kalau Drive mati, data tetap tinggal sampai percobaan berikutnya
berhasil.

### `health_monitor.py` — kesehatan sistem

| Konstanta | Default |
|---|---|
| `INTERVAL_S` | 60 |
| `BRIDGE_OFFLINE_S` | 120 |
| `TAG_STALE_S` | 900 |
| `ERROR_THROTTLE_S` | 300 |

Tiga sumber masalah: (1) bridge mati / broker tak terjangkau, dibaca dari
heartbeat `scada_bridge_status`; (2) tag MQTT tidak update > 15 menit —
dilewati saat bridge sedang offline supaya tidak dobel; (3) error 5xx backend,
dilaporkan middleware `main.py` lewat `report_server_error()`.

Memakai transisi state (`_apply_transitions`) sehingga hanya perubahan yang
dikirim, bukan pesan berulang tiap menit.

### `rnet_settings.py` — resolver bersama

`level_seconds()`, `resolve_interval()`, `is_ring()`, `parse_cycle_start()`,
`cycle_reset_at()`, `add_months()`.

> Docstring-nya menulis eksplisit: *"The standalone MQTT bridge
> (deploy/data/bridge.py) is a separate process and keeps its OWN copy of this
> logic — keep the two in sync."* Dua sumber kebenaran yang dijaga manual.

### `scada_audit.py` — jejak konfigurasi

`tag_snapshot()` → ubah → `diff_fields(before, after, sensitive=SENSITIVE)`.
Daftar `SENSITIVE` memastikan password broker dan kredensial stream tercatat
hanya sebagai `{"changed": true}`.

### `data_access_monitor.py` — pemantau ekspor besar

Dua ambang: `DATA_ACCESS_LOG_MIN_ROWS` (default 500 — di bawah itu tidak
dicatat, scroll biasa bukan kejadian menarik) dan `DATA_ACCESS_ALERT_ROWS`
(default 2 juta baris per akun per hari UTC → alert Telegram + email sekali
per akun per hari).

### Bridge (`deploy/data/bridge.py`, 811 baris) — proses terpisah

Bukan bagian dari backend. Jalan di PC lapangan, subscribe MQTT, menulis
**langsung** ke Supabase.

| Konstanta | Default |
|---|---|
| `FLUSH_INTERVAL_S` | 60 |
| `LATEST_FLUSH_S` | 1.0 |
| `CONFIG_REFRESH_S` | 30 |
| `HEARTBEAT_S` | 15 |
| `PRUNE_EVERY_S` | 60 |
| `MIN_INTERVAL_S` | 2 |
| `DEFAULT_LEVELS` | `{fastest: 2, fast: 5, slow: 30, slowest: 60}` |
| `DEFAULT_RING_WINDOW_H` | 24 |
| `BUFFER_ENABLED` | on — store-and-forward SQLite saat internet putus |

---

## Layer 3 — API Route

`routers/scada.py` (1737 baris) + `routers/scada_alarms.py` (337 baris).
Semua ber-rate-limit `READ_LIMIT = 600/menit` atau `WRITE_LIMIT = 120/menit`.

### Perspektif

| Method | Path | Izin |
|---|---|---|
| GET | `/perspectives` | `scada:view` — auto-bootstrap "Default" kalau kosong |
| GET | `/perspectives/published` | `scada:view` |
| POST | `/perspectives` | `scada:view` + `scada:edit_layout` |
| PATCH / DELETE | `/perspectives/{id}` | idem |
| POST | `/perspectives/{id}/default` | idem |
| POST | `/perspectives/{id}/publish` \| `/unpublish` | `scada:view` + **`scada:manage`** |
| POST | `/perspectives/{id}/reset-to-published` | `scada:view` |

`_get_own_perspective` memaksa `owner_id == profile.id` dan membalas **404**
(bukan 403) untuk milik orang lain — tidak membocorkan keberadaan.

### Sumber, kanal, site, sheet, tag

| Resource | Baca | Tulis |
|---|---|---|
| `/streams` | `scada:view` | `scada:manage` |
| `/channels` | `scada:view` | `scada:manage` |
| `/sites` | `scada:view` | `scada:manage` |
| `/sheets` | `scada:view` | `scada:manage` |
| `/tags` | `scada:view` | `scada:manage` |
| `/workbench/columns` | `scada:view` | `scada:manage` |
| `/settings` | `scada:view` | `scada:manage` |

**Aturan visibilitas tag:** tanpa `scada:manage`, hanya tag `enabled = true`
yang terlihat. Diterapkan konsisten di `/tags`, `/history`, `/summary`,
`/sparklines`.

### Data

| Method | Path | Batas |
|---|---|---|
| GET | `/tags/{id}/recent` | — |
| GET | `/tags/{id}/samples` | berpaginasi |
| GET | `/history` | `tag_ids` ≤ `MAX_HISTORY_TAGS`, `points` 10–`MAX_HISTORY_POINTS`, rentang ≤ 45 hari |
| GET | `/summary` | `tag_ids` ≤ `MAX_SUMMARY_TAGS`, rentang ≤ 45 hari |
| GET | `/sparklines` | `range_h` 1–744, `points` 10–240 |
| GET | `/latest` | — |

**Bucketing di SQL, bukan di Python.** `/history` menghitung
`bucket_s = ceil(span / points)` (lantai 1 detik) lalu
`GROUP BY to_timestamp(floor(epoch(ts)/bucket_s)*bucket_s)` dengan
`avg/min/max`. Chart 30 hari tidak pernah mengirim 43 ribu baris mentah.

Lantai 1 detik (bukan 1 menit) disengaja: sampling sekarang per-tag dan bisa
2 detik; lantai menit akan meratakan sensor 3 detik jadi satu titik per menit.

### Cache `/summary` — bagian terbaik di repo

Dua mekanisme bertumpuk:

1. **Cache TTL per (tag, jendela)**. Kunci
   `(tag_id, start_bucket, end_bucket)` di mana bucket = kuantisasi waktu ke
   slot selebar TTL (`SUMMARY_CACHE_TTL_S`, default 45 detik). Penonton
   bersamaan yang "sekarang"-nya beda beberapa detik mendarat di slot yang
   sama dan berbagi hasil; jendela historis tetap punya kunci sendiri.
   `TTL = 0` mematikan cache (untuk tes/dev).

2. **Single-flight**. Saat satu (tag, jendela) sedang diagregasi, request
   bersamaan **menunggu Future yang sama** alih-alih masing-masing menembak
   query. Burst 50 penonton menghitung tiap tag **sekali**, bukan 50 kali.
   Kegagalan diteruskan ke semua penunggu dan klaim dilepas supaya retry bisa
   menghitung ulang.

Batas cache `_SUMMARY_CACHE_MAX = 5000` dengan pembersihan murah: buang yang
sudah kedaluwarsa; kalau masih penuh, reset total.

> Catatan skala: cache ini **per-proses**. Dengan beberapa worker uvicorn tiap
> worker punya salinan sendiri (bukan bug, tapi rasio hit menurun).

### Alarm (`scada_alarms.py`)

| Method | Path | Izin |
|---|---|---|
| GET | `/alarms/active` | `scada:view` |
| GET | `/alarms/history` | `scada:view` |
| POST | `/alarms/{id}/ack` | `scada:view` + **`scada:ack`** |
| GET | `/archives` | `scada:view` |
| POST | `/archives/run` | `scada:manage` |
| GET / PUT | `/alarm-settings` | baca `scada:view`, tulis `scada:manage` |
| POST | `/alarm-settings/test` | `scada:manage` |

### Skema

`backend/app/schemas/scada.py` (1125 baris) — union `Panel` diskriminatif per
tipe panel, divalidasi `TypeAdapter`. `_safe_layout()` adalah jalur baca yang
**toleran**: layout tersimpan yang tidak lolos skema versi sekarang tidak
menjatuhkan request, hanya diganti layout kosong. Ini yang membuat perubahan
skema panel tidak mematikan halaman orang.

---

## Layer 4 — Frontend

### Entry point

`app/(app)/r-net/page.tsx` — tipis: `PageGuard permission="scada:view"` +
`dynamic(() => ScadaView, { ssr: false })`. SSR dimatikan karena
react-grid-layout dan hls.js mengukur DOM.

### State

`features/scada/store.ts` (645 baris) — Zustand. Menyimpan perspektif, sheet,
tag, stream, kanal, dan buffer nilai live (`LIVE_BUFFER_CAP = 400` titik per
tag). Perspektif & sheet terakhir diingat di `localStorage`
(`scada:last-perspective`, `scada:last-sheet`).

### Tampilan utama

`features/scada/scada-view.tsx` (983 baris) — tiga mode:

| Mode | Berkas |
|---|---|
| HMI (kanvas) | `grid/canvas-stage.tsx` + `panels/*` |
| Analisis (tabel + chart) | `analysis/analysis-view.tsx` (918) |
| Kanal (layar penuh) | `channels-view.tsx` |

### Panel (`features/scada/panels/`)

`panel-registry.tsx` memetakan `panel.kind` → komponen. Jenis panel:
`video`, `cropped-video`, `web`, `vnc`, `image`, `chart`, `gauge`, `bar`,
`level`, `led`, `table`, `alarm`, `activity`, `decor`, `elements`,
`layout-box`.

Helper penting:
- `use-tag-value.ts` — nilai live per tag, dengan ambang `STALE_MS`.
- `summary-batch.ts` — menggabungkan permintaan summary dari banyak panel jadi
  **satu** request (pasangan sisi klien dari cache single-flight di backend).
- `use-panel-refresh.ts` — irama refresh per panel.
- `hls-attach.ts` + `stream-pool.ts` — pool pemutar HLS supaya satu stream tidak
  dibuka berkali-kali.
- `fit-scale.tsx` — penskalaan kanvas 1920×1080 ke ukuran layar apa pun.
- `orbit-fallback.tsx` — layar pengganti saat sumber mati.

### Editor

`component-palette.tsx` (751) — palet drag komponen HMI.
`panel-inspector.tsx` (1247, **berkas terbesar di frontend**) — properti panel.
`layout-editor.tsx`, `crop-editor.tsx`, `column-editor.tsx`,
`image-import.ts`.

### Live data

`analysis/use-live-samples.ts` — berlangganan Supabase Realtime channel
`scada-tag-latest` (`postgres_changes`, INSERT + UPDATE).
`use-alarm-events.ts` — channel `scada-alarm-events`.

Jadi nilai live **tidak** melewati backend FastAPI sama sekali: bridge → DB →
Realtime → browser. Backend hanya melayani riwayat dan konfigurasi.

### Analisis & ekspor

`analysis/formula.ts` (+ `formula.test.ts` — satu-satunya tes unit frontend)
untuk kolom formula. `analysis/export-excel.ts` mengekspor **baris mentah DB
apa adanya** (bukan bucket 2 menit — diperbaiki di commit `94e69d2`).
`export-range-dialog.tsx` untuk memilih rentang tanggal.

---

## Alur end-to-end: satu nilai sensor sampai ke layar

```
Sensor / V-Box
   │ MQTT publish  vbox/...
   ▼
Mosquitto (VPS, 8883 TLS)
   │   ├─ (opsional) Node-RED olah & kalibrasi → publish ulang rnet/...
   ▼
bridge.py (PC site)
   │ subscribe rnet/site/device/metric
   │ ├─ transform (skala/offset) → _apply_transform
   │ ├─ tiap ~1 detik  → UPSERT scada_tag_latest      (lajur live)
   │ ├─ tiap interval  → INSERT scada_ring / scada_samples  (lajur riwayat)
   │ ├─ tiap 15 detik  → UPSERT scada_bridge_status   (heartbeat)
   │ └─ internet putus → buffer SQLite, kirim ulang saat pulih
   ▼
Supabase PostgreSQL
   │
   ├──► Realtime  ──────────────► browser (nilai live, tanpa backend)
   │
   ├──► alarm_engine (tiap 5 s) → scada_alarm_events → notifier → Telegram/Email
   │                                      └──► Realtime → lonceng alarm
   │
   ├──► health_monitor (tiap 60 s) → cek heartbeat & tag basi → Telegram/Email
   │
   ├──► archiver (tiap 6 jam) → .xlsx ke Drive → baru hapus samples → reset jam
   │
   └──► FastAPI /api/scada/* → chart, tabel, ringkasan (bucketing + cache)
                                      ▼
                                  browser
```

---

## Utang & catatan modul ini

| # | Hal | Dampak |
|---|---|---|
| **K-4** | `read_pass` & `secret` dikirim mentah ke semua `scada:view` | Standar tidak konsisten dengan `_site_dict` yang meredaksi password |
| — | Logika sampling diduplikasi backend ↔ bridge | Dua sumber kebenaran; docstring mengakui, hanya dijaga manual |
| — | Bridge di `C:\rein-scada` lebih tua dari `deploy/data/bridge.py` di repo | Perubahan repo tidak otomatis sampai ke PC lapangan |
| — | Cache `/summary` per-proses | Rasio hit turun kalau worker uvicorn > 1 |
| — | `scada_audit_log` & `scada_data_access_log` ditulis, tidak punya endpoint baca | Jejak ada tapi hanya bisa dilihat lewat SQL langsung |
| — | Semua worker latar di dalam proses FastAPI yang sama | Backend mati = alarm, sampling, arsip ikut mati |
| — | `panel-inspector.tsx` 1247 baris, `scada.py` 1737 baris | Berkas terbesar; kandidat pemecahan |
| — | `scada_archives` (skema bulanan lama) berdampingan dengan `scada_tag_archives` | Dua model arsip; yang lama mungkin sudah tidak dipakai |

**Yang sebaiknya tidak diubah tanpa alasan kuat:** cache single-flight,
partial unique index alarm, `_safe_layout` yang toleran, aturan "tidak ada
arsip → tidak ada penghapusan", dan `ON CONFLICT DO NOTHING` di sampler.
Semuanya menyelesaikan masalah nyata yang akan kembali kalau disederhanakan.
