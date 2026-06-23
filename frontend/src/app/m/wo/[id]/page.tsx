"use client";

/**
 * Mobile WO Detail — fullscreen page optimized for field worker phone.
 *
 * Workflow:
 *   - View detail (name, description, location, deadline)
 *   - Tap "Mulai" → status in_progress
 *   - Tap "Selesai" → open photo+notes report form
 *   - Submit report → status pending_review, return to list
 */

import { useEffect, useState, use as useUnwrap } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import {
  AlertTriangle, ArrowLeft, Calendar, Camera, ClipboardCheck,
  Clock, FileText, Loader2, MapPin, Play, Send, Timer, Trash2,
  User as UserIcon,
} from "lucide-react";
import { workspaceApi } from "@/lib/api/workspace";
import type { Completion, Task } from "@/lib/api/workspace";
import { uploadWorkspacePhoto } from "@/lib/api/workspace-storage";
import { useAuth } from "@/hooks/use-auth";

export default function MobileWoDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = useUnwrap(params);
  const router = useRouter();
  const { loading: authLoading, profile } = useAuth();

  const [task, setTask] = useState<Task | null>(null);
  const [completions, setCompletions] = useState<Completion[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reportMode, setReportMode] = useState(false);

  // Report form state
  const [photosBefore, setPhotosBefore] = useState<string[]>([]);
  const [photosAfter, setPhotosAfter] = useState<string[]>([]);
  const [notes, setNotes] = useState("");

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      // No GET /tasks/{id} — fetch via myTasks list & find
      const list = await workspaceApi.myTasks();
      const found = list.find((t) => t.id === id);
      if (!found) {
        setError("WO tidak ditemukan atau bukan ditugaskan ke Anda");
        setTask(null);
      } else {
        setTask(found);
      }
      // Completions are public-read for workspace:view
      try {
        const cs = await workspaceApi.listCompletions(id);
        setCompletions(cs);
      } catch { /* silent */ }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Gagal memuat WO");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!authLoading && profile) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, profile, id]);

  if (authLoading || loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-bg-ctrl">
        <Loader2 className="size-7 animate-spin text-primary" />
      </div>
    );
  }

  if (!task) {
    return (
      <div className="min-h-screen flex flex-col">
        <header className="sticky top-0 z-30 bg-bg border-b border-border-soft px-4 h-14 flex items-center gap-3">
          <button onClick={() => router.push("/m/wo")} className="btn btn-ghost btn-icon size-10">
            <ArrowLeft className="size-5" />
          </button>
          <span className="text-[14px] font-bold text-text">Tidak ditemukan</span>
        </header>
        <div className="flex-1 flex items-center justify-center px-6 text-center text-text-muted">
          {error ?? "WO tidak tersedia"}
        </div>
      </div>
    );
  }

  // Status flags for the action area
  const isTodo = task.status === "todo";
  const isInProgress = task.status === "in_progress";
  const isPendingReview = task.status === "pending_review";
  const isDone = task.status === "done";

  const doStart = async () => {
    setBusy(true);
    setError(null);
    try {
      const updated = await workspaceApi.startTask(task.id);
      setTask(updated);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Gagal memulai");
    } finally {
      setBusy(false);
    }
  };

  const doSubmit = async () => {
    if (photosBefore.length === 0 && photosAfter.length === 0 && !notes.trim()) {
      setError("Tambahkan minimal satu foto atau catatan.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const c = await workspaceApi.submitReport(task.id, {
        photos_before: photosBefore,
        photos_after: photosAfter,
        notes: notes.trim() || undefined,
      });
      setCompletions((prev) => [c, ...prev]);
      setTask({ ...task, status: "pending_review" });
      setReportMode(false);
      // Reset form
      setPhotosBefore([]);
      setPhotosAfter([]);
      setNotes("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Gagal submit laporan");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col pb-24">
      {/* Sticky header */}
      <header className="sticky top-0 z-30 bg-bg border-b border-border-soft px-3 h-14 flex items-center gap-2">
        <button
          onClick={() => router.push("/m/wo")}
          className="btn btn-ghost btn-icon size-10"
          aria-label="Kembali"
        >
          <ArrowLeft className="size-5" />
        </button>
        <span className="text-[13px] font-bold text-text truncate flex-1">Work Order</span>
        <div className="relative size-8 shrink-0">
          <Image src="/rein-logo.png" alt="REIN" fill sizes="32px" className="object-contain" />
        </div>
      </header>

      {/* Body */}
      <main className="flex-1 px-4 py-4 flex flex-col gap-4">
        {/* Status pill */}
        <StatusPill status={task.status} />

        {/* Revision request notice */}
        {task.review_notes && isInProgress && (
          <div className="px-3 py-3 rounded-[var(--r)] bg-amber-bg text-text border border-amber/30 flex items-start gap-2">
            <AlertTriangle className="size-4 shrink-0 mt-0.5 text-amber" />
            <div>
              <div className="font-semibold text-[13px] text-amber mb-0.5">Engineer minta revisi</div>
              <div className="text-[12.5px] leading-relaxed">{task.review_notes}</div>
            </div>
          </div>
        )}

        {/* Title */}
        <h1 className="text-[20px] font-bold text-text leading-tight">{task.name}</h1>

        {/* Meta */}
        <div className="surface p-3.5 flex flex-col gap-3">
          {task.location && (
            <MetaRow icon={<MapPin className="size-4" />} label="Lokasi">
              {task.location}
            </MetaRow>
          )}
          {task.deadline && (
            <MetaRow icon={<Calendar className="size-4" />} label="Deadline">
              {new Date(task.deadline).toLocaleDateString("id-ID", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}
            </MetaRow>
          )}
          {task.estimated_days != null && (
            <MetaRow icon={<Timer className="size-4" />} label="Estimasi">
              {task.estimated_days} hari
            </MetaRow>
          )}
          {task.assigned_name && (
            <MetaRow icon={<UserIcon className="size-4" />} label="Ditugaskan">
              {task.assigned_name}
            </MetaRow>
          )}
        </div>

        {/* Description */}
        {task.description && (
          <div className="surface p-3.5">
            <div className="text-[11px] font-bold uppercase tracking-[0.06em] text-text-light mb-1.5 flex items-center gap-1.5">
              <FileText className="size-3.5" /> Deskripsi
            </div>
            <div className="text-[13.5px] text-text leading-relaxed whitespace-pre-wrap">
              {task.description}
            </div>
          </div>
        )}

        {/* Report form (inline when active) */}
        {reportMode && (
          <ReportForm
            taskId={task.id}
            photosBefore={photosBefore}
            photosAfter={photosAfter}
            notes={notes}
            onPhotosBeforeChange={setPhotosBefore}
            onPhotosAfterChange={setPhotosAfter}
            onNotesChange={setNotes}
            onError={setError}
          />
        )}

        {/* Completions history */}
        {completions.length > 0 && !reportMode && (
          <div>
            <div className="text-[11px] font-bold uppercase tracking-[0.06em] text-text-light mb-2 px-1">
              Riwayat Laporan
            </div>
            <div className="flex flex-col gap-2">
              {completions.map((c) => (
                <CompletionCard key={c.id} completion={c} />
              ))}
            </div>
          </div>
        )}

        {error && (
          <div className="px-3 py-2.5 rounded-[var(--r)] bg-red-bg text-red text-[13px] border border-red/20">
            {error}
          </div>
        )}
      </main>

      {/* Sticky action footer */}
      <footer className="fixed bottom-0 left-0 right-0 z-30 bg-bg border-t border-border-soft px-4 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] flex gap-2 shadow-[0_-2px_8px_rgba(0,0,0,0.05)]">
        {isTodo && (
          <button
            onClick={doStart}
            disabled={busy}
            className="btn btn-primary btn-lg flex-1 gap-2"
          >
            {busy ? <Loader2 className="size-5 animate-spin" /> : <Play className="size-5 fill-white" />}
            {busy ? "Memulai…" : "Mulai Kerjakan"}
          </button>
        )}
        {isInProgress && !reportMode && (
          <button
            onClick={() => setReportMode(true)}
            className="btn btn-primary btn-lg flex-1 gap-2"
          >
            <Send className="size-5" />
            Selesai &amp; Kirim Laporan
          </button>
        )}
        {isInProgress && reportMode && (
          <>
            <button
              onClick={() => { setReportMode(false); setError(null); }}
              className="btn btn-default btn-lg"
              disabled={busy}
            >
              Batal
            </button>
            <button
              onClick={doSubmit}
              disabled={busy}
              className="btn btn-primary btn-lg flex-1 gap-2"
            >
              {busy ? <Loader2 className="size-5 animate-spin" /> : <Send className="size-5" />}
              {busy ? "Mengirim…" : "Submit Laporan"}
            </button>
          </>
        )}
        {isPendingReview && (
          <div className="flex-1 text-center py-3 text-[13.5px] font-semibold text-amber flex items-center justify-center gap-2">
            <ClipboardCheck className="size-5" />
            Menunggu review engineer
          </div>
        )}
        {isDone && (
          <div className="flex-1 text-center py-3 text-[13.5px] font-semibold text-green flex items-center justify-center gap-2">
            <ClipboardCheck className="size-5" />
            WO sudah selesai &amp; di-approve
          </div>
        )}
      </footer>
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const info = {
    "todo":           { label: "Belum mulai",      Icon: Clock,          cls: "bg-bg-ctrl text-text-muted border-border" },
    "in_progress":    { label: "Sedang dikerjakan", Icon: Clock,          cls: "bg-blue-bg text-blue border-blue/30" },
    "pending_review": { label: "Menunggu review",  Icon: ClipboardCheck, cls: "bg-amber-bg text-amber border-amber/30" },
    "done":           { label: "Selesai",          Icon: ClipboardCheck, cls: "bg-green-bg text-green border-green/30" },
    "overdue":        { label: "Terlambat",        Icon: AlertTriangle,  cls: "bg-red-bg text-red border-red/30" },
  }[status] ?? { label: status, Icon: Clock, cls: "bg-bg-ctrl text-text-muted border-border" };

  return (
    <div className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border self-start ${info.cls}`}>
      <info.Icon className="size-3.5" />
      <span className="text-[12px] font-semibold">{info.label}</span>
    </div>
  );
}

function MetaRow({ icon, label, children }: { icon: React.ReactNode; label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2.5">
      <div className="size-8 rounded-full bg-primary-soft text-primary flex items-center justify-center shrink-0">
        {icon}
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-[10.5px] font-bold uppercase tracking-[0.06em] text-text-light">{label}</div>
        <div className="text-[13.5px] text-text">{children}</div>
      </div>
    </div>
  );
}

interface ReportFormProps {
  taskId: string;
  photosBefore: string[];
  photosAfter: string[];
  notes: string;
  onPhotosBeforeChange: (next: string[]) => void;
  onPhotosAfterChange: (next: string[]) => void;
  onNotesChange: (next: string) => void;
  onError: (err: string) => void;
}

function ReportForm({
  taskId, photosBefore, photosAfter, notes,
  onPhotosBeforeChange, onPhotosAfterChange, onNotesChange, onError,
}: ReportFormProps) {
  return (
    <div className="surface p-4 flex flex-col gap-4 border-primary/30 ring-1 ring-primary/20">
      <div className="text-[12px] font-bold uppercase tracking-[0.06em] text-primary">
        Laporan Penyelesaian
      </div>

      <PhotoGroup
        label="Foto Sebelum"
        photos={photosBefore}
        onChange={onPhotosBeforeChange}
        onError={onError}
        taskId={taskId}
      />
      <PhotoGroup
        label="Foto Sesudah"
        photos={photosAfter}
        onChange={onPhotosAfterChange}
        onError={onError}
        taskId={taskId}
      />

      <div>
        <label className="text-[12px] font-semibold text-text-muted mb-1.5 block">
          Catatan Lapangan
        </label>
        <textarea
          value={notes}
          onChange={(e) => onNotesChange(e.target.value)}
          className="field-input min-h-[120px] py-3 resize-y text-[14px]"
          placeholder="Tulis kondisi pekerjaan, kendala, atau yang perlu dicek ulang…"
          maxLength={2000}
        />
        <div className="text-[10.5px] text-text-light mt-1 text-right tabular-nums">
          {notes.length} / 2000
        </div>
      </div>
    </div>
  );
}

function PhotoGroup({
  label, photos, onChange, onError, taskId,
}: {
  label: string;
  photos: string[];
  onChange: (next: string[]) => void;
  onError: (err: string) => void;
  taskId: string;
}) {
  const [uploading, setUploading] = useState(false);

  const handleFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setUploading(true);
    try {
      const uploaded: string[] = [];
      for (const file of Array.from(files)) {
        if (!file.type.startsWith("image/")) {
          onError(`File "${file.name}" bukan gambar`);
          continue;
        }
        if (file.size > 8 * 1024 * 1024) {
          onError(`File "${file.name}" lebih dari 8MB`);
          continue;
        }
        const url = await uploadWorkspacePhoto(file, taskId);
        uploaded.push(url);
      }
      if (uploaded.length > 0) onChange([...photos, ...uploaded]);
    } catch (e) {
      onError(e instanceof Error ? e.message : "Gagal upload");
    } finally {
      setUploading(false);
    }
  };

  return (
    <div>
      <div className="flex items-baseline justify-between mb-2">
        <label className="text-[13px] font-semibold text-text">
          {label} <span className="text-text-muted font-normal">({photos.length})</span>
        </label>
      </div>
      <div className="grid grid-cols-3 gap-2">
        {photos.map((url, i) => (
          <div key={i} className="relative aspect-square rounded-[var(--r-sm)] overflow-hidden border border-border bg-bg-ctrl group">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={url} alt={`${label} ${i + 1}`} className="size-full object-cover" />
            <button
              type="button"
              onClick={() => onChange(photos.filter((_, idx) => idx !== i))}
              className="absolute top-1 right-1 size-7 rounded-full bg-black/60 text-white flex items-center justify-center"
              aria-label="Hapus"
            >
              <Trash2 className="size-3.5" />
            </button>
          </div>
        ))}
        <label className="aspect-square rounded-[var(--r-sm)] border-2 border-dashed border-border hover:border-primary transition-colors flex flex-col items-center justify-center gap-1 text-text-muted cursor-pointer">
          <input
            type="file"
            accept="image/*"
            capture="environment"
            multiple
            className="hidden"
            disabled={uploading}
            onChange={(e) => { handleFiles(e.target.files); e.target.value = ""; }}
          />
          {uploading ? <Loader2 className="size-5 animate-spin" /> : (
            <>
              <Camera className="size-6" />
              <span className="text-[11px] font-medium">Foto</span>
            </>
          )}
        </label>
      </div>
    </div>
  );
}

function CompletionCard({ completion }: { completion: Completion }) {
  const allPhotos = [
    ...(completion.photos_before ?? []).map((u) => ({ url: u, tag: "Sebelum" as const })),
    ...(completion.photos_after ?? []).map((u) => ({ url: u, tag: "Sesudah" as const })),
    ...(completion.photo_url ? [{ url: completion.photo_url, tag: null }] : []),
  ];
  return (
    <div className="surface p-3.5">
      <div className="flex items-center justify-between gap-2 mb-2">
        <div className="text-[12.5px] font-semibold text-text">
          {completion.submitted_name ?? "Anonim"}
        </div>
        <div className="text-[10.5px] text-text-muted tabular-nums">
          {new Date(completion.completed_at).toLocaleString("id-ID", {
            day: "numeric", month: "short",
            hour: "2-digit", minute: "2-digit",
          })}
        </div>
      </div>
      {completion.notes && (
        <div className="text-[12.5px] text-text leading-relaxed mb-2 whitespace-pre-wrap">
          {completion.notes}
        </div>
      )}
      {allPhotos.length > 0 && (
        <div className="grid grid-cols-3 gap-1.5">
          {allPhotos.map((p, i) => (
            <a key={i} href={p.url} target="_blank" rel="noreferrer" className="relative aspect-square rounded-[var(--r-sm)] overflow-hidden border border-border">
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
