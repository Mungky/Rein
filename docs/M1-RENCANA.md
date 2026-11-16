# M1 — MVP Inti: rencana & keputusan

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

1. [ ] Shared: state machine WO & project, perhitungan progres (Actual & per kategori, PRD §8.4), schema Zod project/WO/logbook/bantuan.
2. [ ] DB: `clients`, `projects`, `project_members`, `project_status_history`, `wo_types` (+seed), `work_orders`, `wo_references`, `wo_watchers`, `logbook_entries`, `progress_events`, `help_requests`, `notifications`, `notification_deliveries`, `user_settings`.
3. [ ] API project: CRUD, anggota, status (Berjalan/Ditunda/Selesai), progres per kategori, syarat Selesai, lampiran project.
4. [ ] API WO + logbook + Butuh bantuan + lampiran WO/logbook, pengikut, entri `system`.
5. [ ] Notifikasi: outbox in-app + SSE, `WhatsAppProvider` (`OpenWAProvider`, `NullProvider`), worker pg-boss, webhook OpenWA, job 07:00.
6. [ ] Verifikasi WA (dibalik), PIN + fast login, Admin: role & izin, jenis WO, sesi WhatsApp, salin tautan aktivasi.
7. [ ] Web: daftar project (Table/Kanban), buat project, detail project (worklist Table/Kanban, bar kategori, panel), buat WO (+lampiran), detail WO + logbook (kompresi foto, thumbnail), Butuh bantuan, Beranda, Notifikasi.
8. [ ] PWA app shell, E2E Playwright alur P1–P5, verifikasi budget & laporan.
