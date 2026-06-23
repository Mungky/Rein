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
 *  - Deadline (date)
 *  - Estimasi hari
 *  - Assign ke (profile select — loaded lazily)
 */

import { useEffect, useState } from "react";
import { Loader2, Plus, Save, X, Wrench } from "lucide-react";
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
  | { mode: "create"; phaseId: string; task?: never; onCreated: (t: Task) => void; onClose: () => void }
  | { mode: "edit"; phaseId?: never; task: Task; onSaved: (t: Task) => void; onClose: () => void };

interface DraftState {
  name: string;
  description: string;
  location: string;
  assignedTo: string;
  deadline: string;
  estimatedDays: string;
}

export function WoFormModal(props: Props) {
  const { mode, onClose } = props;
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

  return (
    <div className="modal-backdrop" onClick={onClose}>
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

        {/* Body */}
        <div className="px-6 py-5 flex flex-col gap-4 overflow-y-auto">
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
              className="field-input min-h-[80px] py-2 resize-y"
              placeholder="Scope pekerjaan lebih detail: spesifikasi, material yang dibutuhkan, dll."
              maxLength={2000}
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="text-[12px] font-semibold text-text-muted mb-1.5 block">Lokasi</label>
              <input
                value={draft.location}
                onChange={(e) => setDraft({ ...draft, location: e.target.value })}
                className="field-input"
                placeholder="Mis. Cooling Tower Area B"
                maxLength={255}
              />
            </div>
            <div>
              <label className="text-[12px] font-semibold text-text-muted mb-1.5 block">Estimasi (hari)</label>
              <input
                type="number"
                min={1}
                value={draft.estimatedDays}
                onChange={(e) => setDraft({ ...draft, estimatedDays: e.target.value })}
                className="field-input"
                placeholder="3"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="text-[12px] font-semibold text-text-muted mb-1.5 block">Deadline</label>
              <input
                type="date"
                value={draft.deadline}
                onChange={(e) => setDraft({ ...draft, deadline: e.target.value })}
                className="field-input"
              />
            </div>
            <div>
              <label className="text-[12px] font-semibold text-text-muted mb-1.5 block">Assign ke</label>
              {usersLoading ? (
                <div className="field-input flex items-center gap-2 text-text-light">
                  <Loader2 className="size-3.5 animate-spin" /> Memuat…
                </div>
              ) : (
                <select
                  value={draft.assignedTo}
                  onChange={(e) => setDraft({ ...draft, assignedTo: e.target.value })}
                  className="field-select cursor-pointer"
                >
                  <option value="">— Belum ditugaskan —</option>
                  {users.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.full_name} ({u.username})
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
        <div className="px-6 py-4 border-t border-border-soft bg-bg-ctrl flex gap-2 justify-end shrink-0">
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
      </form>
    </div>
  );
}
