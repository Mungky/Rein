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
  Folder,
  Sparkles,
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

/* ── Permission module cards — one card per major feature area ── */
const PERM_MODULE_CARDS: { id: string; label: string; description: string; perms: Permission[]; accent: "blue" | "green" | "amber" | "purple" }[] = [
  {
    id: "dashboard",
    label: "Dashboard",
    description: "Akses ke beranda & ringkasan harian",
    accent: "blue",
    perms: ["dashboard:view"],
  },
  {
    id: "document-control",
    label: "Document Control",
    description: "Akses ke modul Perpustakaan / DCC",
    accent: "purple",
    perms: [
      "dcc:view", "dcc:upload", "dcc:search", "dcc:approve",
      "dcc:manage_access", "dcc:manage_clients", "dcc:delete", "dcc:chat",
    ],
  },
  {
    id: "workspace",
    label: "Workspace",
    description: "Akses proyek, Work Order, eksekusi lapangan, review",
    accent: "green",
    perms: [
      "workspace:view", "workspace:manage", "workspace:complete_task",
      "workspace:create_wo", "workspace:execute_wo",
      "workspace:review_wo", "workspace:close_project",
    ],
  },
  {
    id: "administrasi",
    label: "Administrasi",
    description: "Kelola pengguna, jenis file, dan permission",
    accent: "amber",
    perms: ["admin:manage_users", "admin:manage_file_types"],
  },
];

/* ═══════════════════════════════════════════════════════════════
   Root page
   ═══════════════════════════════════════════════════════════════ */
type AdminTab = "users" | "sequences" | "doctypes" | "permissions";

interface AdminStats {
  users: number | null;
  fileTypes: number | null;
  folders: number | null;
  sequences: number | null;
}

export default function AdminPage() {
  const { profile } = useAuth();
  const [tab, setTab] = useState<AdminTab>("users");
  const [stats, setStats] = useState<AdminStats>({ users: null, fileTypes: null, folders: null, sequences: null });

  // Fetch summary stats in parallel — pure read, doesn't block tab rendering
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const headers = await authHeaders();
        const [users, fileTypes, folderRes, seqRes] = await Promise.all([
          fetch(`${API_URL}/api/admin/users`, { headers }).then((r) => r.ok ? r.json() : []),
          fetch(`${API_URL}/api/admin/file-types`, { headers }).then((r) => r.ok ? r.json() : []),
          getFolderPermissions().catch(() => ({ folders: [], permissions: [] })),
          getSequences().catch(() => ({ sequences: [] })),
        ]);
        if (cancelled) return;
        setStats({
          users: Array.isArray(users) ? users.length : 0,
          fileTypes: Array.isArray(fileTypes) ? fileTypes.filter((t: FileTypeRow) => t.is_active).length : 0,
          folders: folderRes.folders.length,
          sequences: seqRes.sequences.length,
        });
      } catch {
        if (!cancelled) setStats({ users: 0, fileTypes: 0, folders: 0, sequences: 0 });
      }
    })();
    return () => { cancelled = true; };
  }, []);

  return (
    <PageGuard permission="admin:manage_users">
      <div className="flex flex-col h-full overflow-hidden bg-bg-ctrl">
        {/* Hero header */}
        <div className="px-4 md:px-8 pt-6 pb-5 bg-bg border-b border-border-soft shrink-0">
          <div className="flex items-start gap-4">
            <div className="size-12 rounded-[var(--r-xl)] bg-gradient-to-br from-primary to-primary-hover flex items-center justify-center shadow-[0_4px_14px_rgba(37,99,235,0.30)] shrink-0">
              <Shield className="size-6 text-white" />
            </div>
            <div className="flex-1 min-w-0">
              <h1 className="text-[20px] md:text-[22px] font-bold text-text leading-tight">
                Panel Administrasi
              </h1>
              <p className="text-[13px] text-text-muted mt-1 leading-relaxed">
                Kelola pengguna, jenis dokumen, nomor urutan arsip, dan izin akses folder seluruh Rein.
              </p>
            </div>
            <span className="hidden md:inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-primary-soft text-primary text-[11.5px] font-semibold border border-primary/15">
              <Sparkles className="size-3" />
              Admin
            </span>
          </div>

          {/* Stat cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-5">
            <StatCard
              accent="blue"
              icon={<Users className="size-5" />}
              label="Total Pengguna"
              value={stats.users}
              hint="Akun aktif & nonaktif"
            />
            <StatCard
              accent="purple"
              icon={<FileText className="size-5" />}
              label="Jenis File"
              value={stats.fileTypes}
              hint="Yang aktif dipakai"
            />
            <StatCard
              accent="green"
              icon={<Folder className="size-5" />}
              label="Folder Dokumen"
              value={stats.folders}
              hint="Tercatat di sistem"
            />
            <StatCard
              accent="amber"
              icon={<Hash className="size-5" />}
              label="Nomor Urutan"
              value={stats.sequences}
              hint="Sequence dokumen"
            />
          </div>
        </div>

        {/* Tab bar */}
        <div className="px-4 md:px-8 bg-bg border-b border-border shrink-0 overflow-x-auto">
          <div className="flex items-center gap-1">
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
        </div>

        <div className="flex-1 overflow-y-auto bg-bg-ctrl">
          {tab === "users" && <UsersTab currentUserId={profile?.id} />}
          {tab === "sequences" && <SequencesTab />}
          {tab === "doctypes" && <DocTypesTab />}
          {tab === "permissions" && <PermissionsTab />}
        </div>
      </div>
    </PageGuard>
  );
}

function StatCard({
  accent, icon, label, value, hint,
}: {
  accent: "blue" | "green" | "amber" | "red" | "purple";
  icon: React.ReactNode;
  label: string;
  value: number | null;
  hint: string;
}) {
  return (
    <div className={cn("stat-card", `stat-card-${accent}`)}>
      <div className="flex items-start justify-between gap-2 mb-2">
        <span className="text-[11.5px] font-semibold text-text-muted uppercase tracking-wide leading-tight">
          {label}
        </span>
        <span className="opacity-90">{icon}</span>
      </div>
      <div className="text-[24px] md:text-[26px] font-bold tabular-nums text-text leading-none">
        {value === null ? <span className="inline-block w-12 h-7 rounded bg-bg-ctrl animate-pulse" /> : value.toLocaleString("id")}
      </div>
      <div className="text-[11px] text-text-light mt-1.5">{hint}</div>
    </div>
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
        "flex items-center gap-1.5 px-4 py-3 text-[13px] font-semibold border-b-2 -mb-px transition-all whitespace-nowrap",
        active
          ? "border-primary text-primary"
          : "border-transparent text-text-muted hover:text-text hover:bg-bg-hover/50"
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
    <div className="px-4 md:px-8 py-6">
      <div className="flex items-center gap-3 mb-5">
        <div>
          <h2 className="text-[16px] font-bold text-text leading-tight">Daftar Pengguna</h2>
          <p className="text-[12px] text-text-muted mt-0.5">
            {users.length.toLocaleString("id")} pengguna terdaftar di sistem
          </p>
        </div>
        <div className="flex-1" />
        <button className="btn btn-primary gap-1.5" onClick={() => setShowCreate(true)}>
          <UserPlus className="w-4 h-4" />
          <span className="hidden sm:inline">Tambah Pengguna</span>
          <span className="sm:hidden">Tambah</span>
        </button>
      </div>

      {error && (
        <div className="mb-4 px-3.5 py-2.5 rounded-[var(--r)] bg-red-bg text-red text-[13px] border border-red/20 flex items-center gap-2">
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
      <div className="hidden md:block surface overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="bg-bg-ctrl border-b border-border">
              {["Pengguna", "Username", "Role", "Status", "Aksi"].map((h, i) => (
                <th key={h} className={cn("px-4 py-3 text-[11px] font-bold uppercase tracking-[0.06em] text-text-muted", i === 4 ? "text-right" : "text-left")}>
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
                <tr key={u.id} className="border-b border-border-soft last:border-b-0 hover:bg-bg-hover transition-colors group">
                  <td className="px-4 py-3.5">
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 rounded-full bg-gradient-to-br from-primary to-primary-hover text-white flex items-center justify-center text-[11px] font-bold shrink-0 shadow-[0_1px_3px_rgba(37,99,235,0.25)]">
                        {u.initials || u.full_name?.slice(0, 2).toUpperCase() || "??"}
                      </div>
                      {isEditing ? (
                        <div className="flex items-center gap-1.5">
                          <input
                            autoFocus value={nameDraft}
                            onChange={(e) => setNameDraft(e.target.value)}
                            onKeyDown={(e) => { if (e.key === "Enter") saveName(u.id); if (e.key === "Escape") setEditingNameFor(null); }}
                            className="field-input text-[13px] w-[200px] h-8"
                          />
                          <button className="btn btn-primary btn-icon btn-sm" onClick={() => saveName(u.id)} disabled={updatingId === u.id}><Save className="w-3.5 h-3.5" /></button>
                          <button className="btn btn-default btn-icon btn-sm" onClick={() => setEditingNameFor(null)}><X className="w-3.5 h-3.5" /></button>
                        </div>
                      ) : (
                        <div className="flex items-center gap-1.5 min-w-0">
                          <span className="text-[13.5px] font-semibold text-text truncate">{u.full_name}</span>
                          <button className="opacity-0 group-hover:opacity-100 transition-opacity text-text-light hover:text-primary p-0.5" onClick={() => { setEditingNameFor(u.id); setNameDraft(u.full_name); }}>
                            <Pencil className="w-3 h-3" />
                          </button>
                        </div>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3.5 text-[12.5px] text-text-muted font-mono">{u.username}</td>
                  <td className="px-4 py-3.5">
                    <div className="relative inline-block">
                      <select
                        className="appearance-none bg-bg-ctrl rounded-[var(--r)] border border-border px-2.5 py-1.5 text-[12px] font-semibold cursor-pointer pr-7 outline-none hover:border-primary transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        value={u.role} disabled={updatingId === u.id || isSelf}
                        title={isSelf ? "Tidak dapat mengubah role akun sendiri" : ""}
                        onChange={(e) => changeRole(u.id, e.target.value as AppRole)}
                      >
                        {ALL_ROLES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                      </select>
                      <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3 h-3 text-text-muted pointer-events-none" />
                    </div>
                  </td>
                  <td className="px-4 py-3.5">
                    <button
                      className={cn(
                        "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11.5px] font-semibold transition-all disabled:opacity-50 disabled:cursor-not-allowed",
                        u.is_active
                          ? "bg-green-bg text-green hover:bg-green/15 ring-1 ring-green/15"
                          : "bg-bg-ctrl text-text-muted hover:bg-bg-hover ring-1 ring-border"
                      )}
                      disabled={updatingId === u.id || isSelf}
                      onClick={() => toggleStatus(u.id, !u.is_active)}
                    >
                      <span className={cn("size-1.5 rounded-full", u.is_active ? "bg-green" : "bg-text-light")} />
                      {u.is_active ? "Aktif" : "Nonaktif"}
                    </button>
                  </td>
                  <td className="px-4 py-3.5 text-right">
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
            <div key={u.id} className="surface p-4">
              <div className="flex items-center gap-3 mb-3">
                <div className="w-10 h-10 rounded-full bg-gradient-to-br from-primary to-primary-hover text-white flex items-center justify-center text-[12px] font-bold shrink-0 shadow-[0_1px_3px_rgba(37,99,235,0.25)]">
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
    <div className="px-4 md:px-8 py-6 max-w-2xl">
      <div className="mb-5">
        <h2 className="text-[16px] font-bold text-text leading-tight">Nomor Urutan Dokumen</h2>
        <p className="text-[12.5px] text-text-muted mt-1 leading-relaxed">
          Nomor yang tersimpan adalah nomor <span className="font-semibold text-text">terakhir digunakan</span>.
          Upload berikutnya akan mendapat nomor +1. Setel ke nomor terakhir arsip fisik agar penomoran berlanjut.
        </p>
      </div>

      {error && <ErrorBanner message={error} onClose={() => setError(null)} />}

      <div className="surface overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="bg-bg-ctrl border-b border-border">
              <th className="px-4 py-3 text-left text-[11px] font-bold uppercase tracking-[0.06em] text-text-muted w-[80px]">Tipe</th>
              <th className="px-4 py-3 text-left text-[11px] font-bold uppercase tracking-[0.06em] text-text-muted">Keterangan</th>
              <th className="px-4 py-3 text-right text-[11px] font-bold uppercase tracking-[0.06em] text-text-muted w-[180px]">Nomor Terakhir</th>
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
    <div className="px-4 md:px-8 py-6 max-w-4xl">
      <div className="mb-5">
        <h2 className="text-[16px] font-bold text-text leading-tight">Jenis File Dokumen</h2>
        <p className="text-[12.5px] text-text-muted mt-1 leading-relaxed">
          Daftar jenis file yang dikenali sistem. Kode dipakai dalam penomoran otomatis dokumen
          (contoh: <span className="font-mono font-semibold text-text">DRW-PLB-0125.pdf</span>).
          Kode <span className="font-semibold text-text">tidak dapat diubah</span> setelah dibuat karena dokumen
          lama merujuk ke kode tersebut — nonaktifkan saja kalau jenis sudah tidak dipakai.
        </p>
      </div>

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
          <Loader2 className="w-5 h-5 animate-spin text-primary" />
        </div>
      ) : (
        <div className="surface overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="bg-bg-ctrl border-b border-border">
                <th className="px-4 py-3 text-left text-[11px] font-bold uppercase tracking-[0.06em] text-text-muted w-[90px]">Kode</th>
                <th className="px-4 py-3 text-left text-[11px] font-bold uppercase tracking-[0.06em] text-text-muted w-[180px]">Nama</th>
                <th className="px-4 py-3 text-left text-[11px] font-bold uppercase tracking-[0.06em] text-text-muted">Keterangan</th>
                <th className="px-4 py-3 text-left text-[11px] font-bold uppercase tracking-[0.06em] text-text-muted w-[110px]">Status</th>
                <th className="px-4 py-3 text-right text-[11px] font-bold uppercase tracking-[0.06em] text-text-muted w-[140px]">Aksi</th>
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
  can_create_folder: boolean;
  can_rename_folder: boolean;
  can_delete_folder: boolean;
};
type FolderDraft = Record<string, Record<string, FolderPerm>>;

const FOLDER_PERM_FIELDS: { key: keyof FolderPerm; label: string; width: string }[] = [
  { key: "can_view", label: "View", width: "w-[58px]" },
  { key: "can_upload", label: "Upload", width: "w-[62px]" },
  { key: "can_create_folder", label: "Buat Folder", width: "w-[78px]" },
  { key: "can_download", label: "Download", width: "w-[72px]" },
  { key: "can_rename", label: "Rename", width: "w-[62px]" },
  { key: "can_rename_folder", label: "Rename Folder", width: "w-[88px]" },
  { key: "can_delete", label: "Hapus", width: "w-[58px]" },
  { key: "can_delete_folder", label: "Hapus Folder", width: "w-[88px]" },
  { key: "can_move", label: "Pindah", width: "w-[62px]" },
];

const EMPTY_FOLDER_PERM: FolderPerm = {
  can_view: false, can_upload: false, can_download: false,
  can_rename: false, can_delete: false, can_move: false,
  can_create_folder: false, can_rename_folder: false, can_delete_folder: false,
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
            can_create_folder: perm.can_create_folder,
            can_rename_folder: perm.can_rename_folder,
            can_delete_folder: perm.can_delete_folder,
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
            can_create_folder: perm.can_create_folder, can_rename_folder: perm.can_rename_folder, can_delete_folder: perm.can_delete_folder,
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
      // -- Module permissions (PUT /api/admin/permissions) --
      const permissions: Record<string, string[]> = {};
      for (const [role, perms] of Object.entries(draft)) {
        permissions[role] = Array.from(perms);
      }
      const headers = await authHeaders();
      const permRes = await fetch(`${API_URL}/api/admin/permissions`, {
        method: "PUT",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({ permissions }),
      });
      if (!permRes.ok) {
        const e = await permRes.json().catch(() => ({}));
        throw new Error((e as { detail?: string }).detail || "Gagal menyimpan izin modul");
      }

      // -- Folder permissions --
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
    <div className="px-4 md:px-8 py-6">
      <div className="mb-5">
        <h2 className="text-[16px] font-bold text-text leading-tight">Permission Role</h2>
        <p className="text-[12.5px] text-text-muted mt-1 leading-relaxed">
          Konfigurasi izin modul dan akses folder per role. Klik nama role untuk membuka pengaturan detail.
        </p>
      </div>

      {error && <ErrorBanner message={error} onClose={() => setError(null)} />}
      {success && (
        <div className="mb-3 px-3.5 py-2.5 rounded-[var(--r)] bg-green-bg text-green text-[13px] border border-green/20 flex items-center gap-2">
          <CheckCircle className="w-3.5 h-3.5 shrink-0" /> {success}
        </div>
      )}

      <div className="flex flex-col gap-2.5">
        {/* Admin — locked */}
        <div className="surface px-4 py-3.5 flex items-center gap-3 bg-bg-ctrl">
          <div className="w-9 h-9 rounded-full bg-amber-bg text-amber flex items-center justify-center shrink-0 ring-1 ring-amber/15">
            <Lock className="w-4 h-4" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-[13.5px] font-semibold text-text leading-tight">Administrator</div>
            <div className="text-[11.5px] text-text-muted mt-0.5">Semua izin aktif secara otomatis</div>
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
            <div key={role} className={cn("surface overflow-hidden transition-all", isExpanded && "shadow-[var(--shadow-sm)]")}>
              <button
                type="button"
                onClick={() => setExpanded(isExpanded ? null : role)}
                className="w-full flex items-center gap-3 px-4 py-3.5 text-left hover:bg-bg-hover transition-colors"
              >
                <div className="w-9 h-9 rounded-full bg-gradient-to-br from-primary to-primary-hover text-white text-[11px] font-bold flex items-center justify-center shrink-0 shadow-[0_1px_3px_rgba(37,99,235,0.20)]">
                  {initials}
                </div>
                <span className="text-[13.5px] font-semibold text-text flex-1">{label}</span>
                <span className={cn("badge", folderCount > 0 ? "badge-blue" : "badge-muted")}>{folderCount}/{folders.length} folder</span>
                <ChevronDown className={cn("w-4 h-4 text-text-muted transition-transform duration-200 shrink-0", isExpanded && "rotate-180")} />
              </button>

              {isExpanded && (
                <div className="border-t border-border px-4 py-4 space-y-6">
                  {/* === Module permissions — one card per module === */}
                  <div>
                    <div className="text-[11px] font-bold uppercase tracking-[0.08em] text-text-light mb-3">
                      Izin Modul
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      {PERM_MODULE_CARDS.map((mod) => {
                        const activeInMod = mod.perms.filter((p) => draft[role].has(p)).length;
                        return (
                          <div key={mod.id} className={cn("stat-card", `stat-card-${mod.accent}`)}>
                            <div className="flex items-start justify-between gap-2 mb-2">
                              <div>
                                <div className="text-[13px] font-bold text-text">{mod.label}</div>
                                <div className="text-[11px] text-text-muted mt-0.5">{mod.description}</div>
                              </div>
                              <span className={cn("badge text-[10.5px] shrink-0", activeInMod > 0 ? `badge-${mod.accent === "purple" ? "purple" : mod.accent}` : "badge-muted")}>
                                {activeInMod}/{mod.perms.length}
                              </span>
                            </div>
                            <div className="flex flex-col gap-1.5 mt-3">
                              {mod.perms.map((perm) => (
                                <label
                                  key={perm}
                                  className="flex items-start gap-2 cursor-pointer select-none px-2 py-1.5 rounded-[var(--r-sm)] hover:bg-bg-hover transition-colors"
                                >
                                  <input
                                    type="checkbox"
                                    checked={draft[role].has(perm)}
                                    onChange={() => togglePerm(role, perm)}
                                    className="mt-0.5 size-3.5 cursor-pointer accent-primary shrink-0"
                                  />
                                  <span className="text-[12px] text-text leading-snug flex-1">
                                    {PERMISSION_LABELS[perm] ?? perm}
                                  </span>
                                </label>
                              ))}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* === Folder access (per-folder DCC perms) === */}
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
      <div className="text-center">
        <Loader2 className="size-6 mx-auto mb-3 text-primary animate-spin" />
        <p className="text-[13px] text-text-muted">{label}</p>
      </div>
    </div>
  );
}

function ErrorBanner({ message, onClose }: { message: string; onClose: () => void }) {
  return (
    <div className="mb-4 px-3.5 py-2.5 rounded-[var(--r)] bg-red-bg text-red text-[13px] border border-red/20 flex items-center gap-2">
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
    <div className="modal-backdrop" onClick={onCancel}>
      <div className="modal-panel max-w-md" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="px-6 pt-6 pb-4 border-b border-border-soft flex items-start gap-3">
          <div className="size-10 rounded-[var(--r-lg)] bg-gradient-to-br from-primary to-primary-hover text-white flex items-center justify-center shrink-0 shadow-[0_2px_8px_rgba(37,99,235,0.25)]">
            <UserPlus className="size-5" />
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-[16px] font-bold text-text leading-tight">Tambah Pengguna</h2>
            <p className="text-[12px] text-text-muted mt-0.5">Buat akun baru untuk staff Anda</p>
          </div>
          <button onClick={onCancel} className="btn btn-ghost btn-icon btn-sm -mr-1 -mt-1">
            <X className="size-4" />
          </button>
        </div>

        {/* Body */}
        <div className="px-6 py-5 flex flex-col gap-4">
          <FieldRow label="Nama Lengkap">
            <input type="text" className="field-input" placeholder="Contoh: Budi Hartono" value={form.full_name}
              onChange={(e) => setForm((p) => ({ ...p, full_name: e.target.value }))} />
          </FieldRow>
          <FieldRow label="Username">
            <input type="text" autoCapitalize="none" autoCorrect="off" spellCheck={false}
              className="field-input font-mono" placeholder="contoh: budi" value={form.username}
              onChange={(e) => setForm((p) => ({ ...p, username: e.target.value.toLowerCase() }))} />
            <p className="text-[11px] text-text-light mt-1.5">
              Huruf kecil, angka, titik, _ atau −. 3–32 karakter.
            </p>
          </FieldRow>
          <FieldRow label="Password Awal">
            <div className="relative">
              <input type={showPw ? "text" : "password"} className="field-input pr-10" placeholder="Minimal 6 karakter"
                value={form.password} onChange={(e) => setForm((p) => ({ ...p, password: e.target.value }))} />
              <button type="button" className="absolute right-2.5 top-1/2 -translate-y-1/2 text-text-muted hover:text-primary p-0.5 rounded transition-colors"
                onClick={() => setShowPw((v) => !v)} tabIndex={-1}>
                {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </FieldRow>
          <FieldRow label="Role">
            <div className="relative">
              <select className="field-select appearance-none pr-8 cursor-pointer" value={form.role}
                onChange={(e) => setForm((p) => ({ ...p, role: e.target.value as AppRole }))}>
                {ALL_ROLES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
              <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted pointer-events-none" />
            </div>
          </FieldRow>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-border-soft bg-bg-ctrl flex gap-2 justify-end">
          <button className="btn btn-default" onClick={onCancel}>Batal</button>
          <button
            className="btn btn-primary gap-1.5"
            disabled={creating || !form.username || !form.password || !form.full_name}
            onClick={onCreate}
          >
            {creating ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Membuat…</> : <>Buat Pengguna</>}
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
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-panel max-w-sm" onClick={(e) => e.stopPropagation()}>
        <div className="px-6 pt-6 pb-4 border-b border-border-soft flex items-start gap-3">
          <div className="size-10 rounded-[var(--r-lg)] bg-amber-bg text-amber flex items-center justify-center shrink-0 ring-1 ring-amber/20">
            <KeyRound className="size-5" />
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-[16px] font-bold text-text leading-tight">Reset Password</h2>
            <p className="text-[12px] text-text-muted mt-0.5 truncate">
              <span className="font-semibold text-text">{target.full_name}</span> · <span className="font-mono">{target.username}</span>
            </p>
          </div>
          <button onClick={onClose} className="btn btn-ghost btn-icon btn-sm -mr-1 -mt-1">
            <X className="size-4" />
          </button>
        </div>

        <div className="px-6 py-5">
          <FieldRow label="Password Baru">
            <div className="relative">
              <input type={showPw ? "text" : "password"} autoFocus className="field-input pr-10"
                placeholder="Minimal 6 karakter" value={pw} onChange={(e) => setPw(e.target.value)} />
              <button type="button" className="absolute right-2.5 top-1/2 -translate-y-1/2 text-text-muted hover:text-primary p-0.5 rounded transition-colors"
                onClick={() => setShowPw((v) => !v)} tabIndex={-1}>
                {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </FieldRow>
        </div>

        <div className="px-6 py-4 border-t border-border-soft bg-bg-ctrl flex gap-2 justify-end">
          <button className="btn btn-default" onClick={onClose} disabled={submitting}>Batal</button>
          <button className="btn btn-primary gap-1.5" disabled={submitting || pw.length < 6} onClick={submit}>
            {submitting ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Menyimpan…</> : <>Set Password</>}
          </button>
        </div>
      </div>
    </div>
  );
}

function FieldRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-[12px] font-semibold text-text-muted mb-1.5 block tracking-tight">{label}</label>
      {children}
    </div>
  );
}
