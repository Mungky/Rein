import { useState } from "react";
import { Loader2, X, Check } from "lucide-react";
import { workspaceApi } from "@/lib/api/workspace";
import type { Task } from "@/lib/api/workspace";

export function CompleteTaskModal({ task, onClose, onDone }: {
  task: Task;
  onClose: () => void;
  onDone: () => void;
}) {
  const [notes, setNotes] = useState("");
  const [photoUrl, setPhotoUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setLoading(true);
    setError(null);
    try {
      await workspaceApi.completeTask(task.id, {
        notes: notes.trim() || undefined,
        photo_url: photoUrl.trim() || undefined,
      });
      onDone();
    } catch {
      setError("Gagal menyimpan. Coba lagi.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 p-4">
      <div className="bg-bg border border-border rounded-xl w-full max-w-sm shadow-xl">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <span className="text-[13px] font-bold">Kirim untuk Review</span>
          <button onClick={onClose} className="p-1 rounded hover:bg-bg-hover">
            <X className="w-4 h-4 text-text-muted" />
          </button>
        </div>
        <div className="p-4 flex flex-col gap-3">
          <div className="text-[12px] text-text-muted">Laporan akan dikirim untuk persetujuan. Task: <span className="font-semibold text-text">{task.name}</span></div>
          <div>
            <label className="text-[11px] font-bold text-text-muted uppercase tracking-wider block mb-1">Catatan laporan</label>
            <textarea
              className="w-full border border-border rounded-lg px-3 py-2 text-[12.5px] bg-bg text-text resize-none focus:outline-none focus:ring-1 focus:ring-primary"
              rows={3}
              placeholder="Ceritakan singkat apa yang sudah dikerjakan..."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>
          <div>
            <label className="text-[11px] font-bold text-text-muted uppercase tracking-wider block mb-1">Link Foto (opsional)</label>
            <input
              className="w-full border border-border rounded-lg px-3 py-2 text-[12.5px] bg-bg text-text focus:outline-none focus:ring-1 focus:ring-primary"
              placeholder="URL foto dari Google Drive..."
              value={photoUrl}
              onChange={(e) => setPhotoUrl(e.target.value)}
            />
          </div>
          {error && <div className="text-[11.5px] text-red-500">{error}</div>}
          <button
            onClick={submit}
            disabled={loading}
            className="btn btn-primary w-full flex items-center justify-center gap-2 mt-1"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
            {loading ? "Menyimpan..." : "Kirim untuk Review"}
          </button>
        </div>
      </div>
    </div>
  );
}
