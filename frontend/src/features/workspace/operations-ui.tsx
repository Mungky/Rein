"use client";
import { useRef, useState, type ReactNode, type FormEvent } from "react";
import { Loader2 } from "lucide-react";
import { apiErrorText } from "@/lib/api/client";

export const dateLabel = (value: string | null | undefined) => value ? new Date(value.length === 10 ? `${value}T12:00:00` : value).toLocaleString("id-ID", value.length === 10 ? {day:"numeric", month:"short", year:"numeric"} : {day:"numeric", month:"short", hour:"2-digit", minute:"2-digit"}) : "Belum diatur";
export const duration = (minutes: number) => `${Math.round(minutes / 60 * 10) / 10} jam`;
export function Field({label, children}: {label: string; children: ReactNode}) { return <label className="block space-y-1.5 text-xs font-medium text-text-muted"><span>{label}</span>{children}</label>; }
export function Empty({children}: {children: ReactNode}) { return <p className="rounded-lg border border-dashed border-border p-7 text-center text-sm text-text-muted">{children}</p>; }
export function Badge({children, tone = "neutral"}: {children: ReactNode; tone?: "neutral" | "good" | "warn" | "bad"}) { return <span className={`inline-flex rounded-md px-2 py-1 text-[11px] font-medium ${tone === "good" ? "bg-green-bg text-green border border-green/20" : tone === "warn" ? "bg-amber-bg text-amber border border-amber/20" : tone === "bad" ? "bg-red-bg text-red border border-red/20" : "bg-bg-ctrl text-text-muted border border-border"}`}>{children}</span>; }

export function ActionForm({children, submitLabel = "Simpan", onSubmit, onSaved, className = "space-y-3", reset = false, onCancel, cancelLabel = "Batal"}: {children: ReactNode; submitLabel?: string; onSubmit: (data: FormData) => Promise<unknown>; onSaved?: () => void; className?: string; reset?: boolean; onCancel?: () => void; cancelLabel?: string}) {
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [saved, setSaved] = useState(false);
  const request = useRef<{key:string; signature:string} | null>(null);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (busy) return;
    const form = event.currentTarget;
    setBusy(true); setError(""); setSaved(false);
    try { const data = new FormData(form); const entries = Array.from(data.entries()) as [string, string | File][]; const signature = JSON.stringify(entries.map(([k,v])=>[k, typeof v === "string" ? v : [v.name,v.size,v.lastModified]]));
      if (request.current?.signature !== signature) request.current = {key:crypto.randomUUID(), signature};
      data.set("__request_id", request.current.key);
      await onSubmit(data); request.current = null; setSaved(true); if (reset) form.reset(); onSaved?.(); }
    catch (err) { setError(apiErrorText(err, "Perubahan belum tersimpan")); }
    finally { setBusy(false); }
  }
  return <form onSubmit={submit} className={className}><fieldset disabled={busy} className="contents">{children}</fieldset>{error && <p role="alert" className="text-xs text-red-600">{error}</p>}<div className="flex items-center gap-3"><button disabled={busy} className="btn btn-primary btn-sm">{busy && <Loader2 className="size-3 animate-spin" />}{submitLabel}</button>{onCancel && <button type="button" disabled={busy} onClick={onCancel} className="btn btn-ghost btn-sm">{cancelLabel}</button>}{saved && <span role="status" className="text-xs text-green-700">Tersimpan</span>}</div></form>;
}
export const textValue = (form: FormData, key: string) => String(form.get(key) ?? "").trim();
