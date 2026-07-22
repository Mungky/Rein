"use client";

/** Editor Kolom — pengatur isi & urutan kolom tabel/alarm.
 *
 *  Bagian atas = pratinjau baris header persis seperti yang akan tampil:
 *  chip kolom bisa DIGESER kiri-kanan untuk menukar urutan, dan ✕ untuk
 *  membuangnya. Bagian bawah = kolom yang belum dipakai, klik untuk menambah
 *  di ujung kanan. */

import { useState } from "react";
import { GripVertical, Plus, X } from "lucide-react";
import { cn } from "@/lib/utils";

export function ColumnEditor<K extends string>({
  label,
  hint,
  available,
  value,
  onChange,
}: {
  label: string;
  hint?: string;
  /** Semua kolom yang mungkin, berikut label headernya. */
  available: { key: K; label: string }[];
  /** Kolom terpakai, urut kiri→kanan. */
  value: K[];
  onChange: (columns: K[]) => void;
}) {
  const [dragKey, setDragKey] = useState<K | null>(null);

  const used = value.filter((k) => available.some((a) => a.key === k));
  const unused = available.filter((a) => !used.includes(a.key));
  const labelOf = (k: K) =>
    available.find((a) => a.key === k)?.label || "(tanpa judul)";

  function move(from: K, to: K) {
    if (from === to) return;
    const next = used.filter((k) => k !== from);
    next.splice(next.indexOf(to), 0, from);
    onChange(next);
  }

  return (
    <div className="flex flex-col gap-2 rounded-[var(--r)] border border-border-soft bg-bg-sidebar/50 p-3">
      <span className="text-[12px] font-bold text-text">{label}</span>

      {/* Pratinjau header — geser chip untuk menukar urutan */}
      <div className="flex min-h-[38px] flex-wrap items-center gap-1 rounded-[var(--r-sm)] border border-border bg-bg p-1.5">
        {used.length === 0 ? (
          <span className="px-1 text-[11px] text-text-light">
            Belum ada kolom — tambahkan di bawah.
          </span>
        ) : (
          used.map((k) => (
            <span
              key={k}
              draggable
              onDragStart={() => setDragKey(k)}
              onDragEnd={() => setDragKey(null)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                if (dragKey) move(dragKey, k);
                setDragKey(null);
              }}
              className={cn(
                "flex cursor-grab items-center gap-1 rounded-[var(--r-sm)] border px-1.5 py-1 text-[10.5px] font-semibold uppercase tracking-wide active:cursor-grabbing",
                dragKey === k
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border-soft bg-bg-sidebar text-text-muted"
              )}
            >
              <GripVertical className="size-3 shrink-0 text-text-light" />
              {labelOf(k)}
              <button
                type="button"
                onClick={() => onChange(used.filter((c) => c !== k))}
                className="flex size-4 cursor-pointer items-center justify-center rounded-[var(--r-xs)] text-text-light hover:bg-red/10 hover:text-red"
                title={`Buang kolom ${labelOf(k)}`}
              >
                <X className="size-3" />
              </button>
            </span>
          ))
        )}
      </div>

      {unused.length > 0 && (
        <div className="flex flex-wrap items-center gap-1">
          <span className="text-[11px] text-text-light">Tambah:</span>
          {unused.map((a) => (
            <button
              key={a.key}
              type="button"
              onClick={() => onChange([...used, a.key])}
              className="flex cursor-pointer items-center gap-1 rounded-[var(--r-sm)] border border-dashed border-border px-1.5 py-1 text-[10.5px] font-semibold text-text-muted hover:border-primary hover:text-primary"
            >
              <Plus className="size-3" />
              {a.label || "(tanpa judul)"}
            </button>
          ))}
        </div>
      )}

      <p className="text-[11px] text-text-light">
        {hint ?? "Geser chip untuk menukar urutan kolom."}
      </p>
    </div>
  );
}
