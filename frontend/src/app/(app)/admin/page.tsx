"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Shield,
  UserPlus,
  ToggleLeft,
  ToggleRight,
  ChevronDown,
  Pencil,
  KeyRound,
  Save,
  X,
  Lock,
  Users,
  ShieldCheck,
  Eye,
  EyeOff,
  FileText,
  Hash,
  CheckCircle,
  Loader2,
} from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import {
  ROLE_LABELS,
  ALL_PERMISSIONS,
  PERMISSION_LABELS,
  type AppRole,
  type Permission,
} from "@/lib/utils/roles";
import { usePermissions } from "@/components/providers/permissions-provider";
import { PageGuard } from "@/components/guards/page-guard";
import { cn } from "@/lib/utils";
import { isValidUsername } from "@/lib/auth/username";
import {
  getSequences,
  setSequence,
  getFolderPermissions,
  setFolderPermissions,
  type FolderInfo,
  type FolderPermEntry,
} from "@/lib/api/library";
import type { DocumentSequence } from "@/features/library/types";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
const ALL_ROLES = Object.entries(ROLE_LABELS) as [AppRole, string][];

interface UserProfile {
  id: string;
  username: string;
  full_name: string;
  initials: string;
  avatar_url: string | null;
  role: AppRole;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

interface NewUserForm {
  username: string;
  password: string;
  full_name: string;
  role: AppRole;
}

async function authHeaders(): Promise<Record<string, string>> {
  const { getSupabaseClient } = await import("@/lib/supabase/client");
  const supabase = getSupabaseClient();
  if (!supabase) return {};
  const { data: { session } } = await supabase.auth.getSession();
  return session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {};
}

/* ── Permission groups ── (sidebar:* placeholders dihapus — tidak ada gate yang pakai) */
const PERM_GROUPS: { label: string; perms: Permission[] }[] = [
  { label: "Dashboard", perms: ["dashboard:view"] },
  {
    label: "Document Manager",
    perms: [
      "dcc:view", "dcc:upload", "dcc:search", "dcc:approve",
      "dcc:manage_access", "dcc:manage_clients", "dcc:delete", "dcc:chat",
    ],
  },
  { label: "Workspace", perms: ["workspace:view", "workspace:manage", "workspace:complete_task"] },
  { label: "Administrasi", perms: ["admin:manage_users", "admin:manage_file_types"] },
];

/* ═══════════════════════════════════════════════════════════════
   Root page
   ═══════════════════════════════════════════════════════════════ */
type AdminTab = "users" | "sequences" | "doctypes" | "permissions";

export default function AdminPage() {
  const { profile } = useAuth();
  const [tab, setTab] = useState<AdminTab>("users");

  return (
    <PageGuard permission="admin:manage_users">
      <div className="flex flex-col h-full overflow-hidden">
        {/* Header */}
        <div className="flex items-center gap-3 px-4 md:px-6 h-[52px] min-h-[52px] border-b border-border bg-bg shrink-0">
          <Shield className="w-4 h-4 text-primary" />
          <h1 className="text-[15px] font-bold text-text">Admin Dashboard</h1>
        </div>

        {/* Tab bar */}
        <div className="flex items-center gap-0.5 px-4 md:px-6 border-b border-border bg-bg shrink-0 overflow-x-auto">
          <TabButton active={tab === "users"} onClick={() => setTab("users")} icon={<Users className="w-3.5 h-3.5" />}>
            Pengguna
          </TabButton>
          <TabButton active={tab === "sequences"} onClick={() => setTab("sequences")} icon={<Hash className="w-3.5 h-3.5" />}>
            Nomor Urutan
          </TabButton>
          <TabButton active={tab === "doctypes"} onClick={() => setTab("doctypes")} icon={<FileText className="w-3.5 h-3.5" />}>
            Jenis File
          </TabButton>
          <TabButton active={tab === "permissions"} onClick={() => setTab("permissions")} icon={<ShieldCheck className="w-3.5 h-3.5" />}>
            Permission Role
          </TabButton>
        </div>

        <div className="flex-1 overflow-y-auto">
          {tab === "users" && <UsersTab currentUserId={profile?.id} />}
          {tab === "sequences" && <SequencesTab />}
          {tab === "doctypes" && <DocTypesTab />}
          {tab === "permissions" && <PermissionsTab />}
        </div>
      </div>
    </PageGuard>
  );
}

function TabButton({
  active, onClick, icon, children,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex items-center gap-1.5 px-3 py-2.5 text-[12.5px] font-semibold border-b-2 transition-colors whitespace-nowrap",
        active ? "border-primary text-primary" : "border-transparent text-text-muted hover:text-text"
      )}
    >
      {icon}
      {children}
    </button>
  );
}

/* ═══════════════════════════════════════════════════════════════
   Users tab
   ═══════════════════════════════════════════════════════════════ */
function UsersTab({ currentUserId }: { currentUserId?: string }) {
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newUser, setNewUser] = useState<NewUserForm>({ username: "", password: "", full_name: "", role: "engineer_mechanical" });
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [editingNameFor, setEditingNameFor] = useState<string | null>(null);
  const [nameDraft, setNameDraft] = useState("");
  const [resetTarget, setResetTarget] = useState<UserProfile | null>(null);

  const fetchUsers = useCallback(async () => {
    try {
      const headers = await authHeaders();
      const res = await fetch(`${API_URL}/api/admin/users`, { headers });
      if (!res.ok) throw new Error("Gagal memuat data pengguna");
      setUsers(await res.json());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Terjadi kesalahan");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchUsers(); }, [fetchUsers]);

  const handleCreate = async () => {
    if (!newUser.username || !newUser.password || !newUser.full_name) return;
    if (!isValidUsername(newUser.username)) {
      setError("Username hanya boleh huruf kecil, angka, titik, garis bawah, atau strip (3-32 karakter).");
      return;
    }
    if (newUser.password.length < 6) { setError("Password minimal 6 karakter."); return; }
    setCreating(true); setError(null);
    try {
      const headers = await authHeaders();
      const res = await fetch(`${API_URL}/api/admin/users`, {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify(newUser),
      });
      if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error((e as { detail?: string }).detail || "Gagal membuat pengguna"); }
      setShowCreate(false);
      setNewUser({ username: "", password: "", full_name: "", role: "engineer_mechanical" });
      fetchUsers();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Terjadi kesalahan");
    } finally { setCreating(false); }
  };

  const changeRole = async (userId: string, role: AppRole) => {
    setUpdatingId(userId); setError(null);
    try {
      const headers = await authHeaders();
      const res = await fetch(`${API_URL}/api/admin/users/${userId}/role`, {
        method: "PATCH", headers: { ...headers, "Content-Type": "application/json" }, body: JSON.stringify({ role }),
      });
      if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error((e as { detail?: string }).detail || "Gagal mengubah role"); }
      fetchUsers();
    } catch (err) { setError(err instanceof Error ? err.message : "Terjadi kesalahan"); }
    finally { setUpdatingId(null); }
  };

  const toggleStatus = async (userId: string, is_active: boolean) => {
    setUpdatingId(userId); setError(null);
    try {
      const headers = await authHeaders();
      const res = await fetch(`${API_URL}/api/admin/users/${userId}/status`, {
        method: "PATCH", headers: { ...headers, "Content-Type": "application/json" }, body: JSON.stringify({ is_active }),
      });
      if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error((e as { detail?: string }).detail || "Gagal mengubah status"); }
      fetchUsers();
    } catch (err) { setError(err instanceof Error ? err.message : "Terjadi kesalahan"); }
    finally { setUpdatingId(null); }
  };

  const saveName = async (userId: string) => {
    const trimmed = nameDraft.trim();
    if (!trimmed) return;
    setUpdatingId(userId); setError(null);
    try {
      const headers = await authHeaders();
      const res = await fetch(`${API_URL}/api/admin/users/${userId}/name`, {
        method: "PATCH", headers: { ...headers, "Content-Type": "application/json" }, body: JSON.stringify({ full_name: trimmed }),
      });
      if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error((e as { detail?: string }).detail || "Gagal menyimpan nama"); }
      setEditingNameFor(null);
      fetchUsers();
    } catch (err) { setError(err instanceof Error ? err.message : "Terjadi kesalahan"); }
    finally { setUpdatingId(null); }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center">
          <div className="animate-pulse w-8 h-8 mx-auto mb-3 rounded bg-primary-bg flex items-center justify-center">
            <Shield className="w-4 h-4 text-primary" />
          </div>
          <p className="text-[13px] text-text-muted">Memuat data pengguna…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="px-4 md:px-6 py-4">
      <div className="flex items-center gap-3 mb-4">
        <span className="badge badge-purple">{users.length} pengguna</span>
        <div className="flex-1" />
        <button className="btn btn-primary btn-sm gap-1.5" onClick={() => setShowCreate(true)}>
          <UserPlus className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">Tambah Pengguna</span>
        </button>
      </div>

      {error && (
        <div className="mb-4 px-3 py-2 rounded bg-red-bg text-red text-[13px] border border-red/20 flex items-center gap-2">
          <span className="flex-1">{error}</span>
          <button className="text-[11px] underline shrink-0" onClick={() => setError(null)}>Tutup</button>
        </div>
      )}

      {showCreate && (
        <CreateUserModal form={newUser} setForm={setNewUser} onCancel={() => setShowCreate(false)} onCreate={handleCreate} creating={creating} />
      )}
      {resetTarget && (
        <ResetPasswordModal target={resetTarget} onClose={() => setResetTarget(null)} onSuccess={() => setResetTarget(null)} onError={(msg) => setError(msg)} />
      )}

      {/* Desktop table */}
      <div className="hidden md:block rounded-lg border border-border overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="bg-bg-ctrl border-b border-border">
              {["Pengguna", "Username", "Role", "Status", "Aksi"].map((h, i) => (
                <th key={h} className={cn("px-4 py-2.5 text-[11px] font-bold uppercase tracking-wider text-text-muted", i === 4 ? "text-right" : "text-left")}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {users.map((u) => {
              const isSelf = u.id === currentUserId;
              const isEditing = editingNameFor === u.id;
              return (
                <tr key={u.id} className="border-b border-border-soft hover:bg-bg-hover transition-colors">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2.5">
                      <div className="w-8 h-8 rounded-full badge-purple flex items-center justify-center text-[11px] font-bold shrink-0">
                        {u.initials || u.full_name?.slice(0, 2).toUpperCase() || "??"}
                      </div>
                      {isEditing ? (
                        <div className="flex items-center gap-1.5">
                          <input
                            autoFocus value={nameDraft}
                            onChange={(e) => setNameDraft(e.target.value)}
                            onKeyDown={(e) => { if (e.key === "Enter") saveName(u.id); if (e.key === "Escape") setEditingNameFor(null); }}
                            className="px-2 py-1 rounded border border-border bg-bg-ctrl text-[13px] outline-none focus:border-primary w-[180px]"
                          />
                          <button className="btn btn-primary btn-icon btn-sm" onClick={() => saveName(u.id)} disabled={updatingId === u.id}><Save className="w-3.5 h-3.5" /></button>
                          <button className="btn btn-default btn-icon btn-sm" onClick={() => setEditingNameFor(null)}><X className="w-3.5 h-3.5" /></button>
                        </div>
                      ) : (
                        <div className="flex items-center gap-1.5">
                          <span className="text-[13px] font-semibold text-text">{u.full_name}</span>
                          <button className="text-text-light hover:text-primary p-0.5" onClick={() => { setEditingNameFor(u.id); setNameDraft(u.full_name); }}>
                            <Pencil className="w-3 h-3" />
                          </button>
                        </div>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-[13px] text-text-muted font-mono">{u.username}</td>
                  <td className="px-4 py-3">
                    <div className="relative">
                      <select
                        className="appearance-none bg-transparent border-none text-[12px] font-semibold cursor-pointer pr-5 outline-none disabled:opacity-50"
                        value={u.role} disabled={updatingId === u.id || isSelf}
                        title={isSelf ? "Tidak dapat mengubah role akun sendiri" : ""}
                        onChange={(e) => changeRole(u.id, e.target.value as AppRole)}
                      >
                        {ALL_ROLES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                      </select>
                      <ChevronDown className="absolute right-0 top-1/2 -translate-y-1/2 w-3 h-3 text-text-muted pointer-events-none" />
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <button
                      className={cn("flex items-center gap-1.5 text-[12px] font-semibold transition-colors disabled:opacity-50", u.is_active ? "text-green" : "text-text-muted")}
                      disabled={updatingId === u.id || isSelf}
                      onClick={() => toggleStatus(u.id, !u.is_active)}
                    >
                      {u.is_active ? <><ToggleRight className="w-4 h-4" /> Aktif</> : <><ToggleLeft className="w-4 h-4" /> Nonaktif</>}
                    </button>
                  </td>
                  <td className="px-4 py-3 text-right">
                    {updatingId === u.id ? (
                      <span className="text-[11px] text-text-muted animate-pulse">Menyimpan…</span>
                    ) : (
                      <button className="btn btn-default btn-sm gap-1.5" onClick={() => setResetTarget(u)}>
                        <KeyRound className="w-3.5 h-3.5" /> Reset Password
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
            {users.length === 0 && (
              <tr><td colSpan={5} className="px-4 py-8 text-center text-[13px] text-text-muted">Belum ada pengguna terdaftar</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Mobile cards */}
      <div className="md:hidden flex flex-col gap-3">
        {users.map((u) => {
          const isSelf = u.id === currentUserId;
          return (
            <div key={u.id} className="bg-bg border border-border rounded-lg p-4">
              <div className="flex items-center gap-2.5 mb-3">
                <div className="w-9 h-9 rounded-full badge-purple flex items-center justify-center text-[12px] font-bold shrink-0">
                  {u.initials || u.full_name?.slice(0, 2).toUpperCase() || "??"}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-[14px] font-semibold text-text truncate">{u.full_name}</div>
                  <div className="text-[11px] text-text-muted font-mono">{u.username}</div>
                </div>
                <button
                  className={cn("ml-auto flex items-center gap-1 text-[11px] font-semibold disabled:opacity-50", u.is_active ? "text-green" : "text-text-muted")}
                  disabled={isSelf} onClick={() => toggleStatus(u.id, !u.is_active)}
                >
                  {u.is_active ? <ToggleRight className="w-4 h-4" /> : <ToggleLeft className="w-4 h-4" />}
                  {u.is_active ? "Aktif" : "Nonaktif"}
                </button>
              </div>
              <div className="flex items-center gap-2 mb-2">
                <span className="text-[11px] text-text-muted">Role:</span>
                <div className="relative flex-1">
                  <select
                    className="w-full appearance-none bg-bg-ctrl border border-border rounded px-2 py-1.5 text-[12px] outline-none pr-6 disabled:opacity-50"
                    value={u.role} disabled={updatingId === u.id || isSelf}
                    onChange={(e) => changeRole(u.id, e.target.value as AppRole)}
                  >
                    {ALL_ROLES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                  </select>
                  <ChevronDown className="absolute right-1.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-muted pointer-events-none" />
                </div>
              </div>
              <div className="flex gap-2">
                <button className="btn btn-default btn-sm flex-1 gap-1.5" onClick={() => { setEditingNameFor(u.id); setNameDraft(u.full_name); }}>
                  <Pencil className="w-3.5 h-3.5" /> Edit Nama
                </button>
                <button className="btn btn-default btn-sm flex-1 gap-1.5" onClick={() => setResetTarget(u)}>
                  <KeyRound className="w-3.5 h-3.5" /> Reset Password
                </button>
              </div>
              {editingNameFor === u.id && (
                <div className="mt-3 flex items-center gap-1.5">
                  <input autoFocus value={nameDraft} onChange={(e) => setNameDraft(e.target.value)}
                    className="flex-1 px-2 py-1.5 rounded border border-border bg-bg-ctrl text-[13px] outline-none focus:border-primary" />
                  <button className="btn btn-primary btn-sm" onClick={() => saveName(u.id)}>Simpan</button>
                  <button className="btn btn-default btn-sm" onClick={() => setEditingNameFor(null)}>Batal</button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   Sequences tab (moved from TempPanel)
   ═══════════════════════════════════════════════════════════════ */
function SequencesTab() {
  const [sequences, setSequences] = useState<DocumentSequence[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  useEffect(() => {
    getSequences()
      .then(({ sequences }) => setSequences(sequences))
      .catch((e) => setError(e instanceof Error ? e.message : "Gagal memuat"))
      .finally(() => setLoading(false));
  }, []);

  const handleSave = async (docType: string) => {
    const val = parseInt(editing[docType] ?? "", 10);
    if (isNaN(val) || val < 0) return;
    setSaving(docType);
    try {
      await setSequence(docType, val);
      setSequences((prev) => prev.map((s) => s.doc_type === docType ? { ...s, current_number: val } : s));
      setEditing((prev) => { const next = { ...prev }; delete next[docType]; return next; });
      setSaved(docType);
      setTimeout(() => setSaved(null), 2000);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Gagal menyimpan");
    } finally {
      setSaving(null);
    }
  };

  if (loading) return <LoadingState label="Memuat nomor urutan…" />;

  return (
    <div className="px-4 md:px-6 py-4 max-w-xl">
      <p className="text-[12.5px] text-text-muted mb-4">
        Nomor yang tersimpan adalah nomor <span className="font-semibold">terakhir digunakan</span>.
        Upload berikutnya akan mendapat nomor +1. Setel ke nomor terakhir arsip fisik agar penomoran berlanjut.
      </p>

      {error && <ErrorBanner message={error} onClose={() => setError(null)} />}

      <div className="rounded-lg border border-border overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="bg-bg-ctrl border-b border-border">
              <th className="px-4 py-2.5 text-left text-[11px] font-bold uppercase tracking-wider text-text-muted w-[80px]">Tipe</th>
              <th className="px-4 py-2.5 text-left text-[11px] font-bold uppercase tracking-wider text-text-muted">Keterangan</th>
              <th className="px-4 py-2.5 text-right text-[11px] font-bold uppercase tracking-wider text-text-muted w-[180px]">Nomor Terakhir</th>
            </tr>
          </thead>
          <tbody>
            {sequences.map((seq) => {
              const isEditing = editing[seq.doc_type] !== undefined;
              const isSaving = saving === seq.doc_type;
              const isSaved = saved === seq.doc_type;
              return (
                <tr key={seq.doc_type} className="border-b border-border-soft hover:bg-bg-hover transition-colors">
                  <td className="px-4 py-3 text-[13px] font-bold font-mono text-primary">{seq.doc_type}</td>
                  <td className="px-4 py-3 text-[12.5px] text-text-muted">{seq.label.split(" — ")[1] ?? seq.label}</td>
                  <td className="px-4 py-3 text-right">
                    {isEditing ? (
                      <div className="flex items-center justify-end gap-1.5">
                        <input
                          type="number"
                          min={0}
                          value={editing[seq.doc_type]}
                          onChange={(e) => setEditing((prev) => ({ ...prev, [seq.doc_type]: e.target.value }))}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") handleSave(seq.doc_type);
                            if (e.key === "Escape") setEditing((prev) => { const next = { ...prev }; delete next[seq.doc_type]; return next; });
                          }}
                          className="w-24 text-[12px] text-right px-2 py-1 rounded border border-border bg-bg-ctrl outline-none focus:border-primary"
                          disabled={isSaving}
                          autoFocus
                        />
                        <button
                          onClick={() => handleSave(seq.doc_type)}
                          disabled={isSaving}
                          className="btn btn-primary btn-sm btn-icon"
                        >
                          {isSaving ? <Loader2 className="w-3 h-3 animate-spin" /> : <CheckCircle className="w-3 h-3" />}
                        </button>
                        <button
                          onClick={() => setEditing((prev) => { const next = { ...prev }; delete next[seq.doc_type]; return next; })}
                          className="btn btn-default btn-sm btn-icon"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </div>
                    ) : (
                      <div className="flex items-center justify-end gap-2">
                        <span className={cn("text-[14px] font-bold tabular-nums font-mono", isSaved ? "text-green" : "text-text")}>
                          {seq.current_number.toLocaleString("id")}
                        </span>
                        <button
                          onClick={() => setEditing((prev) => ({ ...prev, [seq.doc_type]: String(seq.current_number) }))}
                          className="btn btn-default btn-sm text-[11px] px-2"
                        >
                          Ubah
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   Doc types tab — admin can add new types and edit/deactivate existing ones.
   Code is immutable once created because doc_number (e.g. DRW-125) refers to it.
   ═══════════════════════════════════════════════════════════════ */
interface FileTypeRow {
  code: string;
  label: string;
  description: string | null;
  is_active: boolean;
  sort_order: number;
}

const FILE_TYPE_CODE_RE = /^[A-Z][A-Z0-9]{1,7}$/;

function DocTypesTab() {
  const [rows, setRows] = useState<FileTypeRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState({ code: "", label: "", description: "" });
  const [editingCode, setEditingCode] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<{ label: string; description: string }>({ label: "", description: "" });
  const [busyCode, setBusyCode] = useState<string | null>(null);

  const fetchRows = useCallback(async () => {
    setError(null);
    try {
      const headers = await authHeaders();
      const res = await fetch(`${API_URL}/api/admin/file-types`, { headers });
      if (!res.ok) throw new Error("Gagal memuat jenis file");
      setRows(await res.json());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Terjadi kesalahan");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchRows(); }, [fetchRows]);

  const handleCreate = async () => {
    const code = draft.code.trim().toUpperCase();
    const label = draft.label.trim();
    if (!FILE_TYPE_CODE_RE.test(code)) {
      setError("Kode harus 2-8 karakter, huruf besar/angka, diawali huruf.");
      return;
    }
    if (!label) { setError("Nama wajib diisi."); return; }
    setCreating(true); setError(null);
    try {
      const headers = await authHeaders();
      const res = await fetch(`${API_URL}/api/admin/file-types`, {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({ code, label, description: draft.description.trim() || null }),
      });
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        throw new Error((e as { detail?: string }).detail || "Gagal menambah jenis file");
      }
      setShowCreate(false);
      setDraft({ code: "", label: "", description: "" });
      fetchRows();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Terjadi kesalahan");
    } finally { setCreating(false); }
  };

  const updateRow = async (code: string, patch: Partial<Pick<FileTypeRow, "label" | "description" | "is_active" | "sort_order">>) => {
    setBusyCode(code); setError(null);
    try {
      const headers = await authHeaders();
      const res = await fetch(`${API_URL}/api/admin/file-types/${encodeURIComponent(code)}`, {
        method: "PATCH",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        throw new Error((e as { detail?: string }).detail || "Gagal menyimpan perubahan");
      }
      fetchRows();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Terjadi kesalahan");
    } finally { setBusyCode(null); }
  };

  const beginEdit = (row: FileTypeRow) => {
    setEditingCode(row.code);
    setEditDraft({ label: row.label, description: row.description ?? "" });
  };

  const saveEdit = async () => {
    if (!editingCode) return;
    const label = editDraft.label.trim();
    if (!label) { setError("Nama wajib diisi."); return; }
    await updateRow(editingCode, { label, description: editDraft.description.trim() });
    setEditingCode(null);
  };

  return (
    <div className="px-4 md:px-6 py-4 max-w-3xl">
      <p className="text-[12.5px] text-text-muted mb-4">
        Daftar jenis file yang dikenali sistem. Kode dipakai dalam penomoran otomatis dokumen
        (contoh: <span className="font-mono font-semibold">DRW-PLB-0125.pdf</span>).
        Kode <span className="font-semibold">tidak dapat diubah</span> setelah dibuat karena dokumen
        lama merujuk ke kode tersebut — nonaktifkan saja kalau jenis sudah tidak dipakai.
      </p>

      {error && (
        <div className="mb-3 px-3 py-2 rounded-md border border-red/30 bg-red-bg text-red text-[12.5px]">
          {error}
        </div>
      )}

      <div className="flex items-center gap-2 mb-3">
        <button
          type="button"
          onClick={() => setShowCreate((v) => !v)}
          className="btn btn-primary btn-sm gap-1.5"
        >
          <UserPlus className="w-3.5 h-3.5" />
          {showCreate ? "Tutup" : "Tambah Jenis File"}
        </button>
        <button
          type="button"
          onClick={() => fetchRows()}
          disabled={loading}
          className="btn btn-default btn-sm"
        >
          Segarkan
        </button>
      </div>

      {showCreate && (
        <div className="mb-4 rounded-lg border border-border bg-bg-ctrl p-4 flex flex-col gap-3">
          <div className="grid grid-cols-1 md:grid-cols-[120px_1fr_1.5fr] gap-3">
            <div className="flex flex-col gap-1">
              <label className="text-[11px] font-bold uppercase tracking-wider text-text-muted">Kode</label>
              <input
                value={draft.code}
                onChange={(e) => setDraft((d) => ({ ...d, code: e.target.value.toUpperCase() }))}
                placeholder="DRW"
                maxLength={8}
                className="field-input font-mono text-[13px]"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[11px] font-bold uppercase tracking-wider text-text-muted">Nama</label>
              <input
                value={draft.label}
                onChange={(e) => setDraft((d) => ({ ...d, label: e.target.value }))}
                placeholder="Gambar Teknik"
                maxLength={64}
                className="field-input text-[13px]"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[11px] font-bold uppercase tracking-wider text-text-muted">Keterangan</label>
              <input
                value={draft.description}
                onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))}
                placeholder="Drawing, blueprint, CAD"
                maxLength={500}
                className="field-input text-[13px]"
              />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleCreate}
              disabled={creating}
              className="btn btn-primary btn-sm gap-1.5"
            >
              {creating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
              Simpan
            </button>
            <button
              type="button"
              onClick={() => { setShowCreate(false); setDraft({ code: "", label: "", description: "" }); }}
              className="btn btn-default btn-sm"
            >
              Batal
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-10">
          <Loader2 className="w-5 h-5 animate-spin text-text-muted" />
        </div>
      ) : (
        <div className="rounded-lg border border-border overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="bg-bg-ctrl border-b border-border">
                <th className="px-4 py-2.5 text-left text-[11px] font-bold uppercase tracking-wider text-text-muted w-[90px]">Kode</th>
                <th className="px-4 py-2.5 text-left text-[11px] font-bold uppercase tracking-wider text-text-muted w-[180px]">Nama</th>
                <th className="px-4 py-2.5 text-left text-[11px] font-bold uppercase tracking-wider text-text-muted">Keterangan</th>
                <th className="px-4 py-2.5 text-left text-[11px] font-bold uppercase tracking-wider text-text-muted w-[110px]">Status</th>
                <th className="px-4 py-2.5 text-right text-[11px] font-bold uppercase tracking-wider text-text-muted w-[140px]">Aksi</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-6 text-center text-[12.5px] text-text-muted">
                    Belum ada jenis file. Klik <span className="font-semibold">Tambah Jenis File</span> untuk membuat.
                  </td>
                </tr>
              )}
              {rows.map((row) => {
                const editing = editingCode === row.code;
                const busy = busyCode === row.code;
                return (
                  <tr key={row.code} className={cn("border-b border-border-soft", !row.is_active && "opacity-60")}>
                    <td className="px-4 py-3 text-[13px] font-bold font-mono text-primary">{row.code}</td>
                    <td className="px-4 py-3 text-[13px] font-semibold text-text">
                      {editing ? (
                        <input
                          value={editDraft.label}
                          onChange={(e) => setEditDraft((d) => ({ ...d, label: e.target.value }))}
                          maxLength={64}
                          className="field-input text-[13px] w-full"
                        />
                      ) : row.label}
                    </td>
                    <td className="px-4 py-3 text-[12px] text-text-muted">
                      {editing ? (
                        <input
                          value={editDraft.description}
                          onChange={(e) => setEditDraft((d) => ({ ...d, description: e.target.value }))}
                          maxLength={500}
                          className="field-input text-[12px] w-full"
                        />
                      ) : (row.description || <span className="italic text-text-light">—</span>)}
                    </td>
                    <td className="px-4 py-3">
                      <span className={cn(
                        "text-[11px] font-bold px-2 py-[2px] rounded-full",
                        row.is_active ? "bg-green-100 text-green-700" : "bg-bg-hover text-text-muted"
                      )}>
                        {row.is_active ? "Aktif" : "Nonaktif"}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        {editing ? (
                          <>
                            <button
                              type="button"
                              onClick={saveEdit}
                              disabled={busy}
                              className="btn btn-primary btn-sm gap-1"
                            >
                              {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
                              Simpan
                            </button>
                            <button
                              type="button"
                              onClick={() => setEditingCode(null)}
                              className="btn btn-default btn-sm"
                            >
                              <X className="w-3 h-3" />
                            </button>
                          </>
                        ) : (
                          <>
                            <button
                              type="button"
                              onClick={() => beginEdit(row)}
                              disabled={busy}
                              className="btn btn-default btn-sm gap-1"
                              title="Edit nama & keterangan"
                            >
                              <Pencil className="w-3 h-3" />
                              Ubah
                            </button>
                            <button
                              type="button"
                              onClick={() => updateRow(row.code, { is_active: !row.is_active })}
                              disabled={busy}
                              className="btn btn-default btn-sm gap-1"
                              title={row.is_active ? "Nonaktifkan" : "Aktifkan"}
                            >
                              {row.is_active ? <ToggleRight className="w-3 h-3" /> : <ToggleLeft className="w-3 h-3" />}
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   Permissions tab — module + folder access per role
   ═══════════════════════════════════════════════════════════════ */
type FolderPerm = {
  can_view: boolean;
  can_upload: boolean;
  can_download: boolean;
  can_rename: boolean;
  can_delete: boolean;
  can_move: boolean;
};
type FolderDraft = Record<string, Record<string, FolderPerm>>;

const FOLDER_PERM_FIELDS: { key: keyof FolderPerm; label: string; width: string }[] = [
  { key: "can_view", label: "View", width: "w-[58px]" },
  { key: "can_upload", label: "Upload", width: "w-[62px]" },
  { key: "can_download", label: "Download", width: "w-[72px]" },
  { key: "can_rename", label: "Rename", width: "w-[62px]" },
  { key: "can_delete", label: "Hapus", width: "w-[58px]" },
  { key: "can_move", label: "Pindah", width: "w-[62px]" },
];

const EMPTY_FOLDER_PERM: FolderPerm = {
  can_view: false, can_upload: false, can_download: false,
  can_rename: false, can_delete: false, can_move: false,
};

function PermissionsTab() {
  const { matrix, loaded, refresh } = usePermissions();
  const [draft, setDraft] = useState<Record<AppRole, Set<Permission>> | null>(null);
  const [folders, setFolders] = useState<FolderInfo[]>([]);
  const [folderDraft, setFolderDraft] = useState<FolderDraft>({});
  const [folderLoaded, setFolderLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<AppRole | null>(null);

  // Load module permissions draft
  useEffect(() => {
    if (!loaded) return;
    const next: Record<AppRole, Set<Permission>> = {} as Record<AppRole, Set<Permission>>;
    for (const [role] of ALL_ROLES) next[role] = new Set((matrix[role] ?? []) as Permission[]);
    setDraft(next);
  }, [loaded, matrix]);

  // Load folder permissions
  useEffect(() => {
    getFolderPermissions()
      .then(({ folders: f, permissions: p }) => {
        setFolders(f);
        const fd: FolderDraft = {};
        for (const [role] of ALL_ROLES) {
          fd[role] = {};
          for (const folder of f) fd[role][folder.id] = { ...EMPTY_FOLDER_PERM };
        }
        for (const perm of p) {
          if (!fd[perm.role]) fd[perm.role] = {};
          fd[perm.role][perm.folder_id] = {
            can_view: perm.can_view,
            can_upload: perm.can_upload,
            can_download: perm.can_download,
            can_rename: perm.can_rename,
            can_delete: perm.can_delete,
            can_move: perm.can_move,
          };
        }
        setFolderDraft(fd);
        setFolderLoaded(true);
      })
      .catch((e) => {
        setError(e instanceof Error ? e.message : "Gagal memuat izin folder");
        setFolderLoaded(true);
      });
  }, []);

  const togglePerm = (role: AppRole, perm: Permission) => {
    if (!draft || role === "admin") return;
    setDraft((prev) => {
      if (!prev) return prev;
      const next = { ...prev, [role]: new Set(prev[role]) };
      if (next[role].has(perm)) next[role].delete(perm); else next[role].add(perm);
      return next;
    });
  };

  const toggleFolderPerm = (role: string, folderId: string, field: keyof FolderPerm) => {
    if (role === "admin") return;
    setFolderDraft((prev) => ({
      ...prev,
      [role]: {
        ...prev[role],
        [folderId]: {
          ...(prev[role]?.[folderId] ?? EMPTY_FOLDER_PERM),
          [field]: !prev[role]?.[folderId]?.[field],
        },
      },
    }));
  };

  const resetDraft = () => {
    if (!loaded) return;
    const next: Record<AppRole, Set<Permission>> = {} as Record<AppRole, Set<Permission>>;
    for (const [role] of ALL_ROLES) next[role] = new Set((matrix[role] ?? []) as Permission[]);
    setDraft(next); setError(null); setSuccess(null);
    // Re-fetch folder perms
    setFolderLoaded(false);
    getFolderPermissions()
      .then(({ folders: f, permissions: p }) => {
        setFolders(f);
        const fd: FolderDraft = {};
        for (const [role] of ALL_ROLES) {
          fd[role] = {};
          for (const folder of f) fd[role][folder.id] = { ...EMPTY_FOLDER_PERM };
        }
        for (const perm of p) {
          if (!fd[perm.role]) fd[perm.role] = {};
          fd[perm.role][perm.folder_id] = {
            can_view: perm.can_view, can_upload: perm.can_upload, can_download: perm.can_download,
            can_rename: perm.can_rename, can_delete: perm.can_delete, can_move: perm.can_move,
          };
        }
        setFolderDraft(fd);
      })
      .finally(() => setFolderLoaded(true));
  };

  const save = async () => {
    if (!draft) return;
    setSaving(true); setError(null); setSuccess(null);
    try {
      // Module permissions UI removed — folder access only
      const folderPerms: FolderPermEntry[] = [];
      for (const [role, folderMap] of Object.entries(folderDraft)) {
        if (role === "admin") continue;
        for (const [folderId, perms] of Object.entries(folderMap)) {
          folderPerms.push({ folder_id: folderId, role, ...perms });
        }
      }
      await setFolderPermissions(folderPerms);

      await refresh();
      setSuccess("Permission berhasil diperbarui.");
    } catch (e) { setError(e instanceof Error ? e.message : "Terjadi kesalahan"); }
    finally { setSaving(false); }
  };

  if (!loaded || !draft || !folderLoaded) {
    return <LoadingState label="Memuat konfigurasi permission…" />;
  }

  const nonAdminRoles = ALL_ROLES.filter(([role]) => role !== "admin");

  return (
    <div className="px-4 md:px-6 py-4">
      <p className="text-[12.5px] text-text-muted mb-4">
        Konfigurasi izin modul dan akses folder per role. Klik nama role untuk membuka pengaturan.
      </p>

      {error && <ErrorBanner message={error} onClose={() => setError(null)} />}
      {success && (
        <div className="mb-3 px-3 py-2 rounded bg-green-bg text-green text-[13px] border border-green/20 flex items-center gap-2">
          <CheckCircle className="w-3.5 h-3.5 shrink-0" /> {success}
        </div>
      )}

      <div className="flex flex-col gap-2">
        {/* Admin — locked */}
        <div className="rounded-lg border border-border-soft bg-bg-ctrl px-4 py-3 flex items-center gap-3">
          <div className="w-7 h-7 rounded-full bg-amber-bg text-amber flex items-center justify-center shrink-0">
            <Lock className="w-3.5 h-3.5" />
          </div>
          <div className="flex-1 min-w-0">
            <span className="text-[13px] font-semibold text-text">Administrator</span>
            <span className="text-[12px] text-text-muted ml-2">— semua izin aktif secara otomatis</span>
          </div>
          <span className="badge badge-amber">{ALL_PERMISSIONS.length} izin</span>
        </div>

        {/* Non-admin role cards */}
        {nonAdminRoles.map(([role, label]) => {
          const activeCount = draft[role].size;
          const folderCount = folders.filter((f) => folderDraft[role]?.[f.id]?.can_view).length;
          const isExpanded = expanded === role;
          const initials = label.slice(0, 2).toUpperCase();

          return (
            <div key={role} className="rounded-lg border border-border bg-bg overflow-hidden">
              <button
                type="button"
                onClick={() => setExpanded(isExpanded ? null : role)}
                className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-bg-hover transition-colors duration-140"
              >
                <div className="w-7 h-7 rounded-full bg-primary-bg text-primary text-[10px] font-bold flex items-center justify-center shrink-0">
                  {initials}
                </div>
                <span className="text-[13px] font-semibold text-text flex-1">{label}</span>
                <span className="badge badge-blue">{folderCount}/{folders.length} folder</span>
                <ChevronDown className={cn("w-4 h-4 text-text-muted transition-transform duration-200 shrink-0", isExpanded && "rotate-180")} />
              </button>

              {isExpanded && (
                <div className="border-t border-border px-4 py-4 space-y-5">
                  {/* Folder access — single source of truth for per-folder perms.
                      Module-level perms (Izin Modul) di-manage via DEFAULT_ROLE_PERMISSIONS
                      seed; UI editor untuk modul sengaja dihapus sesuai feedback user. */}
                  <div>
                    <div className="text-[11px] font-bold uppercase tracking-[0.08em] text-text-light mb-3">
                      Akses Folder Dokumen
                    </div>
                    {folders.length === 0 ? (
                      <p className="text-[12px] text-text-muted">Tidak ada folder yang tersedia</p>
                    ) : (
                      <div className="rounded-lg border border-border overflow-x-auto">
                        <table className="w-full">
                          <thead>
                            <tr className="bg-bg-ctrl border-b border-border">
                              <th className="px-3 py-2 text-left text-[10.5px] font-bold uppercase tracking-wider text-text-muted">Folder</th>
                              {FOLDER_PERM_FIELDS.map((f) => (
                                <th
                                  key={f.key}
                                  className={cn("px-2 py-2 text-center text-[10.5px] font-bold uppercase tracking-wider text-text-muted", f.width)}
                                >
                                  {f.label}
                                </th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {folders.map((folder) => {
                              const fp = folderDraft[role]?.[folder.id] ?? EMPTY_FOLDER_PERM;
                              return (
                                <tr key={folder.id} className="border-b border-border-soft hover:bg-bg-hover transition-colors">
                                  <td className="px-3 py-2">
                                    <div className="text-[12.5px] font-semibold text-text">{folder.name}</div>
                                    <div className="text-[10.5px] text-text-muted">{folder.dept}</div>
                                  </td>
                                  {FOLDER_PERM_FIELDS.map((field) => (
                                    <td key={field.key} className="px-2 py-2 text-center">
                                      <input
                                        type="checkbox"
                                        checked={fp[field.key]}
                                        onChange={() => toggleFolderPerm(role, folder.id, field.key)}
                                        className="w-3.5 h-3.5 cursor-pointer accent-primary"
                                      />
                                    </td>
                                  ))}
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="flex justify-end gap-2 mt-5">
        <button className="btn btn-default" onClick={resetDraft} disabled={saving}>Reset</button>
        <button className="btn btn-primary gap-1.5" onClick={save} disabled={saving}>
          <Save className="w-3.5 h-3.5" />
          {saving ? "Menyimpan…" : "Simpan Perubahan"}
        </button>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   Modals & shared helpers
   ═══════════════════════════════════════════════════════════════ */
function LoadingState({ label }: { label: string }) {
  return (
    <div className="flex items-center justify-center h-full">
      <p className="text-[13px] text-text-muted animate-pulse">{label}</p>
    </div>
  );
}

function ErrorBanner({ message, onClose }: { message: string; onClose: () => void }) {
  return (
    <div className="mb-4 px-3 py-2 rounded bg-red-bg text-red text-[13px] border border-red/20 flex items-center gap-2">
      <span className="flex-1">{message}</span>
      <button className="text-[11px] underline shrink-0" onClick={onClose}>Tutup</button>
    </div>
  );
}

function CreateUserModal({ form, setForm, onCancel, onCreate, creating }: {
  form: NewUserForm;
  setForm: (updater: (p: NewUserForm) => NewUserForm) => void;
  onCancel: () => void;
  onCreate: () => void;
  creating: boolean;
}) {
  const [showPw, setShowPw] = useState(false);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-bg rounded-xl border border-border shadow-xl w-full max-w-md mx-4 p-5">
        <h2 className="text-[15px] font-bold mb-4">Tambah Pengguna Baru</h2>
        <div className="flex flex-col gap-3">
          <FieldRow label="Nama Lengkap">
            <input type="text" className="field" placeholder="Nama lengkap" value={form.full_name}
              onChange={(e) => setForm((p) => ({ ...p, full_name: e.target.value }))} />
          </FieldRow>
          <FieldRow label="Username">
            <input type="text" autoCapitalize="none" autoCorrect="off" spellCheck={false}
              className="field font-mono" placeholder="contoh: budi" value={form.username}
              onChange={(e) => setForm((p) => ({ ...p, username: e.target.value.toLowerCase() }))} />
            <p className="text-[10.5px] text-text-light mt-1">Huruf kecil, angka, titik, _ atau −. 3–32 karakter.</p>
          </FieldRow>
          <FieldRow label="Password Awal">
            <div className="relative">
              <input type={showPw ? "text" : "password"} className="field pr-10" placeholder="Minimal 6 karakter"
                value={form.password} onChange={(e) => setForm((p) => ({ ...p, password: e.target.value }))} />
              <button type="button" className="absolute right-2.5 top-1/2 -translate-y-1/2 text-text-muted hover:text-text"
                onClick={() => setShowPw((v) => !v)} tabIndex={-1}>
                {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </FieldRow>
          <FieldRow label="Role">
            <div className="relative">
              <select className="field appearance-none pr-8" value={form.role}
                onChange={(e) => setForm((p) => ({ ...p, role: e.target.value as AppRole }))}>
                {ALL_ROLES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
              <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted pointer-events-none" />
            </div>
          </FieldRow>
        </div>
        <div className="flex gap-2 mt-5">
          <button className="btn btn-default flex-1" onClick={onCancel}>Batal</button>
          <button
            className="btn btn-primary flex-1"
            disabled={creating || !form.username || !form.password || !form.full_name}
            onClick={onCreate}
          >
            {creating ? "Membuat…" : "Buat Pengguna"}
          </button>
        </div>
      </div>
    </div>
  );
}

function ResetPasswordModal({ target, onClose, onSuccess, onError }: {
  target: UserProfile;
  onClose: () => void;
  onSuccess: () => void;
  onError: (msg: string) => void;
}) {
  const [pw, setPw] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    if (pw.length < 6) { onError("Password minimal 6 karakter."); return; }
    setSubmitting(true);
    try {
      const headers = await authHeaders();
      const res = await fetch(`${API_URL}/api/admin/users/${target.id}/reset-password`, {
        method: "POST", headers: { ...headers, "Content-Type": "application/json" }, body: JSON.stringify({ password: pw }),
      });
      if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error((e as { detail?: string }).detail || "Gagal reset password"); }
      onSuccess();
    } catch (e) { onError(e instanceof Error ? e.message : "Terjadi kesalahan"); }
    finally { setSubmitting(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-bg rounded-xl border border-border shadow-xl w-full max-w-sm mx-4 p-5">
        <h2 className="text-[15px] font-bold mb-1">Reset Password</h2>
        <p className="text-[12.5px] text-text-muted mb-4">
          Set password baru untuk <span className="font-semibold text-text">{target.full_name}</span>{" "}
          (<span className="font-mono">{target.username}</span>).
        </p>
        <div className="relative mb-4">
          <input type={showPw ? "text" : "password"} autoFocus className="field pr-10"
            placeholder="Password baru (min 6 karakter)" value={pw} onChange={(e) => setPw(e.target.value)} />
          <button type="button" className="absolute right-2.5 top-1/2 -translate-y-1/2 text-text-muted hover:text-text"
            onClick={() => setShowPw((v) => !v)} tabIndex={-1}>
            {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
          </button>
        </div>
        <div className="flex gap-2">
          <button className="btn btn-default flex-1" onClick={onClose} disabled={submitting}>Batal</button>
          <button className="btn btn-primary flex-1" disabled={submitting || pw.length < 6} onClick={submit}>
            {submitting ? "Menyimpan…" : "Set Password"}
          </button>
        </div>
      </div>
    </div>
  );
}

function FieldRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-[12px] font-semibold text-text-muted mb-1 block">{label}</label>
      {children}
    </div>
  );
}
