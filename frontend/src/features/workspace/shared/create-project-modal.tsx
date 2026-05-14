import { useState } from "react";
import { Loader2, X, Plus } from "lucide-react";
import { workspaceApi } from "@/lib/api/workspace";
import type { ProjectTemplate } from "@/lib/api/workspace";

export function CreateProjectModal({ templates, onClose, onCreated }: {
  templates: ProjectTemplate[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const [name, setName] = useState("");
  const [clientName, setClientName] = useState("");
  const [templateId, setTemplateId] = useState("");
  const [startDate, setStartDate] = useState("");
  const [deadline, setDeadline] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setLoading(true);
    setError(null);
    try {
      await workspaceApi.createProject({
        name: name.trim(),
        client_name: clientName.trim() || undefined,
        template_id: templateId || undefined,
        start_date: startDate || undefined,
        deadline: deadline || undefined,
      });
      onCreated();
    } catch {
      setError("Gagal membuat proyek.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 p-4">
      <form onSubmit={submit} className="bg-bg border border-border rounded-xl w-full max-w-sm shadow-xl">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <span className="text-[13px] font-bold">Proyek Baru</span>
          <button type="button" onClick={onClose} className="p-1 rounded hover:bg-bg-hover">
            <X className="w-4 h-4 text-text-muted" />
          </button>
        </div>
        <div className="p-4 flex flex-col gap-3">
          <div>
            <label className="text-[11px] font-bold text-text-muted uppercase tracking-wider block mb-1">Nama Proyek *</label>
            <input
              required
              className="w-full border border-border rounded-lg px-3 py-2 text-[12.5px] bg-bg text-text focus:outline-none focus:ring-1 focus:ring-primary"
              placeholder="Nama proyek..."
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div>
            <label className="text-[11px] font-bold text-text-muted uppercase tracking-wider block mb-1">Nama Klien</label>
            <input
              className="w-full border border-border rounded-lg px-3 py-2 text-[12.5px] bg-bg text-text focus:outline-none focus:ring-1 focus:ring-primary"
              placeholder="Nama klien (opsional)..."
              value={clientName}
              onChange={(e) => setClientName(e.target.value)}
            />
          </div>
          {templates.length > 0 && (
            <div>
              <label className="text-[11px] font-bold text-text-muted uppercase tracking-wider block mb-1">Template</label>
              <select
                className="w-full border border-border rounded-lg px-3 py-2 text-[12.5px] bg-bg text-text focus:outline-none focus:ring-1 focus:ring-primary"
                value={templateId}
                onChange={(e) => setTemplateId(e.target.value)}
              >
                <option value="">-- Tanpa template --</option>
                {templates.map((t) => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
              {templateId && (
                <div className="text-[10.5px] text-text-muted mt-1">
                  Phase & task akan dibuat otomatis dari template.
                </div>
              )}
            </div>
          )}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-[11px] font-bold text-text-muted uppercase tracking-wider block mb-1">Mulai</label>
              <input type="date" className="w-full border border-border rounded-lg px-3 py-2 text-[12.5px] bg-bg text-text focus:outline-none focus:ring-1 focus:ring-primary"
                value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            </div>
            <div>
              <label className="text-[11px] font-bold text-text-muted uppercase tracking-wider block mb-1">Deadline</label>
              <input type="date" className="w-full border border-border rounded-lg px-3 py-2 text-[12.5px] bg-bg text-text focus:outline-none focus:ring-1 focus:ring-primary"
                value={deadline} onChange={(e) => setDeadline(e.target.value)} />
            </div>
          </div>
          {error && <div className="text-[11.5px] text-red-500">{error}</div>}
          <button
            type="submit"
            disabled={loading || !name.trim()}
            className="btn btn-primary w-full flex items-center justify-center gap-2 mt-1"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
            {loading ? "Membuat..." : "Buat Proyek"}
          </button>
        </div>
      </form>
    </div>
  );
}