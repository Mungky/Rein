/** Mock data for Dashboard placeholder — matches design prototype. */

export const KPI_DATA = [
  {
    label: "Proyek Aktif",
    value: "12",
    sub: "3 mendekati deadline",
    color: "var(--primary)",
    dotColor: "var(--primary)",
  },
  {
    label: "Tagihan Terbuka",
    value: "Rp 480jt",
    sub: "5 invoice belum lunas",
    color: "var(--red)",
    dotColor: "var(--red)",
  },
  {
    label: "Dokumen Bulan Ini",
    value: "47",
    sub: "+12 dari bulan lalu",
    color: "var(--green)",
    dotColor: "var(--green)",
  },
  {
    label: "Perlu Persetujuan",
    value: "3",
    sub: "1 mendesak",
    color: "var(--amber)",
    dotColor: "var(--amber)",
  },
] as const;

export const ACTIVITY_DATA = [
  {
    id: 1,
    color: "var(--blue)",
    title: "INV-MUSI-2024-047 diunggah ke Drive",
    meta: "PT Musi Bakti Persada · Finance / Invoices",
    time: "2 jam lalu",
    badge: "INV",
    badgeType: "badge-blue",
  },
  {
    id: 2,
    color: "var(--green)",
    title: "Proyek Dermaga Palembang diperbarui",
    meta: "Tonggak selesai: Fase Desain Struktur",
    time: "4 jam lalu",
    badge: "PRJ",
    badgeType: "badge-green",
  },
  {
    id: 3,
    color: "var(--blue)",
    title: "Ahmad menambah 3 gambar teknik baru",
    meta: "DRW-PLB-0041 · DRW-PLB-0042 · DRW-PLB-0043",
    time: "Kemarin",
    badge: "DRW",
    badgeType: "badge-blue",
  },
  {
    id: 4,
    color: "var(--amber)",
    title: "PO-2024-031 disetujui bagian Finance",
    meta: "PT Semen Padang · Rp 78.500.000",
    time: "Kemarin",
    badge: "PO",
    badgeType: "badge-amber",
  },
  {
    id: 5,
    color: "var(--red)",
    title: "Request akses menunggu: DRW-SLAB-002",
    meta: "Budi Santoso · menunggu persetujuan admin",
    time: "2 hari lalu",
    badge: "ACC",
    badgeType: "badge-red",
  },
  {
    id: 6,
    color: "var(--green)",
    title: "SPK-CILEGON-021 terkirim ke klien",
    meta: "PT Krakatau Steel · Surat Perintah Kerja",
    time: "3 hari lalu",
    badge: "SPK",
    badgeType: "badge-green",
  },
] as const;

export const DOC_STATS = [
  { label: "DRW — Gambar Teknik", pct: 68, count: 312 },
  { label: "INV — Invoice", pct: 45, count: 207 },
  { label: "PO — Purchase Order", pct: 30, count: 138 },
  { label: "SPK — Surat Perintah", pct: 18, count: 84 },
] as const;