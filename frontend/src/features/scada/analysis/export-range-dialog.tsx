"use client";

/** "Export Data" — drawer kanan: pilih rentang lewat kalender Dari/Sampai,
 *  lalu unduh riwayat sensor terpilih sebagai Excel.
 *
 *  Ketersediaan data bergantung mode penyimpanan tiap sensor:
 *   - Tidak "Simpan data" (mode ring) → hanya 24 jam terakhir yang ada.
 *   - "Simpan data" ON → tersimpan ±1 bulan di database; bulan-bulan lama
 *     sudah diarsip ke Google Drive (daftar di bawah). */

import { useEffect, useMemo, useState } from "react";
import { Download, ExternalLink, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Drawer } from "@/components/ui/drawer";
import { scadaApi } from "@/lib/api/scada";
import type { Archive, Tag } from "../types";
import { exportRangeToExcel } from "./export-excel";

const DAY_MS = 86_400_000;
/** Retensi historian di database sebelum arsip+reset (lihat archiver). */
const STORED_WINDOW_MS = 31 * DAY_MS;

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
  const [archives, setArchives] = useState<Archive[]>([]);
  // Dipatok sekali saat drawer dibuka supaya batas kalender tidak bergeser.
  const now = useMemo(() => new Date(), []);

  // Sensor apa pun yang menyimpan riwayat → jendela lebih panjang tersedia.
  const anyStored = useMemo(
    () =>
      tags.some((t) => Boolean((t.config as Record<string, unknown>).store_enabled)),
    [tags]
  );
  const availableStart = useMemo(
    () => new Date(now.getTime() - (anyStored ? STORED_WINDOW_MS : DAY_MS)),
    [now, anyStored]
  );

  // Default: seluruh jendela yang tersedia (ring = 24 jam, tersimpan = ±1 bulan).
  const [from, setFrom] = useState(() => toLocalInput(availableStart));
  const [to, setTo] = useState(() => toLocalInput(now));

  useEffect(() => {
    scadaApi
      .listArchives()
      .then((res) => setArchives(res.items))
      .catch(() => undefined);
  }, []);

  const fromDate = new Date(from);
  const toDate = new Date(to);
  const invalid =
    Number.isNaN(fromDate.getTime()) ||
    Number.isNaN(toDate.getTime()) ||
    fromDate >= toDate;

  async function doExport() {
    if (invalid) {
      toast.error("Rentang tidak valid — 'Dari' harus sebelum 'Sampai'.");
      return;
    }
    setBusy(true);
    try {
      await exportRangeToExcel({ tags, sheetName, start: fromDate, end: toDate });
      toast.success("File Excel diunduh");
      onClose();
    } catch (e) {
      // Munculkan penyebab aslinya (status + detail dari backend) daripada
      // pesan generik — mempercepat diagnosa (mis. 429 rate limit / 422).
      const status = (e as { status?: number }).status;
      const detail = e instanceof Error ? e.message : String(e);
      console.error("Export gagal:", e);
      toast.error(
        `Gagal membuat file Excel${status ? ` (${status})` : ""}: ${detail.slice(0, 200)}`
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
      subtitle={`${tags.length} sensor terpilih → file Excel`}
      icon={<Download className="size-5" />}
      width={420}
      onClose={onClose}
      footer={
        <>
          <button type="button" onClick={onClose} className="btn btn-ghost btn-sm">
            Batal
          </button>
          <button
            type="button"
            onClick={doExport}
            disabled={busy || tags.length === 0 || invalid}
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
        {/* Ketersediaan data */}
        <div className="rounded-[var(--r-lg)] border border-border-soft bg-bg-sidebar px-3 py-2.5">
          <div className="text-[10.5px] font-semibold uppercase tracking-wide text-text-light">
            Data tersedia
          </div>
          <div className="mt-1 text-[12.5px] font-medium tabular-nums text-text">
            {fmtHuman(availableStart)} — sekarang
          </div>
          <p className="mt-1 text-[11px] leading-snug text-text-light">
            {anyStored
              ? "Data tersimpan hingga ±1 bulan di database; bulan-bulan sebelumnya ada di arsip Google Drive di bawah."
              : "Sensor ini mode 24 jam (tidak menyimpan riwayat) — hanya 24 jam terakhir yang tersedia. Centang “Simpan data ke riwayat” agar data lama bisa ditarik."}
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
              onChange={(e) => setFrom(e.target.value)}
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
              onChange={(e) => setTo(e.target.value)}
            />
          </label>
          {invalid && (
            <p className="text-[11px] text-red">
              &lsquo;Dari&rsquo; harus sebelum &lsquo;Sampai&rsquo;.
            </p>
          )}
        </div>

        {/* Arsip bulanan di Google Drive */}
        {archives.length > 0 && (
          <div>
            <div className="mb-1 text-[10.5px] font-semibold uppercase tracking-wide text-text-light">
              Arsip Google Drive (bulan lama)
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
