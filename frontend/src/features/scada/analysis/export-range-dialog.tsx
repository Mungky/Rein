"use client";

/** "Export Data" — drawer kanan: pilih LAJUR, lalu rentang Dari/Sampai, lalu
 *  unduh sebagai CSV.
 *
 *  R-Net menyimpan di dua tempat dengan umur yang sangat berbeda:
 *
 *    Mentah  (scada_raw)         tiap nilai apa adanya   ~24-48 jam
 *    Ringkasan (scada_rollup_1m) 1 baris/menit: rata²,   ~30-61 hari
 *                                min, maks, jumlah data
 *
 *  Drawer ini dulu hanya bisa membaca yang pertama dan tidak punya cara untuk
 *  mengatakannya. Batas kalendernya ditebak dari kebijakan — 24 jam, atau 31
 *  hari kalau ADA SATU sensor terpilih yang bercentang "Simpan data" — jadi
 *  memilih lima sensor yang salah satunya bercentang membuka rentang sebulan
 *  untuk lima-limanya, dan empat sensor sisanya pulang dengan sehari setengah.
 *  Berkasnya tetap terbentuk, tetap bernama sesuai rentang yang diminta, dan
 *  tidak ada satu pun yang memberitahu bahwa isinya lebih pendek.
 *
 *  Sekarang batasnya datang dari /coverage — dibaca dari nama partisi yang
 *  benar-benar hidup, bukan dari konstanta — dan tiap sensor menampilkan
 *  jendela aslinya di lajur yang sedang dipilih. */

import { useEffect, useMemo, useState } from "react";
import { Download, ExternalLink, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Drawer } from "@/components/ui/drawer";
import { scadaApi } from "@/lib/api/scada";
import type { Archive, Coverage, Lane, RollupArchive, Tag } from "../types";
import { exportRangeToFile } from "./export-data";

const DAY_MS = 86_400_000;
/** Batas server (MAX_HISTORY_SPAN di routers/scada.py). Berlaku untuk kedua
 *  lajur, jadi kalender tidak boleh menawarkan lebih dari ini. */
const MAX_SPAN_MS = 45 * DAY_MS;

/** Date -> nilai untuk <input type="datetime-local"> (waktu LOKAL, menit). */
function toLocalInput(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}`
  );
}

function fmtHuman(d: Date): string {
  return d.toLocaleString("id", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** "3 hari" / "18 jam" — dipakai untuk merangkum lebar jendela sebuah lajur. */
function fmtSpan(ms: number): string {
  const h = Math.round(ms / 3_600_000);
  if (h < 48) return `${h} jam`;
  return `${Math.round(h / 24)} hari`;
}

const LANES: { value: Lane; label: string; detail: string }[] = [
  {
    value: "raw",
    label: "Mentah",
    detail: "Setiap nilai apa adanya, sesuai kecepatan sampling sensor.",
  },
  {
    value: "rollup",
    label: "Ringkasan 1 menit",
    detail: "Satu baris per menit: rata², min, maks, dan jumlah data.",
  },
];

export function ExportRangeDialog({
  tags,
  sheetName,
  onClose,
}: {
  tags: Tag[];
  sheetName: string;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [lane, setLane] = useState<Lane>("raw");
  const [archives, setArchives] = useState<Archive[]>([]);
  const [rollupArchives, setRollupArchives] = useState<RollupArchive[]>([]);
  const [coverage, setCoverage] = useState<Coverage | null>(null);
  // Dipatok sekali saat drawer dibuka supaya batas kalender tidak bergeser.
  const now = useMemo(() => new Date(), []);

  const tagIdsKey = tags.map((t) => t.id).join(",");
  useEffect(() => {
    scadaApi
      .getCoverage(tagIdsKey ? tagIdsKey.split(",") : [])
      .then(setCoverage)
      .catch(() => undefined);
  }, [tagIdsKey]);

  useEffect(() => {
    scadaApi.listArchives().then((r) => setArchives(r.items)).catch(() => undefined);
    scadaApi
      .listRollupArchives()
      .then((r) => setRollupArchives(r.items))
      .catch(() => undefined);
  }, []);

  const laneInfo = coverage?.lanes.find((l) => l.lane === lane) ?? null;

  /** Awal jendela yang boleh diminta. Diambil dari partisi yang benar-benar
   *  ada; selagi /coverage belum tiba, pakai perkiraan konservatif supaya
   *  kalender tidak pernah menawarkan lebih dari yang mungkin dilayani. */
  const availableStart = useMemo(() => {
    const fromCoverage = laneInfo?.from_ts ? new Date(laneInfo.from_ts) : null;
    const fallback = new Date(
      now.getTime() - (lane === "rollup" ? 30 * DAY_MS : DAY_MS)
    );
    const start = fromCoverage ?? fallback;
    // Server menolak rentang > 45 hari; jangan tawarkan yang pasti ditolak.
    const floor = new Date(now.getTime() - MAX_SPAN_MS);
    return start < floor ? floor : start;
  }, [laneInfo, lane, now]);

  // Tanggal disimpan sebagai OVERRIDE, bukan sebagai nilai. null = "ikuti
  // jendela lajur ini". Dengan begitu, saat /coverage tiba dan memperlebar
  // jendelanya, kolom tanggal ikut tanpa satu pun setState di dalam effect —
  // dan pilihan yang sudah diketik pengguna tidak ditimpa di belakangnya.
  const [fromOverride, setFromOverride] = useState<string | null>(null);
  const [toOverride, setToOverride] = useState<string | null>(null);
  const from = fromOverride ?? toLocalInput(availableStart);
  const to = toOverride ?? toLocalInput(now);

  // Ganti lajur = ganti jendela. Override dibuang DI SINI, di event-nya, bukan
  // lewat effect: tanggal dari lajur lama bisa berada di luar batas lajur baru,
  // dan tombol Export akan mati tanpa penjelasan.
  function pickLane(next: Lane) {
    setLane(next);
    setFromOverride(null);
    setToOverride(null);
  }

  const fromDate = new Date(from);
  const toDate = new Date(to);
  const invalid =
    Number.isNaN(fromDate.getTime()) ||
    Number.isNaN(toDate.getTime()) ||
    fromDate >= toDate;
  const tooLong = !invalid && toDate.getTime() - fromDate.getTime() > MAX_SPAN_MS;
  // Di luar jendela yang benar-benar terisi. `min`/`max` pada datetime-local
  // cuma petunjuk HTML — penegakannya bergantung browser, dan tanpa cek ini
  // rentang di luar jangkauan tetap terkirim, berkasnya pulang pendek, dan
  // tidak ada yang memberi tahu. Persis kegagalan yang drawer ini ada untuk
  // menghilangkan. Hanya berlaku setelah /coverage tiba; sebelum itu batasnya
  // masih tebakan dan memblokir akan lebih menyesatkan.
  const outOfRange =
    !invalid &&
    coverage !== null &&
    (fromDate < availableStart || toDate.getTime() > now.getTime() + 60_000);

  /** Per sensor: jendela nyata di lajur terpilih. */
  const perTag = useMemo(() => {
    const byTag = new Map(
      (coverage?.tags ?? [])
        .filter((c) => c.lane === lane)
        .map((c) => [c.tag_id, c])
    );
    return tags.map((t) => {
      const c = byTag.get(t.id);
      return {
        tag: t,
        first: c?.first_ts ? new Date(c.first_ts) : null,
        last: c?.last_ts ? new Date(c.last_ts) : null,
      };
    });
  }, [coverage, lane, tags]);

  const emptyCount = coverage ? perTag.filter((p) => p.first === null).length : 0;

  async function doExport() {
    if (invalid) {
      toast.error("Rentang tidak valid — 'Dari' harus sebelum 'Sampai'.");
      return;
    }
    setBusy(true);
    try {
      await exportRangeToFile({ tags, sheetName, start: fromDate, end: toDate, lane });
      toast.success("Berkas diunduh");
      onClose();
    } catch (e) {
      // Munculkan penyebab aslinya (status + detail dari backend) daripada
      // pesan generik — mempercepat diagnosa (mis. 429 rate limit / 422).
      const status = (e as { status?: number }).status;
      const detail = e instanceof Error ? e.message : String(e);
      console.error("Export gagal:", e);
      toast.error(
        `Gagal membuat berkas${status ? ` (${status})` : ""}: ${detail.slice(0, 200)}`
      );
    } finally {
      setBusy(false);
    }
  }

  const minInput = toLocalInput(availableStart);
  const maxInput = toLocalInput(now);

  return (
    <Drawer
      title="Export Data"
      subtitle={`${tags.length} sensor terpilih → ${tags.length > 1 ? ".zip berisi CSV" : "berkas CSV"}`}
      icon={<Download className="size-5" />}
      width={460}
      onClose={onClose}
      footer={
        <>
          <button type="button" onClick={onClose} className="btn btn-ghost btn-sm">
            Batal
          </button>
          <button
            type="button"
            onClick={doExport}
            disabled={busy || tags.length === 0 || invalid || tooLong || outOfRange}
            className="btn btn-primary btn-sm gap-1.5"
          >
            {busy ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Download className="size-3.5" />
            )}
            Export
          </button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {/* Pilih lajur — keputusan pertama, karena ia yang menentukan
            rentang mana yang bahkan mungkin diminta. */}
        <div className="flex flex-col gap-2">
          <span className="text-[10.5px] font-semibold uppercase tracking-wide text-text-light">
            Ambil dari
          </span>
          {LANES.map((l) => {
            const info = coverage?.lanes.find((x) => x.lane === l.value);
            const span =
              info?.from_ts && info?.to_ts
                ? fmtSpan(
                    Math.min(now.getTime(), new Date(info.to_ts).getTime()) -
                      new Date(info.from_ts).getTime()
                  )
                : null;
            return (
              <label
                key={l.value}
                className={cn(
                  "flex cursor-pointer items-start gap-2.5 rounded-[var(--r-lg)] border px-3 py-2.5",
                  lane === l.value
                    ? "border-primary/50 bg-primary/5"
                    : "border-border-soft bg-bg-sidebar hover:border-border"
                )}
              >
                <input
                  type="radio"
                  name="export-lane"
                  className="mt-0.5 accent-[var(--rein-primary)]"
                  checked={lane === l.value}
                  onChange={() => pickLane(l.value)}
                />
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline gap-2">
                    <span className="text-[12.5px] font-semibold text-text">
                      {l.label}
                    </span>
                    <span className="text-[11px] tabular-nums text-text-muted">
                      {span ? `tersedia ±${span}` : "…"}
                    </span>
                  </span>
                  <span className="mt-0.5 block text-[11px] leading-snug text-text-light">
                    {l.detail}
                  </span>
                </span>
              </label>
            );
          })}
        </div>

        {/* Ketersediaan data — angka NYATA dari partisi yang hidup */}
        <div className="rounded-[var(--r-lg)] border border-border-soft bg-bg-sidebar px-3 py-2.5">
          <div className="text-[10.5px] font-semibold uppercase tracking-wide text-text-light">
            Rentang yang bisa diminta
          </div>
          <div className="mt-1 text-[12.5px] font-medium tabular-nums text-text">
            {fmtHuman(availableStart)} — sekarang
          </div>
          <p className="mt-1 text-[11px] leading-snug text-text-light">
            {lane === "raw"
              ? "Nilai mentah dibuang setelah jendela retensi (laci harian dibuang utuh, jadi umurnya 24-48 jam). Untuk rentang lebih panjang, pilih Ringkasan 1 menit."
              : "Ringkasan per menit disimpan untuk SEMUA sensor, dicentang “Simpan data” atau tidak. Bulan yang lebih lama sudah pindah ke arsip Google Drive di bawah."}
          </p>
        </div>

        {/* Kalender Dari / Sampai */}
        <div className="flex flex-col gap-2">
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-semibold text-text-muted">Dari</span>
            <input
              type="datetime-local"
              className="field-input h-9 text-[12.5px]"
              value={from}
              min={minInput}
              max={maxInput}
              onChange={(e) => setFromOverride(e.target.value)}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-semibold text-text-muted">Sampai</span>
            <input
              type="datetime-local"
              className="field-input h-9 text-[12.5px]"
              value={to}
              min={minInput}
              max={maxInput}
              onChange={(e) => setToOverride(e.target.value)}
            />
          </label>
          {invalid && (
            <p className="text-[11px] text-red">
              &lsquo;Dari&rsquo; harus sebelum &lsquo;Sampai&rsquo;.
            </p>
          )}
          {tooLong && (
            <p className="text-[11px] text-red">
              Rentang maksimal 45 hari — server menolak yang lebih panjang.
            </p>
          )}
          {outOfRange && (
            <p className="text-[11px] text-red">
              Di luar rentang yang tersedia ({fmtHuman(availableStart)} — sekarang).
              Berkasnya akan pulang lebih pendek dari yang diminta.
            </p>
          )}
        </div>

        {/* Per sensor: apa yang BENAR-BENAR ada di lajur terpilih. Inilah
            penanda yang dulu tidak ada — sebelumnya sensor kosong baru
            ketahuan setelah berkasnya dibuka. */}
        <div>
          <div className="mb-1 flex items-baseline gap-2">
            <span className="text-[10.5px] font-semibold uppercase tracking-wide text-text-light">
              Isi tiap sensor
            </span>
            {emptyCount > 0 && (
              <span className="text-[10.5px] font-semibold text-amber">
                {emptyCount} sensor kosong di lajur ini
              </span>
            )}
          </div>
          <div className="max-h-44 overflow-y-auto rounded-[var(--r)] border border-border-soft bg-bg-sidebar p-2">
            {!coverage ? (
              <p className="px-1.5 py-1 text-[11.5px] text-text-light">
                Memeriksa ketersediaan…
              </p>
            ) : (
              perTag.map(({ tag, first, last }) => (
                <div
                  key={tag.id}
                  className="flex items-baseline gap-2 rounded-[var(--r-sm)] px-1.5 py-1 text-[11.5px]"
                >
                  <span className="min-w-0 truncate text-text-muted" title={tag.label}>
                    {tag.label}
                  </span>
                  <span className="ml-auto shrink-0 tabular-nums text-[10.5px]">
                    {first && last ? (
                      <span className="text-text-light">
                        {fmtHuman(first)} — {fmtHuman(last)}
                      </span>
                    ) : (
                      <span className="text-amber">belum ada data di lajur ini</span>
                    )}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Arsip di Google Drive — dua jenis, dan sampai sekarang yang kedua
            tidak pernah ditampilkan di mana pun. */}
        {rollupArchives.length > 0 && (
          <div>
            <div className="mb-1 text-[10.5px] font-semibold uppercase tracking-wide text-text-light">
              Arsip ringkasan per plant (.zip berisi CSV)
            </div>
            <div className="max-h-40 overflow-y-auto rounded-[var(--r)] border border-border-soft bg-bg-sidebar p-2">
              {rollupArchives.map((a) => (
                <a
                  key={`${a.site_id ?? "-"}-${a.month}`}
                  href={a.web_link ?? undefined}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-1.5 rounded-[var(--r-sm)] px-1.5 py-1 text-[11.5px] text-text-muted hover:bg-bg-hover hover:text-text"
                >
                  <ExternalLink className="size-3 shrink-0" />
                  <span className="truncate">{a.file_name}</span>
                  <span className="ml-auto shrink-0 text-[10px] text-text-light">
                    {a.tag_count} sensor · {a.row_count.toLocaleString("id")} menit
                  </span>
                </a>
              ))}
            </div>
          </div>
        )}

        {archives.length > 0 && (
          <div>
            <div className="mb-1 text-[10.5px] font-semibold uppercase tracking-wide text-text-light">
              Arsip mentah per sensor
            </div>
            <div className="max-h-40 overflow-y-auto rounded-[var(--r)] border border-border-soft bg-bg-sidebar p-2">
              {archives.map((a) => (
                <a
                  key={`${a.tag_id}-${a.cycle_start}`}
                  href={a.web_link ?? undefined}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-1.5 rounded-[var(--r-sm)] px-1.5 py-1 text-[11.5px] text-text-muted hover:bg-bg-hover hover:text-text"
                >
                  <ExternalLink className="size-3 shrink-0" />
                  <span className="truncate">{a.file_name}</span>
                  <span className="ml-auto shrink-0 text-[10px] text-text-light">
                    {a.row_count.toLocaleString("id")} baris
                  </span>
                </a>
              ))}
            </div>
          </div>
        )}
      </div>
    </Drawer>
  );
}
