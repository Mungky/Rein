"use client";

import { BookOpen, Loader2, RefreshCw, Search, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { getPublicIndexSheets } from "@/lib/api/library";

const TYPE_COLORS: Record<string, string> = {
  DRW: "text-blue bg-blue-bg",
  INV: "text-green bg-green-bg",
  PO: "text-amber bg-amber-bg",
  SPK: "text-primary bg-primary-bg",
  RFP: "text-primary bg-primary-bg",
  RPT: "text-text-muted bg-bg-hover",
  SPEC: "text-text-muted bg-bg-hover",
  OTHER: "text-text-muted bg-bg-hover",
  Q: "text-purple bg-purple-bg",
};

export function PublicIndex() {
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<Record<string, string>[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [activeType, setActiveType] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    getPublicIndexSheets()
      .then(({ headers: h, rows: r }) => {
        setHeaders(h);
        setRows(r);
      })
      .catch(() => {
        setHeaders([]);
        setRows([]);
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  // Derive the doc-type column name (first column, or one named "Jenis")
  const typeCol = headers.find((h) => h.toLowerCase().includes("jenis") || h.toLowerCase() === "type") ?? headers[0] ?? "";

  // Unique doc types for filter chips
  const docTypes = Array.from(new Set(rows.map((r) => r[typeCol]).filter(Boolean))).sort();

  const filtered = rows.filter((row) => {
    if (activeType && row[typeCol] !== activeType) return false;
    if (search) {
      const q = search.toLowerCase();
      return Object.values(row).some((v) => v.toLowerCase().includes(q));
    }
    return true;
  });

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="px-5 pt-4 pb-3 border-b border-border shrink-0">
        <div className="flex items-center gap-2 mb-2">
          <BookOpen className="w-4 h-4 text-primary" />
          <h2 className="text-[14px] font-bold text-text flex-1">Index Publik Perpustakaan</h2>
          <button
            onClick={load}
            disabled={loading}
            className="btn btn-ghost btn-icon btn-sm text-text-muted"
            title="Segarkan"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
          </button>
        </div>
        <p className="text-[11.5px] text-text-muted mb-3">
          Daftar dokumen dari semua departemen. Untuk mengakses isi, hubungi Manajemen.
          {rows.length > 0 && (
            <span className="ml-2 text-text-light tabular-nums">{rows.length} dokumen</span>
          )}
        </p>

        {/* Search bar */}
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-light pointer-events-none" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Cari nama file, projek, klien…"
            className="field-input pl-8 pr-7 text-[12.5px] w-full"
          />
          {search && (
            <button
              onClick={() => setSearch("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-text-light hover:text-text"
            >
              <X className="w-3 h-3" />
            </button>
          )}
        </div>

        {/* Type filter chips */}
        {docTypes.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-2.5">
            <button
              onClick={() => setActiveType(null)}
              className={`px-2 py-0.5 rounded text-[10.5px] font-semibold transition-colors
                ${activeType === null ? "bg-primary text-white" : "bg-bg-hover text-text-muted hover:bg-bg-ctrl"}`}
            >
              Semua
            </button>
            {docTypes.map((t) => {
              const colors = TYPE_COLORS[t] ?? "text-text-muted bg-bg-hover";
              const isActive = activeType === t;
              return (
                <button
                  key={t}
                  onClick={() => setActiveType(isActive ? null : t)}
                  className={`px-2 py-0.5 rounded text-[10.5px] font-bold transition-colors
                    ${isActive ? colors + " ring-1 ring-current" : "bg-bg-ctrl text-text-muted hover:bg-bg-hover"}`}
                >
                  {t}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto">
        {loading ? (
          <div className="flex justify-center items-center h-40">
            <Loader2 className="w-5 h-5 animate-spin text-text-light" />
          </div>
        ) : headers.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-40 gap-2 text-text-muted">
            <BookOpen className="w-8 h-8 text-text-light" />
            <p className="text-[13px]">Spreadsheet belum memiliki data</p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex items-center justify-center h-32 text-[13px] text-text-muted">
            Tidak ada dokumen yang cocok
          </div>
        ) : (
          <table className="w-full text-[12px]">
            <thead className="sticky top-0 bg-bg border-b border-border z-10">
              <tr>
                {headers.map((h) => (
                  <th
                    key={h}
                    className="text-left text-[10px] font-bold uppercase tracking-[0.06em] text-text-light px-3 py-2 whitespace-nowrap"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border-soft">
              {filtered.map((row, i) => (
                <tr key={i} className="hover:bg-bg-hover transition-colors">
                  {headers.map((h) => {
                    const val = row[h] ?? "";
                    const isTypeCol = h === typeCol && val;
                    const typeColor = TYPE_COLORS[val] ?? "text-text-muted bg-bg-hover";
                    return (
                      <td key={h} className="px-3 py-1.5 align-middle">
                        {isTypeCol ? (
                          <span className={`text-[9.5px] font-bold px-1.5 py-0.5 rounded ${typeColor}`}>
                            {val}
                          </span>
                        ) : (
                          <span className={`${h.toLowerCase().includes("nama") ? "font-mono" : ""} text-text`}>
                            {val}
                          </span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
