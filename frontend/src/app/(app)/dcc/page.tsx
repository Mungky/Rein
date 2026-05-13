"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { FileText, Clock, Upload, Send, CheckCircle, AlertCircle, Loader2 } from "lucide-react";
import { useChatStream } from "@/hooks/use-chat-stream";
import { useAuthDisplay } from "@/hooks/use-auth";
import { dccActivityApi, type DccActivityEntry } from "@/lib/api/dcc-activity";
import { PageGuard } from "@/components/guards/page-guard";
import { uploadApi } from "@/lib/api/upload";
import { clientsApi, projectsApi } from "@/lib/api/clients";
import { accessApi } from "@/lib/api/access";

// ── Allowed file types ──
const ALLOWED_EXTENSIONS = new Set([".docx", ".xlsx", ".pptx", ".pdf", ".zip", ".rar", ".dwg", ".step", ".stp"]);
const EXT_LABEL = "PDF, Word (.docx), Excel (.xlsx), PowerPoint (.pptx), ZIP, RAR, DWG, STEP (.step/.stp)";
const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50 MB

function validateFile(file: File): string | null {
  const name = file.name.toLowerCase();
  const dot = name.lastIndexOf(".");
  if (dot === -1) {
    return `File "${file.name}" tidak memiliki ekstensi. Format yang diterima: ${EXT_LABEL}`;
  }
  const ext = name.slice(dot);
  if (!ALLOWED_EXTENSIONS.has(ext)) {
    return `File ${ext} tidak didukung. Format yang diterima: ${EXT_LABEL}`;
  }
  if (file.size > MAX_FILE_SIZE) {
    return `File terlalu besar (${(file.size / (1024 * 1024)).toFixed(1)}MB). Maksimal 50MB.`;
  }
  if (file.size === 0) {
    return "File kosong.";
  }
  return null;
}

type UploadState =
  | { phase: "idle" }
  | { phase: "uploading"; file: File; progress: string }
  | { phase: "indexing"; file: File }
  | { phase: "success"; file: File; gdriveLink: string | null; timestamp: string }
  | { phase: "error"; file: File; message: string };

// ── Welcome message ──
const WELCOME_MSG: MsgType = {
  id: "welcome",
  type: "assistant",
  time: new Date().toLocaleTimeString("id", { hour: "2-digit", minute: "2-digit" }),
  text: "Halo! Saya Nimbus, asisten Document Control Anda. Saya dapat membantu mencari dokumen, mengunggah file ke arsip Google Drive, atau mengelola approval. Apa yang bisa saya bantu hari ini?",
};

type MsgType =
  | { id: string; type: "user"; time: string; text: string }
  | { id: string; type: "assistant"; time: string; text: string }
  | { id: string; type: "tool-call"; time: string; tool: string; args: Record<string, string> }
  | { id: string; type: "search-results"; time: string; results: { id: string; name: string; client: string; project: string; date: string; size: string }[] }
  | { id: string; type: "proposal"; time: string; status: string; file: { name: string; size: string }; proposalId: string; detected?: Record<string, { value: string; label?: string; code?: string; confidence?: number }> };

const DOC_TYPES = [
  { value: "DRW", label: "DRW — Gambar Teknik" },
  { value: "INV", label: "INV — Invoice" },
  { value: "PO", label: "PO — Purchase Order" },
  { value: "SPK", label: "SPK — Surat Perintah Kerja" },
  { value: "RFP", label: "RFP — Request for Proposal" },
  { value: "RPT", label: "RPT — Report" },
  { value: "SPEC", label: "SPEC — Spesifikasi" },
  { value: "OTHER", label: "OTHER — Lainnya" },
];

// ── Riwayat helpers ──
const ACTION_LABELS: Record<string, string> = {
  upload:         "Unggah",
  access_request: "Unduh",
};

const ROLE_COLORS: Record<string, string> = {
  admin:                "text-red bg-red-bg",
  director:             "text-primary bg-primary-bg",
  manager:              "text-primary bg-primary-bg",
  operational_manager:  "text-primary bg-primary-bg",
  finance:              "text-green bg-green-bg",
  accounting:           "text-green bg-green-bg",
  human_resources:      "text-amber bg-amber-bg",
  purchasing:           "text-amber bg-amber-bg",
  engineer_mechanical:  "text-blue bg-blue-bg",
  engineer_process:     "text-blue bg-blue-bg",
  engineer_electrical:  "text-blue bg-blue-bg",
};

function relTime(ts: string): string {
  const diff = Math.floor((Date.now() - new Date(ts).getTime()) / 1000);
  if (diff < 60) return "Baru saja";
  if (diff < 3600) return `${Math.floor(diff / 60)} menit lalu`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} jam lalu`;
  return new Date(ts).toLocaleDateString("id", { day: "numeric", month: "short" });
}

function buildFilenameParts({ docType, clientCode, title, projectName, note, originalName }: {
  docType: string; clientCode: string; title: string; projectName: string; note: string; originalName: string;
}): { prefix: string; middle: string; suffix: string } {
  const ext = originalName.includes(".") ? "." + originalName.split(".").pop()!.toLowerCase() : "";
  const clean = (s: string) => s.replace(/[\\/:*?"<>|]/g, "").trim();
  const base = originalName.includes(".") ? originalName.split(".").slice(0, -1).join(".") : originalName;
  const prefixParts = [`${docType}-###`];
  if (clientCode) prefixParts.push(clean(clientCode));
  const middle = title ? clean(title) : clean(base);
  const suffixParts: string[] = [];
  if (projectName) suffixParts.push(clean(projectName));
  if (note) suffixParts.push(clean(note));
  return {
    prefix: prefixParts.join("-") + "-",
    middle,
    suffix: (suffixParts.length > 0 ? "-" + suffixParts.join("-") : "") + ext,
  };
}

function MessageBubble({ msg, accessMap, onAccess, onConfirm, onCancel, proposalEdits, onEditChange, clients, projects }: {
  msg: MsgType;
  accessMap: Record<string, string>;
  onAccess: (id: string, name?: string) => void;
  onConfirm: (id: string) => void;
  onCancel: (id: string) => void;
  proposalEdits: Record<string, { doc_type?: string; client_code?: string; client_name?: string; project_code?: string; project_name?: string; folder_path?: string; title?: string; note?: string }>;
  onEditChange: (proposalId: string, field: string, value: string) => void;
  clients: { id: string; code: string; name: string }[];
  projects: { id: string; code: string; name: string; client_id: string }[];
}) {
  const { userInitials } = useAuthDisplay();

  if (msg.type === "user") {
    return (
      <div className="flex gap-2.5 justify-end">
        <div className="max-w-[560px] min-w-0">
          <div className="px-3 py-2 rounded-lg rounded-tr-sm bg-primary text-white text-[13.5px] leading-relaxed">
            {msg.text}
          </div>
          <div className="text-[10.5px] text-text-light mt-1 text-right px-1">{msg.time}</div>
        </div>
        <div className="w-7 h-7 rounded bg-red-bg text-red flex items-center justify-center text-[10.5px] font-bold shrink-0 mt-0.5">
          {userInitials}
        </div>
      </div>
    );
  }

  if (msg.type === "assistant") {
    return (
      <div className="flex gap-2.5">
        <div className="w-7 h-7 rounded badge-purple flex items-center justify-center shrink-0 mt-0.5">
          <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
            <path d="M6.5 1L12 6.5 6.5 12 1 6.5z" fill="currentColor" />
          </svg>
        </div>
        <div className="max-w-[560px] min-w-0">
          <div className="px-3 py-2 rounded-lg rounded-tl-sm bg-bg border border-border text-text text-[13.5px] leading-relaxed">
            {msg.text}
          </div>
          <div className="text-[10.5px] text-text-light mt-1 px-1">{msg.time}</div>
        </div>
      </div>
    );
  }

  if (msg.type === "tool-call") {
    return (
      <div className="flex gap-2.5">
        <div className="w-7 h-7 rounded badge-purple flex items-center justify-center shrink-0 mt-0.5">
          <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
            <path d="M6.5 1L12 6.5 6.5 12 1 6.5z" fill="currentColor" />
          </svg>
        </div>
        <div>
          <div className="bg-bg-ctrl border border-border border-l-[3px] border-l-green rounded-md px-3 py-2 font-mono text-[11.5px] text-text-muted max-w-[500px]">
            <div className="text-[10px] font-bold uppercase tracking-[0.06em] text-text-light mb-1 flex items-center gap-1.5">
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.4">
                <rect x="1" y="3" width="8" height="4" rx="1" />
                <line x1="3" y1="3" x2="3" y2="7" /><line x1="7" y1="3" x2="7" y2="7" />
              </svg>
              Tool Call
            </div>
            <span className="text-green font-semibold">{msg.tool}</span>
            <span className="text-text-light">(</span>
            {Object.entries(msg.args).map(([k, v], i) => (
              <span key={k}>
                <span className="text-text-muted">{k}</span>
                <span className="text-text-light">=</span>
                <span className="text-amber">&quot;{v}&quot;</span>
                {i < Object.entries(msg.args).length - 1 && <span className="text-text-light">, </span>}
              </span>
            ))}
            <span className="text-text-light">)</span>
          </div>
          <div className="text-[10.5px] text-text-light mt-1 px-1">{msg.time}</div>
        </div>
      </div>
    );
  }

  if (msg.type === "search-results") {
    return (
      <div className="flex gap-2.5">
        <div className="w-7 h-7 rounded badge-purple flex items-center justify-center shrink-0 mt-0.5">
          <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
            <path d="M6.5 1L12 6.5 6.5 12 1 6.5z" fill="currentColor" />
          </svg>
        </div>
        <div className="max-w-[520px] min-w-0">
          <div className="bg-bg border border-border rounded-lg overflow-hidden">
            <div className="px-3.5 py-[7px] bg-bg-ctrl border-b border-border text-[10.5px] font-bold uppercase tracking-[0.06em] text-text-muted">
              {msg.results.length} Dokumen Ditemukan
            </div>
            {msg.results.map((r, i) => {
              const st = accessMap[r.id];
              return (
                <div key={r.id} className="flex items-center gap-2.5 px-3.5 py-2.5 border-b border-border-soft last:border-b-0 hover:bg-bg-hover transition-colors duration-140 cursor-pointer">
                  <div className="w-5 h-5 rounded-sm bg-bg-hover text-text-muted text-[10px] font-bold flex items-center justify-center shrink-0">
                    {i + 1}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-[12px] font-semibold font-mono truncate">{r.name}</div>
                    <div className="text-[10.5px] text-text-muted truncate">{r.client} · {r.project} · {r.date} · {r.size}</div>
                  </div>
                  {st === "pending" && <span className="px-2 py-[2px] rounded text-[11px] font-semibold bg-amber-bg text-amber">⏳ Menunggu…</span>}
                  {st === "approved" && <span className="px-2 py-[2px] rounded text-[11px] font-semibold bg-green-bg text-green">🔗 Buka Link</span>}
                  {!st && <button onClick={() => onAccess(r.id, r.name)} className="px-2 py-[2px] rounded border border-border text-text-muted text-[11px] font-semibold hover:border-primary hover:text-primary hover:bg-primary-bg transition-all duration-140 shrink-0">Minta Akses</button>}
                </div>
              );
            })}
          </div>
          <div className="text-[10.5px] text-text-light mt-1 px-1">{msg.time}</div>
        </div>
      </div>
    );
  }

  if (msg.type === "proposal") {
    const barColor = (c: number) => c >= 0.8 ? "var(--green)" : c >= 0.65 ? "var(--amber)" : "var(--red)";
    const edits = proposalEdits[msg.proposalId] || {};
    const isConfirmed = msg.status === "confirmed";

    // Resolve display values: edits override detected
    const resolvedDocType = edits.doc_type || msg.detected?.doc_type?.value || "";
    const resolvedClientCode = edits.client_code || msg.detected?.client?.code || "";
    const resolvedProjectCode = edits.project_code || msg.detected?.project?.code || "";
    const resolvedFolder = edits.folder_path || msg.detected?.folder?.value || "";

    // Filter projects by selected client
    const filteredProjects = resolvedClientCode
      ? projects.filter((p) => p.client_id === (clients.find((c) => c.code === resolvedClientCode)?.id || ""))
      : projects;

    if (isConfirmed) {
      return (
        <div className="flex gap-2.5">
          <div className="w-7 h-7 rounded badge-purple flex items-center justify-center shrink-0 mt-0.5">
            <svg width="13" height="13" viewBox="0 0 13 13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M2 7l3 3.5 6-6.5" />
            </svg>
          </div>
          <div className="bg-bg border border-border rounded-lg overflow-hidden max-w-[500px]">
            <div className="px-3 py-2.5 flex items-center gap-2 bg-green-bg">
              <svg width="13" height="13" viewBox="0 0 13 13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M2 7l3 3.5 6-6.5" />
              </svg>
              <span className="text-[13px] font-medium text-green">{msg.file.name} dikonfirmasi — sedang diunggah ke Drive</span>
            </div>
          </div>
        </div>
      );
    }

    return (
      <div className="flex gap-2.5">
        <div className="w-7 h-7 rounded badge-purple flex items-center justify-center shrink-0 mt-0.5">
          <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
            <path d="M6.5 1L12 6.5 6.5 12 1 6.5z" fill="currentColor" />
          </svg>
        </div>
        <div className="max-w-[500px]">
          <div className="bg-bg border border-border rounded-lg overflow-hidden">
            <div className="flex items-center gap-2.5 px-3.5 py-2.5 bg-bg-ctrl border-b border-border">
              <div className="w-[30px] h-[30px] rounded bg-red-bg text-red flex items-center justify-center shrink-0">
                <FileText className="w-3.5 h-3.5" />
              </div>
              <div>
                <div className="text-[12.5px] font-bold font-mono">{msg.file.name}</div>
                <div className="text-[10.5px] text-text-muted">{msg.file.size} · Menunggu konfirmasi</div>
              </div>
            </div>
            <div className="px-3.5 py-3 flex flex-col gap-2.5">
              <div className="text-[10px] font-bold uppercase tracking-[0.07em] text-text-light mb-0.5">Metadata — Edit Sebelum Konfirmasi</div>

              {/* Doc type */}
              <div>
                <div className="flex justify-between items-baseline mb-0.5">
                  <span className="text-[11px] text-text-muted">Tipe Dokumen</span>
                  {msg.detected?.doc_type && <span className="text-[11px] font-bold" style={{ color: barColor(msg.detected.doc_type.confidence ?? 0) }}>{Math.round((msg.detected.doc_type.confidence ?? 0) * 100)}%</span>}
                </div>
                <select
                  value={resolvedDocType}
                  onChange={(e) => onEditChange(msg.proposalId, "doc_type", e.target.value)}
                  className="w-full h-8 px-2 rounded border border-border bg-bg text-[13px] font-semibold text-text focus:outline-none focus:border-primary"
                >
                  <option value="">— Pilih tipe —</option>
                  {DOC_TYPES.map((dt) => (
                    <option key={dt.value} value={dt.value}>{dt.label}</option>
                  ))}
                </select>
              </div>

              {/* Client */}
              <div>
                <div className="flex justify-between items-baseline mb-0.5">
                  <span className="text-[11px] text-text-muted">Klien</span>
                  {msg.detected?.client && <span className="text-[11px] font-bold" style={{ color: barColor(msg.detected.client.confidence ?? 0) }}>{Math.round((msg.detected.client.confidence ?? 0) * 100)}%</span>}
                </div>
                <select
                  value={resolvedClientCode}
                  onChange={(e) => {
                    onEditChange(msg.proposalId, "client_code", e.target.value);
                    const selectedClient = clients.find((c) => c.code === e.target.value);
                    onEditChange(msg.proposalId, "client_name", selectedClient?.name || "");
                    // Reset project when client changes
                    onEditChange(msg.proposalId, "project_code", "");
                    onEditChange(msg.proposalId, "project_name", "");
                  }}
                  className="w-full h-8 px-2 rounded border border-border bg-bg text-[13px] font-semibold text-text focus:outline-none focus:border-primary"
                >
                  <option value="">— Pilih klien —</option>
                  {clients.map((c) => (
                    <option key={c.id} value={c.code}>{c.code} — {c.name}</option>
                  ))}
                </select>
              </div>

              {/* Project */}
              <div>
                <div className="flex justify-between items-baseline mb-0.5">
                  <span className="text-[11px] text-text-muted">Proyek</span>
                  {msg.detected?.project && <span className="text-[11px] font-bold" style={{ color: barColor(msg.detected.project.confidence ?? 0) }}>{Math.round((msg.detected.project.confidence ?? 0) * 100)}%</span>}
                </div>
                <select
                  value={resolvedProjectCode}
                  onChange={(e) => {
                    onEditChange(msg.proposalId, "project_code", e.target.value);
                    const selectedProject = projects.find((p) => p.code === e.target.value);
                    onEditChange(msg.proposalId, "project_name", selectedProject?.name || "");
                  }}
                  className="w-full h-8 px-2 rounded border border-border bg-bg text-[13px] font-semibold text-text focus:outline-none focus:border-primary"
                >
                  <option value="">— Pilih proyek —</option>
                  {filteredProjects.map((p) => (
                    <option key={p.id} value={p.code}>{p.code} — {p.name}</option>
                  ))}
                </select>
              </div>

              {/* Note / revision tag */}
              <div>
                <span className="text-[11px] text-text-muted">Note / Revisi</span>
                <input
                  type="text"
                  value={edits.note || ""}
                  onChange={(e) => onEditChange(msg.proposalId, "note", e.target.value)}
                  placeholder="rev3, draft, final, dll"
                  className="w-full h-8 px-2 rounded border border-border bg-bg text-[13px] text-text focus:outline-none focus:border-primary mt-0.5 placeholder:text-text-light"
                />
              </div>

              {/* Folder path (read-only display) */}
              {resolvedFolder && (
                <div>
                  <span className="text-[11px] text-text-muted">Folder Tujuan</span>
                  <div className="text-[12px] font-mono text-text mt-0.5">{resolvedFolder}</div>
                </div>
              )}

              {/* Editable filename middle + preview */}
              {resolvedDocType && (() => {
                const parts = buildFilenameParts({
                  docType: resolvedDocType,
                  clientCode: resolvedClientCode || "",
                  title: edits.title || "",
                  projectName: edits.project_name || msg.detected?.project?.value || "",
                  note: edits.note || "",
                  originalName: msg.file.name,
                });
                const baseName = msg.file.name.includes(".")
                  ? msg.file.name.split(".").slice(0, -1).join(".")
                  : msg.file.name;
                return (
                  <div>
                    <span className="text-[11px] text-text-muted">Nama File (bagian tengah)</span>
                    <input
                      type="text"
                      value={edits.title || ""}
                      onChange={(e) => onEditChange(msg.proposalId, "title", e.target.value)}
                      placeholder={baseName}
                      className="w-full h-8 px-2 rounded border border-border bg-bg text-[13px] font-mono text-text focus:outline-none focus:border-primary mt-0.5 placeholder:text-text-light"
                    />
                    <div className="bg-bg-ctrl border border-border rounded px-2.5 py-2 mt-1.5">
                      <div className="text-[10px] font-bold uppercase tracking-[0.06em] text-text-light mb-1">Preview nama file</div>
                      <div className="text-[11px] font-mono break-all leading-relaxed">
                        <span className="text-text-muted">{parts.prefix}</span>
                        <span className="text-text font-semibold">{parts.middle}</span>
                        <span className="text-text-muted">{parts.suffix}</span>
                      </div>
                    </div>
                  </div>
                );
              })()}
            </div>
            <div className="flex gap-2 px-3.5 py-2.5 border-t border-border">
              <button onClick={() => onCancel(msg.id)} className="btn btn-default">Batalkan</button>
              <button onClick={() => onConfirm(msg.id)} className="btn btn-primary flex-1">Konfirmasi & Unggah →</button>
            </div>
          </div>
          <div className="text-[10.5px] text-text-light mt-1 px-1">{msg.time}</div>
        </div>
      </div>
    );
  }

  return null;
}

const now = () => new Date().toLocaleTimeString("id", { hour: "2-digit", minute: "2-digit" });

function streamMsgToMsgType(msg: import("@/hooks/use-chat-stream").ChatMessage): MsgType {
  if (msg.type === "user") return { id: msg.id, type: "user" as const, time: msg.time, text: msg.text || "" };
  if (msg.type === "assistant") return { id: msg.id, type: "assistant" as const, time: msg.time, text: msg.text || "" };
  if (msg.type === "tool_call") return { id: msg.id, type: "tool-call" as const, time: msg.time, tool: msg.tool || "", args: msg.args || {} };
  if (msg.type === "search_results") return { id: msg.id, type: "search-results" as const, time: msg.time, results: msg.results || [] };
  if (msg.type === "proposal") return { id: msg.id, type: "proposal" as const, time: msg.time, status: msg.status || "pending", file: msg.file || { name: "Unknown", size: "?" }, proposalId: msg.id, detected: msg.detected || {} };
  return { id: msg.id, type: "assistant" as const, time: msg.time, text: msg.text || "" };
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function DCCPage() {
  const { messages: streamMsgs, isStreaming, send: streamSend } = useChatStream();
  const { username } = useAuthDisplay();
  const [msgs, setMsgs] = useState<MsgType[]>([WELCOME_MSG]);
  const [riwayat, setRiwayat] = useState<DccActivityEntry[]>([]);
  const [input, setInput] = useState("");
  const [accessMap, setAccessMap] = useState<Record<string, string>>({});
  const [dragOver, setDragOver] = useState(false);
  const [uploadState, setUploadState] = useState<UploadState>({ phase: "idle" });
  const [proposalEdits, setProposalEdits] = useState<Record<string, { doc_type?: string; client_code?: string; client_name?: string; project_code?: string; project_name?: string; folder_path?: string; title?: string; note?: string }>>({});
  const [totalFiles, setTotalFiles] = useState<number | null>(null);
  const [sheetsUrl, setSheetsUrl] = useState<string>("");
  const [clients, setClients] = useState<{ id: string; code: string; name: string }[]>([]);
  const [projects, setProjects] = useState<{ id: string; code: string; name: string; client_id: string }[]>([]);
  const bottomRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // Fetch clients, projects and document stats on mount
  useEffect(() => {
    (async () => {
      try {
        const { getSupabaseClient } = await import("@/lib/supabase/client");
        const supabase = getSupabaseClient();
        const { data: { session } } = await supabase!.auth.getSession();
        const headers: Record<string, string> = session?.access_token
          ? { Authorization: `Bearer ${session.access_token}` }
          : {};
        const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

        const [c, p, statsRes] = await Promise.all([
          clientsApi.list(),
          projectsApi.list(),
          fetch(`${API}/api/documents/stats`, { headers }),
        ]);
        setClients(c);
        setProjects(p);
        if (statsRes.ok) {
          const stats = await statsRes.json();
          setTotalFiles(stats.total ?? null);
          setSheetsUrl(stats.sheets_url ?? "");
        }
      } catch {
        // Silently fail
      }
    })();
  }, []);

  // Load chat history from localStorage (skip stale proposals)
  useEffect(() => {
    if (!username) return;
    const stored = localStorage.getItem(`nimbus-chat-${username}`);
    if (!stored) return;
    try {
      const parsed = JSON.parse(stored) as MsgType[];
      const clean = parsed.filter((m) => m.type !== "proposal");
      if (clean.length > 0) setMsgs(clean);
    } catch {
      // Ignore corrupt data
    }
  }, [username]);

  // Persist chat history to localStorage
  useEffect(() => {
    if (!username) return;
    const toSave = msgs.filter((m) => m.type !== "proposal");
    localStorage.setItem(`nimbus-chat-${username}`, JSON.stringify(toSave));
  }, [msgs, username]);

  const refreshRiwayat = useCallback(async () => {
    const entries = await dccActivityApi.list(50);
    setRiwayat(entries);
  }, []);

  // Load riwayat on mount
  useEffect(() => { refreshRiwayat(); }, [refreshRiwayat]);

  const handleEditChange = useCallback((proposalId: string, field: string, value: string) => {
    setProposalEdits((prev) => ({
      ...prev,
      [proposalId]: { ...(prev[proposalId] || {}), [field]: value },
    }));
  }, []);

  // Sync streaming messages into local message state
  useEffect(() => {
    if (streamMsgs.length === 0) return;
    const lastStreamMsg = streamMsgs[streamMsgs.length - 1];
    setMsgs((prev) => {
      const existingIds = new Set(prev.map((m) => m.id));
      const newMsgs = streamMsgs.filter((m) => !existingIds.has(m.id));
      if (newMsgs.length === 0 && prev.length > 0) {
        const lastPrev = prev[prev.length - 1];
        if (lastPrev.id === lastStreamMsg.id) {
          return [...prev.slice(0, -1), streamMsgToMsgType(lastStreamMsg)];
        }
        return prev;
      }
      return [...prev, ...newMsgs.map(streamMsgToMsgType)];
    });
  }, [streamMsgs]);

  useEffect(() => {
    if (bottomRef.current) {
      bottomRef.current.scrollTop = bottomRef.current.scrollHeight;
    }
  }, [msgs, uploadState]);

  // ── File upload handler (propose/confirm flow) ──
  const handleFiles = useCallback(async (files: FileList | File[]) => {
    const file = files[0];
    if (!file) return;

    // Validate before sending to server
    const err = validateFile(file);
    if (err) {
      setUploadState({ phase: "error", file, message: err });
      return;
    }

    setUploadState({ phase: "uploading", file, progress: "Mengunggah…" });

    try {
      const proposal = await uploadApi.propose(file);

      // Transition to indexing phase (brief)
      setUploadState({ phase: "indexing", file });

      await new Promise((r) => setTimeout(r, 400));

      setUploadState({ phase: "idle" });
      dccActivityApi.log("upload", file.name).then(refreshRiwayat);

      // Add proposal card to chat
      const proposalMsg: MsgType = {
        id: `proposal-${proposal.id}`,
        type: "proposal",
        time: now(),
        status: "pending",
        file: { name: file.name, size: formatSize(proposal.size) },
        proposalId: proposal.id,
        detected: {
          ...(proposal.detected_type ? { doc_type: { value: proposal.detected_type, confidence: proposal.detected_type_confidence } } : {}),
          ...(proposal.detected_client_name ? { client: { value: proposal.detected_client_name, code: proposal.detected_client_code || undefined, confidence: proposal.detected_client_confidence } } : {}),
          ...(proposal.detected_project_name ? { project: { value: proposal.detected_project_name, code: proposal.detected_project_code || undefined, confidence: proposal.detected_project_confidence } } : {}),
          ...(proposal.detected_folder ? { folder: { value: proposal.detected_folder, confidence: proposal.detected_folder_confidence } } : {}),
        },
      };

      setMsgs((p) => [...p, proposalMsg]);
    } catch (e) {
      const message = e instanceof Error ? e.message : "Terjadi kesalahan saat mengunggah.";
      setUploadState({ phase: "error", file, message });
    }
  }, [refreshRiwayat]);

  const sendMsg = useCallback(() => {
    if (!input.trim()) return;
    const q = input.trim();
    setInput("");
    streamSend(q);
  }, [input, streamSend]);

  const confirmProposal = useCallback(async (id: string) => {
    // Find the proposal message to get the proposalId and edits
    const msg = msgs.find((m) => m.id === id);
    const proposalId = msg?.type === "proposal" ? msg.proposalId : id.replace("proposal-", "");
    const edits = proposalEdits[proposalId] || {};

    setMsgs((p) => p.map((m) => (m.id === id && m.type === "proposal" ? { ...m, status: "confirmed" } : m)));

    try {
      const result = await uploadApi.confirm(proposalId, {
        doc_type: edits.doc_type || undefined,
        client_code: edits.client_code || undefined,
        client_name: edits.client_name || undefined,
        project_code: edits.project_code || undefined,
        project_name: edits.project_name || undefined,
        folder_path: edits.folder_path || undefined,
        title: edits.title || undefined,
        note: edits.note || undefined,
      });
      // Update with success
      setMsgs((p) => p.map((m) => {
        if (m.id === id && m.type === "proposal") {
          return { ...m, status: "confirmed" };
        }
        return m;
      }));
    } catch (e) {
      // Revert on error
      setMsgs((p) => p.map((m) => (m.id === id && m.type === "proposal" ? { ...m, status: "pending" } : m)));
      console.error("Confirm failed:", e);
    }
  }, [msgs, proposalEdits]);

  const cancelProposal = useCallback(async (id: string) => {
    const msg = msgs.find((m) => m.id === id);
    const proposalId = msg?.type === "proposal" ? msg.proposalId : id.replace("proposal-", "");

    try {
      await uploadApi.cancel(proposalId);
    } catch {
      // Cancel anyway in the UI
    }
    setMsgs((p) => p.filter((m) => m.id !== id));
  }, [msgs]);

  const requestAccess = useCallback(async (docId: string, docName?: string) => {
    setAccessMap((p) => ({ ...p, [docId]: "pending" }));
    dccActivityApi.log("access_request", docName || docId).then(refreshRiwayat);
    try {
      await accessApi.requestAccess(docId);
      setTimeout(() => setAccessMap((p) => ({ ...p, [docId]: "approved" })), 4000);
    } catch {
      setAccessMap((p) => ({ ...p, [docId]: "" }));
    }
  }, [refreshRiwayat]);

  const handleFileInput = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      handleFiles(e.target.files);
    }
    e.target.value = "";
  }, [handleFiles]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files.length > 0) {
      handleFiles(e.dataTransfer.files);
    }
  }, [handleFiles]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(true);
  }, []);

  const handleDragLeave = useCallback(() => {
    setDragOver(false);
  }, []);

  return (
    <PageGuard permission="dcc:view">
    <div className="flex flex-col h-full overflow-hidden">
      {/* Control panel */}
      <div className="flex items-center gap-2 px-3 md:px-5 h-[46px] min-h-[46px] border-b border-border bg-bg shrink-0">
        <span className="w-1.5 h-1.5 rounded-full bg-green shadow-[0_0_0_3px_var(--green-bg)]" />
        <span className="text-[15px] font-bold text-text">Nimbus DCC</span>
        <span className="text-[10px] font-bold px-2 py-[2px] rounded-full badge-purple">AI Online</span>
        <div className="flex-1" />

        {/* Upload status — inline in control bar */}
        {uploadState.phase !== "idle" && (
          <div className="flex items-center gap-1.5 max-w-[260px] min-w-0 px-1">
            {(uploadState.phase === "uploading" || uploadState.phase === "indexing") && (
              <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0 text-primary" />
            )}
            {uploadState.phase === "success" && (
              <CheckCircle className="w-3.5 h-3.5 shrink-0 text-green" />
            )}
            {uploadState.phase === "error" && (
              <AlertCircle className="w-3.5 h-3.5 shrink-0 text-red" />
            )}
            <span className="text-[11.5px] font-mono truncate min-w-0 text-text">
              {uploadState.file.name}
            </span>
            <span className="text-[11px] text-text-muted shrink-0">
              {uploadState.phase === "uploading" && "Mengunggah…"}
              {uploadState.phase === "indexing" && "Menyimpan…"}
              {uploadState.phase === "success" && "Selesai"}
              {uploadState.phase === "error" && "Gagal"}
            </span>
            {uploadState.phase === "error" && (
              <button onClick={() => handleFiles([uploadState.file])} className="text-[11px] font-semibold text-primary hover:underline shrink-0">Ulang</button>
            )}
            {(uploadState.phase === "success" || uploadState.phase === "error") && (
              <button onClick={() => setUploadState({ phase: "idle" })} className="text-[13px] leading-none text-text-light hover:text-text shrink-0">×</button>
            )}
          </div>
        )}

        {/* Total files */}
        {totalFiles !== null && (
          <div className="hidden sm:flex items-center gap-1 text-[11.5px] text-text-muted px-2">
            <span className="font-bold text-text">{totalFiles.toLocaleString("id")}</span>
            <span>file</span>
          </div>
        )}
        {/* Public index link */}
        {sheetsUrl && (
          <a
            href={sheetsUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="btn btn-default btn-sm gap-1.5 hidden sm:inline-flex"
          >
            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="18" height="18" rx="2" /><line x1="3" y1="9" x2="21" y2="9" /><line x1="3" y1="15" x2="21" y2="15" /><line x1="9" y1="3" x2="9" y2="21" />
            </svg>
            Index Publik
          </a>
        )}
        <input type="file" ref={fileRef} className="hidden" accept=".docx,.xlsx,.pptx,.pdf,.zip,.rar,.dwg,.step,.stp" onChange={handleFileInput} />
      </div>

      {/* Layout: chat + queue */}
      <div className="flex flex-1 overflow-hidden min-h-0">
        {/* Chat */}
        <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
          <div ref={bottomRef} className="flex-1 overflow-y-auto px-3 py-4 md:px-6 md:py-5 flex flex-col gap-4">
            {msgs.map((msg) => (
              <MessageBubble
                key={msg.id}
                msg={msg}
                accessMap={accessMap}
                onAccess={requestAccess}
                onConfirm={confirmProposal}
                onCancel={cancelProposal}
                proposalEdits={proposalEdits}
                onEditChange={handleEditChange}
                clients={clients}
                projects={projects}
              />
            ))}
          </div>

          {/* Input */}
          <div className="px-3 py-2 md:px-5 md:py-2.5 border-t border-border bg-bg shrink-0">
            <div
              className={`flex gap-2 items-end bg-bg-ctrl border rounded-lg px-2 py-1.5 transition-colors duration-140 ${dragOver ? "border-primary bg-primary-bg" : "border-border"}`}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
            >
              <textarea
                className="flex-1 bg-transparent border-none outline-none text-[13.5px] text-text resize-none p-1 max-h-[120px] placeholder:text-text-light"
                rows={1}
                placeholder={dragOver ? "Lepas file di sini…" : "Tanya Nimbus atau ketik cari…"}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMsg(); } }}
              />
              <div className="flex gap-1.5 items-end">
                <button className="btn btn-default btn-icon btn-sm" onClick={() => fileRef.current?.click()} title="Lampirkan">
                  <Upload className="w-3.5 h-3.5" />
                </button>
                <button className="btn btn-primary btn-icon btn-sm" onClick={sendMsg} title="Kirim">
                  <Send className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
            <div className="text-[10.5px] text-text-light mt-1 px-1 hidden md:block">
              Seret & lepas file untuk unggah · Enter kirim · Shift+Enter baris baru
            </div>
          </div>
        </div>

        {/* Riwayat panel */}
        <div className="hidden md:flex w-[264px] min-w-[264px] shrink-0 border-l border-border bg-bg-sidebar flex-col overflow-hidden">
          <div className="flex items-center gap-2 px-3.5 py-2.5 border-b border-border shrink-0">
            <Clock className="w-3.5 h-3.5 text-text-muted" />
            <span className="text-[12.5px] font-bold">Riwayat</span>
            {riwayat.length > 0 && (
              <span className="ml-auto text-[10px] text-text-light">{riwayat.length}</span>
            )}
          </div>
          <div className="flex-1 overflow-y-auto">
            {riwayat.length === 0 ? (
              <div className="px-4 py-6 text-center">
                <Clock className="w-6 h-6 text-text-light mx-auto mb-2 opacity-40" />
                <div className="text-[11.5px] text-text-muted">Belum ada aktivitas.</div>
                <div className="text-[10.5px] text-text-light mt-0.5">Upload atau unduh dokumen untuk memulai.</div>
              </div>
            ) : riwayat.map((entry) => {
              const roleColor = ROLE_COLORS[entry.user_role] ?? "text-text-muted bg-bg-hover";
              return (
                <div key={entry.id} className="flex gap-2.5 px-3 py-2.5 border-b border-border-soft last:border-b-0 hover:bg-bg-hover transition-colors duration-140 cursor-default">
                  <div className="w-7 h-7 rounded-full bg-primary text-text-inv flex items-center justify-center text-[10px] font-bold shrink-0 mt-0.5">
                    {entry.user_initials}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-1.5 mb-0.5">
                      <span className="text-[12px] font-semibold text-text truncate flex-1 min-w-0">{entry.user_name}</span>
                    </div>
                    <span className={`inline-block text-[10px] font-bold px-1.5 py-px rounded-full mb-1 ${roleColor}`}>
                      {entry.user_role.replace(/_/g, " ")}
                    </span>
                    <div className="text-[11px] text-text-muted truncate">
                      <span className="font-medium text-text">{ACTION_LABELS[entry.action] ?? entry.action}</span>
                      {" · "}{entry.detail}
                    </div>
                    <div className="text-[10px] text-text-light mt-0.5">{relTime(entry.created_at)}</div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
    </PageGuard>
  );
}

/* ── Upload status banner ── */
function UploadBanner({ state, onRetry, onDismiss }: { state: UploadState; onRetry: () => void; onDismiss: () => void }) {
  if (state.phase === "uploading") {
    return (
      <div className="max-w-[400px] bg-bg border border-border rounded-lg px-3 py-2.5 flex items-center gap-2.5">
        <Loader2 className="w-4 h-4 text-primary animate-spin shrink-0" />
        <div className="min-w-0">
          <div className="text-[12px] font-semibold text-text truncate">{state.file.name}</div>
          <div className="text-[10.5px] text-text-muted">{state.progress}</div>
        </div>
      </div>
    );
  }

  if (state.phase === "indexing") {
    return (
      <div className="max-w-[400px] bg-bg border border-border rounded-lg px-3 py-2.5 flex items-center gap-2.5">
        <Loader2 className="w-4 h-4 text-amber animate-spin shrink-0" />
        <div className="min-w-0">
          <div className="text-[12px] font-semibold text-text truncate">{state.file.name}</div>
          <div className="text-[10.5px] text-text-muted">Menyimpan ke index…</div>
        </div>
      </div>
    );
  }

  if (state.phase === "success") {
    return (
      <div className="max-w-[400px] bg-green-bg border border-green/20 rounded-lg px-3 py-2.5 flex items-center gap-2.5">
        <CheckCircle className="w-4 h-4 text-green shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="text-[12px] font-semibold text-green truncate">{state.file.name}</div>
          <div className="text-[10.5px] text-text-muted">
            {state.timestamp}
            {state.gdriveLink && (
              <> · <a href={state.gdriveLink} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">Buka di Drive</a></>
            )}
          </div>
        </div>
      </div>
    );
  }

  if (state.phase === "error") {
    return (
      <div className="max-w-[400px] bg-red-bg border border-red/20 rounded-lg px-3 py-2.5 flex items-start gap-2.5">
        <AlertCircle className="w-4 h-4 text-red shrink-0 mt-0.5" />
        <div className="min-w-0 flex-1">
          <div className="text-[12px] font-semibold text-red truncate">{state.file.name}</div>
          <div className="text-[11px] text-red/80">{state.message}</div>
          <div className="flex gap-2 mt-1.5">
            <button onClick={onRetry} className="text-[11px] font-semibold text-primary hover:underline">Coba Lagi</button>
            <button onClick={onDismiss} className="text-[11px] text-text-muted hover:text-text">Tutup</button>
          </div>
        </div>
      </div>
    );
  }

  return null;
}

