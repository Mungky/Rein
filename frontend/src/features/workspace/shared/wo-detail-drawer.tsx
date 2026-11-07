"use client";

/**
 * Work Order Detail Drawer — full-pane detail for a task/WO.
 *
 * Sections:
 *  - Header: status badge, title, action buttons
 *  - Form: judul, deskripsi, lokasi, estimasi hari, assignee, deadline (editable bila canManage)
 *  - Activity: history completions + review (read-only)
 *  - Action bar bottom: lifecycle buttons (Mulai / Submit / Approve / Request Revision)
 *
 * The drawer is rendered as a right-side slide-in panel on desktop,
 * fullscreen on mobile (<sm).
 */

import { useCallback, useEffect, useState, type ReactNode } from "react";
import {
  AlertTriangle,
  Calendar,
  ChevronRight,
  Loader2,
  MapPin,
  MessageSquareWarning,
  Pencil,
  Play,
  Save,
  Send,
  Timer,
  Undo2,
  User,
  X,
} from "lucide-react";
import { workspaceApi, type Completion, type Task } from "@/lib/api/workspace";
import { StatusBadge } from "./status-badge";
import { WorkOrderReportForm } from "./wo-report-form";
import { TaskProjectPanel } from "./task-project-panel";

export interface WoDetailDrawerProps {
  operationalPanel?: ReactNode;
  projectFeatures?: boolean;
  api?: typeof workspaceApi;
  taskId: string;
  /** Optional initial data — if provided, drawer doesn't refetch on open. */
  initial?: Task;
  /** When closed, refetch parent's data — caller decides which lists to reload. */
  onClose: () => void;
  /** Permissions calculated by parent (uses useCan from permissions-provider). */
  canManage: boolean;
  canExecute: boolean;
  canReview: boolean;
  /** Optional callback when task is mutated, so caller can refresh siblings. */
  onTaskChanged?: (task: Task) => void;
  /** RPO + phase name for breadcrumb context. */
  rpoNumber?: string | null;
  phaseName?: string | null;
}

export function WoDetailDrawer({
  operationalPanel,
  projectFeatures = process.env.NEXT_PUBLIC_WORKSPACE_PROJECT_SUITE_ENABLED === "1",
  api = workspaceApi, taskId, initial, onClose,
  canManage, canExecute, canReview,
  onTaskChanged, rpoNumber, phaseName,
}: WoDetailDrawerProps) {
  const [task, setTask] = useState<Task | null>(initial ?? null);
  const [loading, setLoading] = useState(!initial);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [completions, setCompletions] = useState<Completion[]>([]);
  const [showReport, setShowReport] = useState(false);
  const [showRevisionForm, setShowRevisionForm] = useState(false);
  const [revisionNote, setRevisionNote] = useState("");

  // Form draft (when editing)
  const [draft, setDraft] = useState({
    name: "",
    description: "",
    location: "",
    estimated_days: "" as string,
    deadline: "",
  });

  const loadTask = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // Workspace API doesn't expose getTask directly — fetch via phase list.
      // Cheaper: just trust initial OR refetch later. We re-use list-tasks for the phase.
      // For now, if no `initial`, we'll be wrong — caller should always pass initial.
      // TODO: add GET /api/workspace/tasks/{id} to backend for completeness.
      if (!initial) {
        setError("Detail WO tidak dapat dimuat tanpa data awal");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Gagal memuat WO");
    } finally {
      setLoading(false);
    }
  }, [initial]);

  useEffect(() => { if (!task) void Promise.resolve().then(loadTask); }, [task, loadTask]);

  // Load completions when task exists
  useEffect(() => {
    if (!taskId) return;
    api.listCompletions(taskId).then(setCompletions).catch(() => {});
  }, [taskId, api]);

  const saveDraft = async () => {
    if (!task) return;
    setSaving(true);
    setError(null);
    try {
      const days = draft.estimated_days.trim();
      const updated = await api.updateTask(task.id, {
        name: draft.name.trim() || task.name,
        description: draft.description.trim() || null,
        location: draft.location.trim() || null,
        estimated_days: days ? parseInt(days, 10) : null,
        deadline: draft.deadline || null,
      });
      setTask(updated);
      onTaskChanged?.(updated);
      setEditing(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Gagal menyimpan");
    } finally {
      setSaving(false);
    }
  };

  const doStart = async () => {
    if (!task) return;
    try {
      const updated = await api.startTask(task.id);
      setTask(updated);
      onTaskChanged?.(updated);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Gagal memulai WO");
    }
  };

  const doApprove = async () => {
    if (!task) return;
    try {
      const updated = await api.reviewTask(task.id, { decision: "approve" });
      setTask(updated);
      onTaskChanged?.(updated);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Gagal approve");
    }
  };

  const doRequestRevision = async () => {
    if (!task) return;
    if (!revisionNote.trim()) { setError("Catatan revisi wajib diisi"); return; }
    try {
      const updated = await api.reviewTask(task.id, {
        decision: "request_revision",
        review_notes: revisionNote.trim(),
      });
      setTask(updated);
      onTaskChanged?.(updated);
      setShowRevisionForm(false);
      setRevisionNote("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Gagal request revisi");
    }
  };

  const handleReportSubmitted = (newCompletion: Completion) => {
    setCompletions((prev) => [newCompletion, ...prev]);
    if (task) {
      // Optimistic: backend transitions to pending_review
      const updated: Task = { ...task, status: "pending_review" };
      setTask(updated);
      onTaskChanged?.(updated);
    }
    setShowReport(false);
  };

  if (loading || !task) {
    return (
      <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
        <div className="surface w-full max-w-2xl mx-4 p-12 flex items-center justify-center" onClick={(e) => e.stopPropagation()}>
          <Loader2 className="size-6 animate-spin text-primary" />
        </div>
      </div>
    );
  }

  const status = task.status;
  const showStartButton = canExecute && (status === "todo" || status === "overdue");
  const showSubmitButton = canExecute && status === "in_progress";
  const showReviewButtons = canReview && status === "pending_review";

  return (
    <div className="fixed inset-0 z-50 flex justify-end animate-[fadeIn_180ms_ease]" onClick={onClose}>
      <div className="absolute inset-0 bg-[rgba(15,23,42,0.45)] backdrop-blur-[4px]" />

      <aside
        className="relative h-full w-full sm:max-w-[640px] bg-bg border-l border-border shadow-[var(--shadow-lg)] flex flex-col overflow-hidden animate-[slideInRight_220ms_cubic-bezier(0.22,1,0.36,1)]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 py-4 border-b border-border-soft shrink-0">
          <div className="flex items-start gap-3">
            <div className="flex-1 min-w-0">
              {/* Breadcrumb */}
              {(rpoNumber || phaseName) && (
                <div className="flex items-center gap-1.5 text-[11.5px] text-text-muted mb-1.5 flex-wrap min-w-0">
                  {rpoNumber && <span className="font-mono font-semibold text-primary shrink-0">{rpoNumber}</span>}
                  {rpoNumber && phaseName && <ChevronRight className="size-3 shrink-0" />}
                  {phaseName && <span className="truncate max-w-[200px]">{phaseName}</span>}
                  <ChevronRight className="size-3 shrink-0" />
                  <span className="text-text-light shrink-0">Work Order</span>
                </div>
              )}
              <div className="flex items-start gap-2 flex-wrap min-w-0">
                <h2 className="text-[16px] font-bold text-text leading-tight break-words min-w-0 flex-1" title={task.name}>
                  {editing ? (
                    <input
                      autoFocus
                      value={draft.name}
                      onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                      className="field-input"
                    />
                  ) : (task.name)}
                </h2>
                <div className="shrink-0 mt-0.5"><StatusBadge status={status} /></div>
              </div>
            </div>
            <button onClick={onClose} className="btn btn-ghost btn-icon btn-sm shrink-0">
              <X className="size-4" />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5 flex flex-col gap-5">
          {error && (
            <div className="px-3 py-2 rounded-[var(--r)] bg-red-bg text-red text-[12.5px] border border-red/20 flex items-center gap-2">
              <AlertTriangle className="size-3.5 shrink-0" />
              <span className="flex-1">{error}</span>
              <button onClick={() => setError(null)} className="text-[11px] underline">Tutup</button>
            </div>
          )}

          {/* Revision request notice — visible only when there's a revision note and status is in_progress */}
          {task.review_notes && status === "in_progress" && (
            <div className="px-3 py-2.5 rounded-[var(--r)] bg-amber-bg text-amber text-[12.5px] border border-amber/30 flex items-start gap-2">
              <MessageSquareWarning className="size-4 shrink-0 mt-0.5" />
              <div>
                <div className="font-semibold mb-0.5">Engineer minta revisi</div>
                <div className="text-text leading-relaxed">{task.review_notes}</div>
              </div>
            </div>
          )}

          {/* Detail fields */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field icon={<User className="size-3.5" />} label="Ditugaskan">
              {task.assigned_name ?? <span className="text-text-light italic">Belum di-assign</span>}
            </Field>
            <Field icon={<MapPin className="size-3.5" />} label="Lokasi">
              {editing ? (
                <input
                  value={draft.location}
                  onChange={(e) => setDraft({ ...draft, location: e.target.value })}
                  className="field-input"
                  placeholder="Lokasi pekerjaan"
                />
              ) : (task.location || <span className="text-text-light italic">—</span>)}
            </Field>
          </div>

          {/* Periode kerja — combines estimated_days + deadline (or two inputs when editing) */}
          <div>
            <div className="text-[11px] font-bold uppercase tracking-[0.06em] text-text-light mb-1.5 flex items-center gap-1.5">
              <Calendar className="size-3.5" />
              Periode Kerja
            </div>
            {editing ? (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[10.5px] font-medium text-text-muted mb-1 flex items-center gap-1">
                    <Timer className="size-3" /> Estimasi (hari)
                  </label>
                  <input
                    type="number"
                    min={1}
                    value={draft.estimated_days}
                    onChange={(e) => setDraft({ ...draft, estimated_days: e.target.value })}
                    className="field-input"
                    placeholder="—"
                  />
                </div>
                <div>
                  <label className="text-[10.5px] font-medium text-text-muted mb-1 flex items-center gap-1">
                    <Calendar className="size-3" /> Deadline (selesai)
                  </label>
                  <input
                    type="date"
                    value={draft.deadline}
                    onChange={(e) => setDraft({ ...draft, deadline: e.target.value })}
                    className="field-input"
                  />
                </div>
              </div>
            ) : (
              <PeriodeKerja deadline={task.deadline} estimatedDays={task.estimated_days} />
            )}
          </div>

          {/* Description */}
          <div>
            <div className="text-[11px] font-bold uppercase tracking-[0.06em] text-text-light mb-1.5">Deskripsi</div>
            {editing ? (
              <textarea
                value={draft.description}
                onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                className="field-input min-h-[100px] py-2 resize-y"
                placeholder="Detail scope pekerjaan…"
              />
            ) : (
              <div className="text-[13px] text-text leading-relaxed whitespace-pre-wrap">
                {task.description || <span className="text-text-light italic">Belum ada deskripsi</span>}
              </div>
            )}
          </div>

          {operationalPanel}
          {projectFeatures && <TaskProjectPanel api={api} task={task} canManage={canManage} onChanged={() => {
            void api.listTasks(task.phase_id).then((tasks) => {
              const updated = tasks.find((item) => item.id === task.id);
              if (updated) { setTask(updated); onTaskChanged?.(updated); }
            });
          }} />}

          {/* Completions / Activity */}
          {completions.length > 0 && (
            <div>
              <div className="text-[11px] font-bold uppercase tracking-[0.06em] text-text-light mb-2">Riwayat Laporan</div>
              <div className="flex flex-col gap-3">
                {completions.map((c) => (
                  <CompletionCard key={c.id} completion={c} />
                ))}
              </div>
            </div>
          )}

          {/* Revision form (inline) */}
          {showRevisionForm && (
            <div className="surface bg-amber-bg/40 border-amber/30 p-4">
              <div className="text-[12.5px] font-semibold text-text mb-2 flex items-center gap-1.5">
                <MessageSquareWarning className="size-4 text-amber" />
                Catatan Revisi
              </div>
              <textarea
                value={revisionNote}
                onChange={(e) => setRevisionNote(e.target.value)}
                className="field-input min-h-[80px] py-2 resize-y"
                placeholder="Jelaskan apa yang perlu diperbaiki — akan dilihat oleh teknisi lapangan"
                autoFocus
              />
              <div className="flex gap-2 mt-2 justify-end">
                <button onClick={() => { setShowRevisionForm(false); setRevisionNote(""); }} className="btn btn-default btn-sm">
                  Batal
                </button>
                <button onClick={doRequestRevision} className="btn btn-primary btn-sm gap-1.5" disabled={!revisionNote.trim()}>
                  <Undo2 className="size-3.5" /> Kirim Revisi
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Footer / Action bar */}
        <div className="px-5 py-3.5 border-t border-border-soft bg-bg-ctrl shrink-0 flex flex-wrap gap-2 items-center">
          {editing ? (
            <>
              <button onClick={() => setEditing(false)} className="btn btn-default btn-sm" disabled={saving}>
                Batal
              </button>
              <div className="flex-1" />
              <button onClick={saveDraft} className="btn btn-primary btn-sm gap-1.5" disabled={saving || !draft.name.trim()}>
                {saving ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />}
                {saving ? "Menyimpan…" : "Simpan"}
              </button>
            </>
          ) : (
            <>
              {canManage && (
                <button onClick={() => {
                  setDraft({ name: task.name, description: task.description ?? "", location: task.location ?? "",
                    estimated_days: task.estimated_days != null ? String(task.estimated_days) : "", deadline: task.deadline ?? "" });
                  setEditing(true);
                }} className="btn btn-default btn-sm gap-1.5">
                  <Pencil className="size-3.5" /> Edit
                </button>
              )}
              <div className="flex-1" />
              {showStartButton && (
                <button onClick={doStart} className="btn btn-primary btn-sm gap-1.5">
                  <Play className="size-3.5 fill-white" /> Mulai
                </button>
              )}
              {showSubmitButton && (
                <button onClick={() => setShowReport(true)} className="btn btn-primary btn-sm gap-1.5">
                  <Send className="size-3.5" /> Submit Laporan
                </button>
              )}
              {showReviewButtons && (
                <>
                  <button
                    onClick={() => { setShowRevisionForm(true); setRevisionNote(""); }}
                    className="btn btn-default btn-sm gap-1.5 text-amber border-amber/30 hover:bg-amber-bg hover:text-amber hover:border-amber"
                  >
                    <Undo2 className="size-3.5" /> Minta Revisi
                  </button>
                  <button onClick={doApprove} className="btn btn-primary btn-sm gap-1.5">
                    <Save className="size-3.5" /> Approve
                  </button>
                </>
              )}
            </>
          )}
        </div>
      </aside>

      {/* Report modal */}
      {showReport && task && (
        <WorkOrderReportForm api={api}
          task={task}
          onClose={() => setShowReport(false)}
          onSubmitted={handleReportSubmitted}
        />
      )}
    </div>
  );
}

function Field({ icon, label, children }: { icon?: React.ReactNode; label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[11px] font-bold uppercase tracking-[0.06em] text-text-light mb-1 flex items-center gap-1.5">
        {icon}
        {label}
      </div>
      <div className="text-[13px] text-text">{children}</div>
    </div>
  );
}

/**
 * PeriodeKerja — read-only summary of "when this work happens".
 * Combines estimated_days + deadline into a single human-readable range.
 *
 *   est=3, deadline=15 Mei  → "13 – 15 Mei 2026 · 3 hari"
 *   est=null, deadline=15   → "15 Mei 2026"
 *   est=3, deadline=null    → "Estimasi 3 hari (deadline belum ditetapkan)"
 *   neither                  → "—"
 */
function PeriodeKerja({ deadline, estimatedDays }: { deadline: string | null; estimatedDays: number | null }) {
  if (!deadline && !estimatedDays) {
    return <span className="text-text-light italic text-[13px]">Belum ditetapkan</span>;
  }
  if (!deadline && estimatedDays) {
    return (
      <div className="text-[13px] text-text">
        Estimasi <span className="font-semibold">{estimatedDays} hari</span>
        <span className="text-text-muted"> · deadline belum ditetapkan</span>
      </div>
    );
  }
  if (deadline && !estimatedDays) {
    return (
      <div className="text-[13px] text-text">
        Deadline: <span className="font-semibold">
          {new Date(deadline).toLocaleDateString("id-ID", { day: "numeric", month: "long", year: "numeric" })}
        </span>
        <span className="text-text-muted"> · estimasi belum ditetapkan</span>
      </div>
    );
  }
  // Both present — compute range
  const end = new Date(deadline as string);
  const start = new Date(end);
  start.setDate(start.getDate() - ((estimatedDays as number) - 1));
  const fmtFull = (d: Date) => d.toLocaleDateString("id-ID", { day: "numeric", month: "long", year: "numeric" });
  const fmtShort = (d: Date) => d.toLocaleDateString("id-ID", { day: "numeric", month: "short" });
  const sameMonth = start.getMonth() === end.getMonth() && start.getFullYear() === end.getFullYear();
  const rangeText = (estimatedDays as number) === 1
    ? fmtFull(end)
    : sameMonth
      ? `${start.getDate()} – ${fmtFull(end)}`
      : `${fmtShort(start)} – ${fmtFull(end)}`;
  return (
    <div className="text-[13px] text-text">
      <span className="font-semibold">{rangeText}</span>
      <span className="text-text-muted"> · {estimatedDays} hari</span>
    </div>
  );
}

function CompletionCard({ completion }: { completion: Completion }) {
  const allPhotos = [
    ...(completion.photos_before ?? []).map((u) => ({ url: u, tag: "Sebelum" as const })),
    ...(completion.photos_after  ?? []).map((u) => ({ url: u, tag: "Sesudah" as const })),
    ...(completion.photo_url ? [{ url: completion.photo_url, tag: null }] : []),
  ];
  return (
    <div className="surface p-3.5">
      <div className="flex items-center justify-between gap-2 mb-2">
        <div className="text-[12px] font-semibold text-text">
          {completion.submitted_name ?? "Anonim"}
        </div>
        <div className="text-[11px] text-text-muted">
          {new Date(completion.completed_at).toLocaleString("id-ID", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
        </div>
      </div>
      {completion.notes && (
        <div className="text-[12.5px] text-text leading-relaxed mb-2 whitespace-pre-wrap">
          {completion.notes}
        </div>
      )}
      {allPhotos.length > 0 && (
        <div className="grid grid-cols-3 sm:grid-cols-4 gap-1.5">
          {allPhotos.map((p, i) => (
            <a key={i} href={p.url} target="_blank" rel="noreferrer" className="relative aspect-square rounded-[var(--r-sm)] overflow-hidden border border-border hover:border-primary group">
              {/* Using img not Image since photos may be external URLs */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={p.url} alt={`Foto ${i + 1}`} className="size-full object-cover" />
              {p.tag && (
                <span className="absolute bottom-1 left-1 px-1.5 py-0.5 rounded text-[9px] font-bold bg-black/60 text-white">
                  {p.tag}
                </span>
              )}
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
