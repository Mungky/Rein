"use client";

/**
 * Work Order Create/Edit modal.
 *
 * Usage:
 *  - For CREATE: pass { mode: "create", phaseId, onCreated }
 *  - For EDIT:   pass { mode: "edit", task, onSaved }
 *
 * Fields:
 *  - Judul (name) — required
 *  - Deskripsi
 *  - Lokasi
 *  - Assign ke (profile select — loaded lazily)
 */

import { useEffect, useState } from "react";
import { ArrowLeft, Loader2, Plus, Save, X, Wrench } from "lucide-react";
import { workspaceApi, type Task } from "@/lib/api/workspace";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
interface UserProfile {
  id: string;
  username: string;
  full_name: string;
  role: string;
  is_active: boolean;
}

async function authHeaders(): Promise<Record<string, string>> {
  const { getSupabaseClient } = await import("@/lib/supabase/client");
  const supabase = getSupabaseClient();
  if (!supabase) return {};
  const { data: { session } } = await supabase.auth.getSession();
  return session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {};
}

type Props =
  | { mode: "create"; phaseId: string; task?: never; onCreated: (t: Task) => void; onClose: () => void; fullPage?: boolean }
  | { mode: "edit"; phaseId?: never; task: Task; onSaved: (t: Task) => void; onClose: () => void; fullPage?: boolean };

interface DraftState {
  name: string;
  description: string;
  location: string;
  assignedTo: string;
  deadline: string;
  estimatedDays: string;
}

export function WoFormModal(props: Props) {
  const { mode, onClose, fullPage = false } = props;
  const isEdit = mode === "edit";
  const initial: DraftState = isEdit
    ? {
        name: props.task.name,
        description: props.task.description ?? "",
        location: props.task.location ?? "",
        assignedTo: props.task.assigned_to ?? "",
        deadline: props.task.deadline ?? "",
        estimatedDays: props.task.estimated_days != null ? String(props.task.estimated_days) : "",
      }
    : { name: "", description: "", location: "", assignedTo: "", deadline: "", estimatedDays: "" };

  const [draft, setDraft] = useState<DraftState>(initial);
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [usersLoading, setUsersLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load users for assignee dropdown
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const headers = await authHeaders();
        const res = await fetch(`${API_URL}/api/admin/users`, { headers });
        if (res.ok) {
          const list = (await res.json()) as UserProfile[];
          if (!cancelled) setUsers(list.filter((u) => u.is_active));
        }
      } catch { /* fail-open: dropdown shows empty */ }
      finally { if (!cancelled) setUsersLoading(false); }
    })();
    return () => { cancelled = true; };
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!draft.name.trim()) return;
    setSubmitting(true); setError(null);
    try {
      const payload = {
        name: draft.name.trim(),
        description: draft.description.trim() || undefined,
        location: draft.location.trim() || undefined,
        assigned_to: draft.assignedTo || undefined,
        deadline: draft.deadline || undefined,
        estimated_days: draft.estimatedDays ? parseInt(draft.estimatedDays, 10) : undefined,
      };
      if (isEdit) {
        const updated = await workspaceApi.updateTask(props.task.id, payload as Partial<Task>);
        props.onSaved(updated);
      } else {
        const created = await workspaceApi.createTask(props.phaseId, payload);
        props.onCreated(created);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Gagal menyimpan WO");
    } finally { setSubmitting(false); }
  };

  const formContent = (
    <>
      {/* Body */}
      <div className="flex flex-col gap-5">
        <div>
          <label className="text-[12px] font-semibold text-text-muted mb-1.5 block">
            Judul Pekerjaan <span className="text-red">*</span>
          </label>
          <input
            required
            autoFocus
            value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            className="field-input"
            placeholder="Mis. Pasang pipa 8 inch di Area B"
            maxLength={255}
          />
        </div>

        <div>
          <label className="text-[12px] font-semibold text-text-muted mb-1.5 block">Deskripsi</label>
          <textarea
            value={draft.description}
            onChange={(e) => setDraft({ ...draft, description: e.target.value })}
            className="field-input min-h-[90px] py-2 resize-y"
            placeholder="Scope pekerjaan lebih detail: spesifikasi, material yang dibutuhkan, dll."
            maxLength={2000}
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="text-[12px] font-semibold text-text-muted mb-1.5 block">Lokasi</label>
            <input
              value={draft.location}
              onChange={(e) => setDraft({ ...draft, location: e.target.value })}
              className="field-input"
              placeholder="Mis. Area B, Lantai 2"
              maxLength={120}
            />
          </div>
          <div>
            <label className="text-[12px] font-semibold text-text-muted mb-1.5 block">Deadline</label>
            <input
              type="date"
              value={draft.deadline}
              onChange={(e) => setDraft({ ...draft, deadline: e.target.value })}
              className="field-input"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="text-[12px] font-semibold text-text-muted mb-1.5 block">Estimasi Hari</label>
            <input
              type="number"
              min="0"
              max="365"
              value={draft.estimatedDays}
              onChange={(e) => setDraft({ ...draft, estimatedDays: e.target.value })}
              className="field-input"
              placeholder="Mis. 5"
            />
          </div>
          <div>
            <label className="text-[12px] font-semibold text-text-muted mb-1.5 block">Assign ke (PIC)</label>
            {usersLoading ? (
              <div className="field-input flex items-center gap-2 text-text-muted text-xs">
                <Loader2 className="size-3.5 animate-spin" /> Memuat pengguna…
              </div>
            ) : (
              <select
                value={draft.assignedTo}
                onChange={(e) => setDraft({ ...draft, assignedTo: e.target.value })}
                className="field-input"
              >
                <option value="">-- Belum di-assign --</option>
                {users.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.full_name || u.username} ({u.role})
                  </option>
                ))}
              </select>
            )}
          </div>
        </div>

        {error && (
          <div className="px-3 py-2 rounded-[var(--r)] bg-red-bg text-red text-[12.5px] border border-red/20">
            {error}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="pt-4 border-t border-border-soft flex gap-2 justify-end shrink-0">
        <button type="button" onClick={onClose} className="btn btn-default" disabled={submitting}>
          Batal
        </button>
        <button
          type="submit"
          disabled={submitting || !draft.name.trim()}
          className="btn btn-primary gap-1.5"
        >
          {submitting
            ? <Loader2 className="size-4 animate-spin" />
            : (isEdit ? <Save className="size-4" /> : <Plus className="size-4" />)
          }
          {submitting ? "Menyimpan…" : (isEdit ? "Simpan" : "Buat WO")}
        </button>
      </div>
    </>
  );

  if (fullPage) {
    return (
      <div className="workspace-surface flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-bg">
        <header className="flex shrink-0 items-center justify-between gap-4 border-b border-border-soft px-4 py-3 sm:px-6">
          <div className="flex items-center gap-3 min-w-0">
            <button
              aria-label="Kembali"
              type="button"
              onClick={onClose}
              className="btn btn-ghost btn-icon min-h-9 min-w-9"
            >
              <ArrowLeft className="size-4" />
            </button>
            <div className="min-w-0">
              <h1 className="text-base font-bold truncate">
                {isEdit ? "Edit Work Order" : "Work Order Baru"}
              </h1>
              <p className="mt-0.5 text-xs text-text-muted truncate">
                {isEdit ? "Ubah detail WO ini" : "Breakdown pekerjaan dari Phase yang dipilih"}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="btn btn-ghost btn-sm"
          >
            Batal
          </button>
        </header>
        <main className="min-h-0 flex-1 overflow-y-auto bg-bg-ctrl/20 p-4 sm:p-6 lg:p-8">
          <div className="mx-auto max-w-2xl rounded-xl border border-border bg-bg p-5 sm:p-8 shadow-xs">
            <form onSubmit={submit} className="flex flex-col gap-6">
              {formContent}
            </form>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <form
        onSubmit={submit}
        className="modal-panel max-w-xl flex flex-col max-h-[92vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 pt-6 pb-4 border-b border-border-soft flex items-start gap-3 shrink-0">
          <div className="size-10 rounded-[var(--r-lg)] bg-gradient-to-br from-primary to-primary-hover text-white flex items-center justify-center shrink-0 shadow-[0_2px_8px_rgba(37,99,235,0.25)]">
            <Wrench className="size-5" />
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-[16px] font-bold text-text leading-tight">
              {isEdit ? "Edit Work Order" : "Work Order Baru"}
            </h2>
            <p className="text-[12px] text-text-muted mt-0.5">
              {isEdit ? "Ubah detail WO ini" : "Breakdown pekerjaan dari Phase yang dipilih"}
            </p>
          </div>
          <button type="button" onClick={onClose} className="btn btn-ghost btn-icon btn-sm">
            <X className="size-4" />
          </button>
        </div>
        <div className="px-6 py-5 flex flex-col gap-4 overflow-y-auto">
          {formContent}
        </div>
      </form>
    </div>
  );
}
