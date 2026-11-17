# M1 — MVP Inti: rencana & keputusan

> Catatan historis pembangunan. Perubahan produk terbaru mengikuti PRD revisi 1.5/1.6.
> Hasil pengujian terkini ada di [QA perusahaan simulasi](QA-COMPANY-30.md);
> persiapan produksi ada di [panduan Coolify](SELFHOST-COOLIFY.md).

Acuan: PRD §12 (M1), dengan perubahan dari user per 16 Nov 2026.

## Keputusan

| ID | Keputusan | Alasan |
|---|---|---|
| D1 | **Email ditunda.** `MAIL_PROVIDER=null`; delivery kanal email dicatat `skipped` (`email_disabled`). Abstraksi `MailProvider` tetap ada. | User belum mau keluar biaya langganan email sebelum terbukti efektif. |
| D2 | **Gerbang akses = minimal satu kontak terverifikasi** (WA *atau* email). Email terverifikasi lewat Masuk dengan Google; WA lewat kode yang dikirim user ke nomor REIN (FR-003 AC2) atau verifikasi manual Admin. | Tanpa email, verifikasi email tidak bisa dikirim. |
| D3 | **Aktivasi akun tanpa email:** setelah undang / kirim ulang, Admin melihat tombol **Salin tautan aktivasi** (token hanya ditampilkan sekali) untuk dibagikan sendiri. | FR-002 tetap jalan tanpa email. |
| D4 | **Kanal notifikasi M1:** in-app (SSE) untuk semua event §6.1 + **WhatsApp** (OpenWA) untuk `wo.assigned`, `help.requested`, `help.resolved`, `wo.deadline_h1`, `wo.overdue`, `project.member_added`. Batas 20 WA/user/hari dan jam tenang 21:00–07:00 (kecuali `help.requested`) diterapkan sejak M1 untuk mengurangi risiko blokir nomor. Preferensi per user & batching tetap M2. | PRD §6, §10.4. |
| D5 | **OpenWA:** sesi dicari/dibuat lewat nama (`OPENWA_SESSION_NAME`, default `rein`); webhook `message.received` + `session.status` didaftarkan otomatis; tanda tangan `X-OpenWA-Signature: sha256=<hex>` atas raw body; `RESOLVE_LID_TO_PHONE=true` agar nomor pengirim terbaca. QR dipindai dari halaman Admin → WhatsApp. | Dokumentasi OpenWA v0.30. |
| D6 | **Pelajaran dari REIN v1:** state machine WO di `packages/shared` dipakai UI & server; create idempotent (`clientId` + hash isi); edit memakai `expectedUpdatedAt` → 409; row lock untuk nomor WO; WO tidak bisa ke **Review** tanpa minimal 1 entri logbook; test "izin hantu"; redaksi secret di audit; `/dev/*` hanya di build dev. | Lihat analisis v1. |
| D7 | Antrean job **pg-boss**: delivery notifikasi (retry 1/5/30 menit), job harian 07:00 WIB (`wo.deadline_h1`, `wo.overdue`). | PRD §6.2, §10.2. |

## Langkah (commit per langkah)

1. [x] Shared: state machine WO & project, perhitungan progres (Actual & per kategori, PRD §8.4), schema Zod project/WO/logbook/bantuan. — commit `208dcb8`
2. [x] DB — commit `c79631b` (migrasi `0003`–`0005`; **belum diuji ke Postgres**: Docker Desktop macet saat sesi, WSL `docker-desktop` Stopped): `clients`, `projects`, `project_members`, `project_status_history`, `wo_types` (+seed), `work_orders`, `wo_references`, `wo_watchers`, `logbook_entries`, `progress_events`, `help_requests`, `notifications`, `notification_deliveries`, `user_settings`.
3. [x] API project — commit `9523512` (`routes/projects.ts`, `auth/project-access.ts`, `notify/{outbox,bus}.ts`, lampiran per pemilik). **Belum ada test integrasi** (Docker mati) — tulis `test/projects.test.ts` saat DB tersedia.
4. [x] API WO + logbook + Butuh bantuan + Beranda — commit `1f43a7e` (`routes/work-orders.ts`: `projectWoRoutes`, `woRoutes`, `homeRoutes`). Lampiran form Buat WO/logbook: unggah dulu sebagai milik user (staging) lalu `attachmentIds` dipindah saat create. **Belum ada test integrasi** (Docker mati).
5. [ ] (sedang) pg-boss 12.38 terpasang — API: `new PgBoss(url)`, `start()`, `createQueue(n)`, `schedule(n, cron, data, {tz})`, `work(n, async (jobs[]) => …)`. Rencana file: `src/wa/provider.ts` (OpenWAProvider: cari sesi per nama via `GET /api/sessions`, kirim `POST /api/sessions/:id/messages/send-text {chatId:'62…@c.us', text, linkPreview:false}` + header `X-API-Key`, `Idempotency-Key`; QR `GET /api/sessions/:id/qr`; webhook `POST /api/sessions/:id/webhooks {url, events, secret}`), `src/notify/deliver.ts` (kirim delivery `queued` WA: cek kontak WA terverifikasi, jam tenang 21–07 WIB kecuali help.requested, batas 20/hari, retry 1/5/30 mnt), `src/notify/daily.ts` (07:00 WIB: wo.deadline_h1 & wo.overdue maks 3 hari), `src/jobs.ts`, `routes/notifications.ts` (inbox + SSE `/api/stream`), `routes/webhooks.ts` (`X-OpenWA-Signature` HMAC raw body). Outbox in-app + SSE, `WhatsAppProvider` (`OpenWAProvider`, `NullProvider`), worker pg-boss, webhook OpenWA, job 07:00.
6. [ ] Verifikasi WA (dibalik), PIN + fast login, Admin: role & izin, jenis WO, sesi WhatsApp, salin tautan aktivasi.
7. [ ] Web: daftar project (Table/Kanban), buat project, detail project (worklist Table/Kanban, bar kategori, panel), buat WO (+lampiran), detail WO + logbook (kompresi foto, thumbnail), Butuh bantuan, Beranda, Notifikasi.
8. [ ] PWA app shell, E2E Playwright alur P1–P5, verifikasi budget & laporan.
