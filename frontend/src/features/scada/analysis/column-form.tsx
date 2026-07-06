"use client";

/** Add/edit dialog for a custom workbench column. Two families:
 *  - "formula": computed per row, validated live while typing (parse +
 *    reference check) — a broken formula can't be saved, like Excel.
 *  - "text" / "number": manual metadata typed per cell (the TDengine-TAGS
 *    analogue: Lokasi, Merek, SN, …), values live in tag.meta. */

import { useMemo, useState } from "react";
import { Loader2, Sigma, X } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { scadaApi } from "@/lib/api/scada";
import { FormulaError, compileFormula, normalizeRef } from "./formula";
import type { ColumnKind, WorkbenchColumn } from "../types";

export const BUILTIN_REFS = ["Terkini", "Min", "Rata", "Maks"] as const;

const KIND_OPTIONS: { kind: ColumnKind; label: string; desc: string }[] = [
  { kind: "formula", label: "Rumus", desc: "Dihitung otomatis per baris" },
  { kind: "text", label: "Teks", desc: "Diketik manual (mis. Lokasi)" },
  { kind: "number", label: "Angka", desc: "Diketik manual (mis. Kapasitas)" },
];

export function ColumnFormDialog({
  column,
  columns,
  sheetId,
  onChanged,
  onClose,
}: {
  column: WorkbenchColumn | null; // null = create
  columns: WorkbenchColumn[]; // columns of the SAME sheet
  sheetId: string;
  onChanged: () => Promise<void>;
  onClose: () => void;
}) {
  const [kind, setKind] = useState<ColumnKind>(column?.kind ?? "formula");
  const [name, setName] = useState(column?.name ?? "");
  const [formula, setFormula] = useState(column?.formula ?? "");
  const [unit, setUnit] = useState(column?.unit ?? "");
  const [decimals, setDecimals] = useState(String(column?.decimals ?? 1));
  const [saving, setSaving] = useState(false);

  // A formula may reference built-ins, columns BEFORE it (cycle-free by
  // construction), and number-metadata columns anywhere in the sheet.
  const allowedRefs = useMemo(() => {
    const earlier = column
      ? columns.filter((c) => c.position < column.position)
      : columns;
    return new Set([
      ...BUILTIN_REFS.map((r) => normalizeRef(r)),
      ...earlier
        .filter((c) => c.kind === "formula" || c.kind === "number")
        .map((c) => normalizeRef(c.name)),
      ...columns
        .filter((c) => c.kind === "number")
        .map((c) => normalizeRef(c.name)),
    ]);
  }, [column, columns]);

  const formulaError = useMemo(() => {
    if (kind !== "formula" || !formula.trim()) return null;
    try {
      const compiled = compileFormula(formula);
      const unknown = compiled.refs.filter((r) => !allowedRefs.has(r));
      if (unknown.length > 0)
        return `Referensi tidak dikenal: ${unknown.map((r) => `[${r}]`).join(", ")}`;
      return null;
    } catch (e) {
      return e instanceof FormulaError ? e.message : "Rumus tidak valid";
    }
  }, [kind, formula, allowedRefs]);

  const canSave =
    name.trim() !== "" &&
    (kind !== "formula" || (formula.trim() !== "" && formulaError === null));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSave) return;
    setSaving(true);
    try {
      const shared = {
        name: name.trim(),
        unit: unit.trim(),
        decimals: Math.max(0, Math.min(6, Number(decimals) || 0)),
      };
      if (column) {
        await scadaApi.updateColumn(column.id, {
          ...shared,
          ...(column.kind === "formula" ? { formula: formula.trim() } : {}),
        });
        toast.success("Kolom diperbarui");
      } else {
        await scadaApi.createColumn({
          sheet_id: sheetId,
          kind,
          ...shared,
          ...(kind === "formula" ? { formula: formula.trim() } : {}),
        });
        toast.success("Kolom ditambahkan");
      }
      await onChanged();
      onClose();
    } catch {
      toast.error("Gagal menyimpan kolom");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <form
        onSubmit={submit}
        className="modal-panel max-w-md flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-6 pt-6 pb-4 border-b border-border-soft flex items-start gap-3 shrink-0">
          <div className="size-10 rounded-[var(--r-lg)] bg-gradient-to-br from-primary to-primary-hover text-white flex items-center justify-center shrink-0">
            <Sigma className="size-5" />
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-[16px] font-bold text-text leading-tight">
              {column ? "Ubah Kolom" : "Tambah Kolom"}
            </h2>
            <p className="text-[12px] text-text-muted mt-0.5">
              Kolom milik tabel ini — rumus dihitung, metadata diketik per sel
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="btn btn-ghost btn-icon btn-sm -mr-1 -mt-1"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="px-6 py-5 flex flex-col gap-4 overflow-y-auto">
          {!column && (
            <div>
              <label className="text-[12px] font-semibold text-text-muted mb-1.5 block">
                Jenis Kolom
              </label>
              <div className="grid grid-cols-3 gap-2">
                {KIND_OPTIONS.map((opt) => (
                  <button
                    key={opt.kind}
                    type="button"
                    onClick={() => setKind(opt.kind)}
                    className={cn(
                      "flex flex-col items-center gap-0.5 rounded-[var(--r-lg)] border px-2 py-2.5 cursor-pointer",
                      kind === opt.kind
                        ? "border-primary bg-primary/5 text-text"
                        : "border-border-soft text-text-muted hover:border-border"
                    )}
                  >
                    <span className="text-[12.5px] font-semibold">{opt.label}</span>
                    <span className="text-[10px] text-text-light text-center leading-tight">
                      {opt.desc}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}

          <div>
            <label className="text-[12px] font-semibold text-text-muted mb-1.5 block">
              Nama Kolom <span className="text-red">*</span>
            </label>
            <input
              required
              className="field-input"
              placeholder={kind === "formula" ? "Mis. Energi Harian" : "Mis. Lokasi"}
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={60}
            />
          </div>

          {kind === "formula" && (
            <div>
              <label className="text-[12px] font-semibold text-text-muted mb-1.5 block">
                Rumus <span className="text-red">*</span>
              </label>
              <input
                required
                className="field-input font-mono"
                placeholder="[Terkini] * 24 / 1000"
                value={formula}
                onChange={(e) => setFormula(e.target.value)}
                maxLength={500}
              />
              {formulaError ? (
                <p className="mt-1.5 text-[11.5px] font-semibold text-red">
                  #RUMUS! — {formulaError}
                </p>
              ) : (
                <p className="mt-1.5 text-[11px] text-text-light">
                  Referensi: {BUILTIN_REFS.map((r) => `[${r}]`).join(" ")} + kolom
                  angka lain · fungsi: ABS, ROUND, SQRT, MIN, MAX · pemisah ;
                </p>
              )}
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[12px] font-semibold text-text-muted mb-1.5 block">
                Satuan
              </label>
              <input
                className="field-input"
                placeholder={kind === "text" ? "(kosongkan)" : "Mis. kWh"}
                value={unit}
                onChange={(e) => setUnit(e.target.value)}
                maxLength={30}
              />
            </div>
            {kind !== "text" && (
              <div>
                <label className="text-[12px] font-semibold text-text-muted mb-1.5 block">
                  Desimal
                </label>
                <input
                  type="number"
                  min={0}
                  max={6}
                  className="field-input"
                  value={decimals}
                  onChange={(e) => setDecimals(e.target.value)}
                />
              </div>
            )}
          </div>
        </div>

        <div className="px-6 pb-6 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="btn btn-ghost btn-sm">
            Batal
          </button>
          <button type="submit" disabled={!canSave || saving} className="btn btn-primary btn-sm">
            {saving && <Loader2 className="size-3.5 animate-spin" />}
            Simpan
          </button>
        </div>
      </form>
    </div>
  );
}
