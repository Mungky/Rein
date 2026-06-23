"use client";

/**
 * Work Order Report Form — field worker submits before+after photos & notes.
 *
 * Photo input model: in Iterasi 1-2 we accept pasted URLs (Google Drive,
 * Supabase Storage, Imgur, etc.). In Iterasi 5 (mobile route) we'll wire
 * native camera capture + direct upload to Supabase Storage `workspace-photos`.
 *
 * Status transition: in_progress → pending_review (backend handles this).
 */

import { useState } from "react";
import { Camera, Loader2, Send, Trash2, X } from "lucide-react";
import { workspaceApi, type Completion, type Task } from "@/lib/api/workspace";
import { uploadWorkspacePhoto } from "@/lib/api/workspace-storage";

interface Props {
  task: Task;
  onClose: () => void;
  onSubmitted: (c: Completion) => void;
}

export function WorkOrderReportForm({ task, onClose, onSubmitted }: Props) {
  const [photosBefore, setPhotosBefore] = useState<string[]>([]);
  const [photosAfter, setPhotosAfter] = useState<string[]>([]);
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async () => {
    if (photosBefore.length === 0 && photosAfter.length === 0 && !notes.trim()) {
      setError("Tambahkan minimal satu foto atau catatan.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const result = await workspaceApi.submitReport(task.id, {
        photos_before: photosBefore,
        photos_after: photosAfter,
        notes: notes.trim() || undefined,
      });
      onSubmitted(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Gagal submit laporan");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal-panel max-w-xl flex flex-col max-h-[92vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 py-4 border-b border-border-soft flex items-start gap-3 shrink-0">
          <div className="size-10 rounded-[var(--r-lg)] bg-gradient-to-br from-primary to-primary-hover text-white flex items-center justify-center shrink-0 shadow-[0_2px_8px_rgba(37,99,235,0.25)]">
            <Send className="size-5" />
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-[16px] font-bold text-text leading-tight">Laporan Penyelesaian</h2>
            <p className="text-[12px] text-text-muted mt-0.5 truncate">
              {task.name}
            </p>
          </div>
          <button onClick={onClose} className="btn btn-ghost btn-icon btn-sm">
            <X className="size-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5 flex flex-col gap-5">
          <PhotoGroup
            label="Foto Sebelum"
            description="Kondisi sebelum mulai dikerjakan"
            photos={photosBefore}
            onChange={setPhotosBefore}
            onError={setError}
            taskId={task.id}
          />
          <PhotoGroup
            label="Foto Sesudah"
            description="Hasil setelah selesai"
            photos={photosAfter}
            onChange={setPhotosAfter}
            onError={setError}
            taskId={task.id}
          />

          <div>
            <label className="text-[12px] font-semibold text-text-muted mb-1.5 block">
              Catatan Lapangan
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="field-input min-h-[100px] py-2 resize-y"
              placeholder="Catat detail pekerjaan, kendala, atau hal yang perlu di-follow-up oleh engineer…"
              maxLength={2000}
            />
            <div className="text-[10.5px] text-text-light mt-1 text-right tabular-nums">
              {notes.length} / 2000
            </div>
          </div>

          {error && (
            <div className="px-3 py-2 rounded-[var(--r)] bg-red-bg text-red text-[12.5px] border border-red/20">
              {error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3.5 border-t border-border-soft bg-bg-ctrl shrink-0 flex gap-2 justify-end">
          <button onClick={onClose} className="btn btn-default" disabled={submitting}>
            Batal
          </button>
          <button
            onClick={handleSubmit}
            disabled={submitting}
            className="btn btn-primary gap-1.5"
          >
            {submitting ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
            {submitting ? "Mengirim…" : "Submit Laporan"}
          </button>
        </div>
      </div>
    </div>
  );
}

interface PhotoGroupProps {
  label: string;
  description: string;
  photos: string[];
  onChange: (next: string[]) => void;
  onError: (err: string) => void;
  taskId: string;
}

function PhotoGroup({ label, description, photos, onChange, onError, taskId }: PhotoGroupProps) {
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
          onError(`File "${file.name}" melebihi 8MB`);
          continue;
        }
        const url = await uploadWorkspacePhoto(file, taskId);
        uploaded.push(url);
      }
      if (uploaded.length > 0) onChange([...photos, ...uploaded]);
    } catch (e) {
      onError(e instanceof Error ? e.message : "Gagal upload foto");
    } finally {
      setUploading(false);
    }
  };

  const remove = (idx: number) => {
    onChange(photos.filter((_, i) => i !== idx));
  };

  return (
    <div>
      <div className="flex items-baseline justify-between mb-2">
        <label className="text-[12px] font-semibold text-text">
          {label}
          <span className="ml-1.5 text-text-light font-normal">({photos.length})</span>
        </label>
        <span className="text-[11px] text-text-muted">{description}</span>
      </div>

      <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
        {photos.map((url, i) => (
          <div key={i} className="relative aspect-square rounded-[var(--r-sm)] overflow-hidden border border-border bg-bg-ctrl group">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={url} alt={`${label} ${i + 1}`} className="size-full object-cover" />
            <button
              type="button"
              onClick={() => remove(i)}
              className="absolute top-1 right-1 size-6 rounded-full bg-black/60 text-white opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red flex items-center justify-center"
              title="Hapus foto"
            >
              <Trash2 className="size-3" />
            </button>
          </div>
        ))}

        {/* Upload tile */}
        <label className="aspect-square rounded-[var(--r-sm)] border-2 border-dashed border-border hover:border-primary hover:bg-primary-soft transition-colors cursor-pointer flex flex-col items-center justify-center gap-1 text-text-muted hover:text-primary">
          <input
            type="file"
            accept="image/*"
            capture="environment"
            multiple
            className="hidden"
            disabled={uploading}
            onChange={(e) => {
              handleFiles(e.target.files);
              e.target.value = ""; // reset so same file can be re-selected
            }}
          />
          {uploading ? (
            <Loader2 className="size-5 animate-spin" />
          ) : (
            <>
              <Camera className="size-5" />
              <span className="text-[10.5px] font-medium">Tambah Foto</span>
            </>
          )}
        </label>
      </div>
    </div>
  );
}
