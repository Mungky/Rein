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
  Building2,
  Briefcase,
  Plus,
  Trash2,
  CheckCircle,
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
import { clientsApi, projectsApi, type Client, type Project } from "@/lib/api/clients";

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

/* ── Permission groups ── */
const PERM_GROUPS: { label: string; perms: Permission[] }[] = [
  { label: "Dashboard", perms: ["dashboard:view"] },
  {
    label: "Document Manager",
    perms: [
      "dcc:view", "dcc:upload", "dcc:search", "dcc:approve",
      "dcc:manage_access", "dcc:manage_clients", "dcc:delete", "dcc:chat",
    ],
  },
  {
    label: "Sidebar & Modul",
    perms: ["sidebar:crm", "sidebar:projects", "sidebar:finance", "sidebar:hr"],
  },
  { label: "Administrasi", perms: ["admin:manage_users"] },
];

/* ═══════════════════════════════════════════════════════════════
   Root page
   ═══════════════════════════════════════════════════════════════ */
export default function AdminPage() {
  const { profile } = useAuth();
  const [tab, setTab] = useState<"users" | "klien" | "proyek" | "permissions">("users");

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
          <TabButton active={tab === "klien"} onClick={() => setTab("klien")} icon={<Building2 className="w-3.5 h-3.5" />}>
            Klien
          </TabButton>
          <TabButton active={tab === "proyek"} onClick={() => setTab("proyek")} icon={<Briefcase className="w-3.5 h-3.5" />}>
            Proyek
          </TabButton>
          <TabButton active={tab === "permissions"} onClick={() => setTab("permissions")} icon={<ShieldCheck className="w-3.5 h-3.5" />}>
            Permission Role
          </TabButton>
        </div>

        <div className="flex-1 overflow-y-auto">
          {tab === "users" && <UsersTab currentUserId={profile?.id} />}
          {tab === "klien" && <KlienTab />}
          {tab === "proyek" && <ProyekTab />}
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
      if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.detail || "Gagal membuat pengguna"); }
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
      if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.detail || "Gagal mengubah role"); }
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
      if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.detail || "Gagal mengubah status"); }
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
      if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.detail || "Gagal menyimpan nama"); }
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
   Klien tab
   ═══════════════════════════════════════════════════════════════ */
function KlienTab() {
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ code: "", name: "" });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState({ code: "", name: "" });
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  const fetchClients = useCallback(async () => {
    try {
      const data = await clientsApi.list(false);
      setClients(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Gagal memuat klien");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchClients(); }, [fetchClients]);

  const handleCreate = async () => {
    const code = form.code.trim().toUpperCase();
    const name = form.name.trim();
    if (!code || !name) return;
    setCreating(true); setError(null);
    try {
      await clientsApi.create({ code, name });
      setShowCreate(false); setForm({ code: "", name: "" });
      fetchClients();
    } catch (e) { setError(e instanceof Error ? e.message : "Gagal membuat klien"); }
    finally { setCreating(false); }
  };

  const handleUpdate = async (id: string) => {
    const code = editDraft.code.trim().toUpperCase();
    const name = editDraft.name.trim();
    if (!code || !name) return;
    setUpdatingId(id); setError(null);
    try {
      await clientsApi.update(id, { code, name });
      setEditingId(null);
      fetchClients();
    } catch (e) { setError(e instanceof Error ? e.message : "Gagal mengubah klien"); }
    finally { setUpdatingId(null); }
  };

  const handleDeactivate = async (id: string) => {
    setUpdatingId(id); setError(null);
    try {
      await clientsApi.deactivate(id);
      fetchClients();
    } catch (e) { setError(e instanceof Error ? e.message : "Gagal menonaktifkan klien"); }
    finally { setUpdatingId(null); }
  };

  if (loading) return <LoadingState label="Memuat data klien…" />;

  const active = clients.filter((c) => c.is_active);
  const inactive = clients.filter((c) => !c.is_active);

  return (
    <div className="px-4 md:px-6 py-4">
      <div className="flex items-center gap-3 mb-4">
        <span className="badge badge-blue">{active.length} klien aktif</span>
        <div className="flex-1" />
        <button className="btn btn-primary btn-sm gap-1.5" onClick={() => setShowCreate(true)}>
          <Plus className="w-3.5 h-3.5" /> Tambah Klien
        </button>
      </div>

      {error && <ErrorBanner message={error} onClose={() => setError(null)} />}

      {/* Create form */}
      {showCreate && (
        <div className="mb-4 p-4 bg-bg border border-border rounded-lg">
          <div className="text-[13px] font-semibold text-text mb-3">Klien Baru</div>
          <div className="flex gap-2 flex-wrap">
            <input
              placeholder="Kode (cth: PLB)" value={form.code}
              onChange={(e) => setForm((p) => ({ ...p, code: e.target.value.toUpperCase() }))}
              className="h-8 px-2.5 rounded border border-border bg-bg-ctrl text-[13px] outline-none focus:border-primary w-[100px] font-mono uppercase"
            />
            <input
              placeholder="Nama klien" value={form.name}
              onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
              className="h-8 px-2.5 rounded border border-border bg-bg-ctrl text-[13px] outline-none focus:border-primary flex-1 min-w-[160px]"
            />
            <button className="btn btn-primary btn-sm gap-1" disabled={creating || !form.code || !form.name} onClick={handleCreate}>
              <CheckCircle className="w-3.5 h-3.5" /> {creating ? "Menyimpan…" : "Simpan"}
            </button>
            <button className="btn btn-default btn-sm" onClick={() => { setShowCreate(false); setForm({ code: "", name: "" }); }}>
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}

      <div className="rounded-lg border border-border overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="bg-bg-ctrl border-b border-border">
              <th className="px-4 py-2.5 text-left text-[11px] font-bold uppercase tracking-wider text-text-muted w-[100px]">Kode</th>
              <th className="px-4 py-2.5 text-left text-[11px] font-bold uppercase tracking-wider text-text-muted">Nama</th>
              <th className="px-4 py-2.5 text-left text-[11px] font-bold uppercase tracking-wider text-text-muted w-[80px]">Status</th>
              <th className="px-4 py-2.5 text-right text-[11px] font-bold uppercase tracking-wider text-text-muted w-[130px]">Aksi</th>
            </tr>
          </thead>
          <tbody>
            {clients.map((c) => {
              const isEditing = editingId === c.id;
              return (
                <tr key={c.id} className={cn("border-b border-border-soft hover:bg-bg-hover transition-colors", !c.is_active && "opacity-50")}>
                  <td className="px-4 py-2.5">
                    {isEditing ? (
                      <input value={editDraft.code} onChange={(e) => setEditDraft((p) => ({ ...p, code: e.target.value.toUpperCase() }))}
                        className="h-7 px-2 w-[80px] rounded border border-border bg-bg text-[12px] font-mono outline-none focus:border-primary" />
                    ) : (
                      <span className="text-[12.5px] font-mono font-semibold text-text">{c.code}</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5">
                    {isEditing ? (
                      <input value={editDraft.name} onChange={(e) => setEditDraft((p) => ({ ...p, name: e.target.value }))}
                        className="h-7 px-2 w-full rounded border border-border bg-bg text-[12.5px] outline-none focus:border-primary" />
                    ) : (
                      <span className="text-[13px] text-text">{c.name}</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5">
                    <span className={cn("badge", c.is_active ? "badge-green" : "badge-muted")}>
                      {c.is_active ? "Aktif" : "Nonaktif"}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    {updatingId === c.id ? (
                      <span className="text-[11px] text-text-muted animate-pulse">Menyimpan…</span>
                    ) : isEditing ? (
                      <div className="flex justify-end gap-1.5">
                        <button className="btn btn-primary btn-sm btn-icon" onClick={() => handleUpdate(c.id)}><Save className="w-3.5 h-3.5" /></button>
                        <button className="btn btn-default btn-sm btn-icon" onClick={() => setEditingId(null)}><X className="w-3.5 h-3.5" /></button>
                      </div>
                    ) : (
                      <div className="flex justify-end gap-1.5">
                        <button className="btn btn-default btn-sm btn-icon" title="Edit" onClick={() => { setEditingId(c.id); setEditDraft({ code: c.code, name: c.name }); }}>
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        {c.is_active && (
                          <button className="btn btn-default btn-sm btn-icon text-red hover:text-red" title="Nonaktifkan" onClick={() => handleDeactivate(c.id)}>
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
            {clients.length === 0 && (
              <tr><td colSpan={4} className="px-4 py-8 text-center text-[13px] text-text-muted">Belum ada klien</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   Proyek tab
   ═══════════════════════════════════════════════════════════════ */
function ProyekTab() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ code: "", name: "", client_id: "" });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState({ code: "", name: "", client_id: "" });
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [filterClient, setFilterClient] = useState("");

  const fetchAll = useCallback(async () => {
    try {
      const [p, c] = await Promise.all([projectsApi.list(undefined, false), clientsApi.list(false)]);
      setProjects(p); setClients(c);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Gagal memuat data");
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const handleCreate = async () => {
    const code = form.code.trim().toUpperCase();
    const name = form.name.trim();
    if (!code || !name || !form.client_id) return;
    setCreating(true); setError(null);
    try {
      await projectsApi.create({ code, name, client_id: form.client_id });
      setShowCreate(false); setForm({ code: "", name: "", client_id: "" });
      fetchAll();
    } catch (e) { setError(e instanceof Error ? e.message : "Gagal membuat proyek"); }
    finally { setCreating(false); }
  };

  const handleUpdate = async (id: string) => {
    const code = editDraft.code.trim().toUpperCase();
    const name = editDraft.name.trim();
    if (!code || !name || !editDraft.client_id) return;
    setUpdatingId(id); setError(null);
    try {
      await projectsApi.update(id, { code, name, client_id: editDraft.client_id });
      setEditingId(null); fetchAll();
    } catch (e) { setError(e instanceof Error ? e.message : "Gagal mengubah proyek"); }
    finally { setUpdatingId(null); }
  };

  const handleDeactivate = async (id: string) => {
    setUpdatingId(id); setError(null);
    try { await projectsApi.deactivate(id); fetchAll(); }
    catch (e) { setError(e instanceof Error ? e.message : "Gagal menonaktifkan proyek"); }
    finally { setUpdatingId(null); }
  };

  const clientName = (id: string) => clients.find((c) => c.id === id)?.name ?? "—";

  const filtered = filterClient ? projects.filter((p) => p.client_id === filterClient) : projects;

  if (loading) return <LoadingState label="Memuat data proyek…" />;

  return (
    <div className="px-4 md:px-6 py-4">
      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <span className="badge badge-green">{projects.filter((p) => p.is_active).length} proyek aktif</span>
        <div className="flex-1" />
        {/* Filter by client */}
        <div className="relative">
          <select value={filterClient} onChange={(e) => setFilterClient(e.target.value)}
            className="h-[28px] pl-2.5 pr-7 rounded border border-border bg-bg text-[12px] outline-none appearance-none text-text-muted">
            <option value="">Semua Klien</option>
            {clients.filter((c) => c.is_active).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <ChevronDown className="absolute right-1.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-muted pointer-events-none" />
        </div>
        <button className="btn btn-primary btn-sm gap-1.5" onClick={() => setShowCreate(true)}>
          <Plus className="w-3.5 h-3.5" /> Tambah Proyek
        </button>
      </div>

      {error && <ErrorBanner message={error} onClose={() => setError(null)} />}

      {showCreate && (
        <div className="mb-4 p-4 bg-bg border border-border rounded-lg">
          <div className="text-[13px] font-semibold text-text mb-3">Proyek Baru</div>
          <div className="flex gap-2 flex-wrap items-center">
            <input placeholder="Kode" value={form.code} onChange={(e) => setForm((p) => ({ ...p, code: e.target.value.toUpperCase() }))}
              className="h-8 px-2.5 rounded border border-border bg-bg-ctrl text-[13px] outline-none focus:border-primary w-[100px] font-mono uppercase" />
            <input placeholder="Nama proyek" value={form.name} onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
              className="h-8 px-2.5 rounded border border-border bg-bg-ctrl text-[13px] outline-none focus:border-primary flex-1 min-w-[160px]" />
            <div className="relative">
              <select value={form.client_id} onChange={(e) => setForm((p) => ({ ...p, client_id: e.target.value }))}
                className="h-8 pl-2.5 pr-7 rounded border border-border bg-bg-ctrl text-[13px] outline-none appearance-none">
                <option value="">— Pilih Klien —</option>
                {clients.filter((c) => c.is_active).map((c) => <option key={c.id} value={c.id}>{c.code} — {c.name}</option>)}
              </select>
              <ChevronDown className="absolute right-1.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-muted pointer-events-none" />
            </div>
            <button className="btn btn-primary btn-sm gap-1" disabled={creating || !form.code || !form.name || !form.client_id} onClick={handleCreate}>
              <CheckCircle className="w-3.5 h-3.5" /> {creating ? "Menyimpan…" : "Simpan"}
            </button>
            <button className="btn btn-default btn-sm" onClick={() => { setShowCreate(false); setForm({ code: "", name: "", client_id: "" }); }}>
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}

      <div className="rounded-lg border border-border overflow-hidden overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="bg-bg-ctrl border-b border-border">
              {["Kode", "Nama Proyek", "Klien", "Status", "Aksi"].map((h, i) => (
                <th key={h} className={cn("px-4 py-2.5 text-[11px] font-bold uppercase tracking-wider text-text-muted whitespace-nowrap", i === 4 ? "text-right" : "text-left")}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.map((p) => {
              const isEditing = editingId === p.id;
              return (
                <tr key={p.id} className={cn("border-b border-border-soft hover:bg-bg-hover transition-colors", !p.is_active && "opacity-50")}>
                  <td className="px-4 py-2.5">
                    {isEditing ? (
                      <input value={editDraft.code} onChange={(e) => setEditDraft((prev) => ({ ...prev, code: e.target.value.toUpperCase() }))}
                        className="h-7 px-2 w-[80px] rounded border border-border bg-bg text-[12px] font-mono outline-none focus:border-primary" />
                    ) : (
                      <span className="text-[12.5px] font-mono font-semibold text-text">{p.code}</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5">
                    {isEditing ? (
                      <input value={editDraft.name} onChange={(e) => setEditDraft((prev) => ({ ...prev, name: e.target.value }))}
                        className="h-7 px-2 w-full rounded border border-border bg-bg text-[12.5px] outline-none focus:border-primary" />
                    ) : (
                      <span className="text-[13px] text-text">{p.name}</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5">
                    {isEditing ? (
                      <div className="relative">
                        <select value={editDraft.client_id} onChange={(e) => setEditDraft((prev) => ({ ...prev, client_id: e.target.value }))}
                          className="h-7 pl-2 pr-6 rounded border border-border bg-bg text-[12px] outline-none appearance-none">
                          {clients.filter((c) => c.is_active).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                        </select>
                        <ChevronDown className="absolute right-1 top-1/2 -translate-y-1/2 w-3 h-3 text-text-muted pointer-events-none" />
                      </div>
                    ) : (
                      <span className="text-[12.5px] text-text-muted">{clientName(p.client_id)}</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5">
                    <span className={cn("badge", p.is_active ? "badge-green" : "badge-muted")}>
                      {p.is_active ? "Aktif" : "Nonaktif"}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    {updatingId === p.id ? (
                      <span className="text-[11px] text-text-muted animate-pulse">Menyimpan…</span>
                    ) : isEditing ? (
                      <div className="flex justify-end gap-1.5">
                        <button className="btn btn-primary btn-sm btn-icon" onClick={() => handleUpdate(p.id)}><Save className="w-3.5 h-3.5" /></button>
                        <button className="btn btn-default btn-sm btn-icon" onClick={() => setEditingId(null)}><X className="w-3.5 h-3.5" /></button>
                      </div>
                    ) : (
                      <div className="flex justify-end gap-1.5">
                        <button className="btn btn-default btn-sm btn-icon" title="Edit"
                          onClick={() => { setEditingId(p.id); setEditDraft({ code: p.code, name: p.name, client_id: p.client_id }); }}>
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        {p.is_active && (
                          <button className="btn btn-default btn-sm btn-icon text-red" title="Nonaktifkan" onClick={() => handleDeactivate(p.id)}>
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
            {filtered.length === 0 && (
              <tr><td colSpan={5} className="px-4 py-8 text-center text-[13px] text-text-muted">Belum ada proyek</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   Permissions tab — accordion per role
   ═══════════════════════════════════════════════════════════════ */
function PermissionsTab() {
  const { matrix, loaded, refresh } = usePermissions();
  const [draft, setDraft] = useState<Record<AppRole, Set<Permission>> | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<AppRole | null>(null);

  useEffect(() => {
    if (!loaded) return;
    const next: Record<AppRole, Set<Permission>> = {} as Record<AppRole, Set<Permission>>;
    for (const [role] of ALL_ROLES) next[role] = new Set((matrix[role] ?? []) as Permission[]);
    setDraft(next);
  }, [loaded, matrix]);

  const togglePerm = (role: AppRole, perm: Permission) => {
    if (!draft || role === "admin") return;
    setDraft((prev) => {
      if (!prev) return prev;
      const next = { ...prev, [role]: new Set(prev[role]) };
      if (next[role].has(perm)) next[role].delete(perm); else next[role].add(perm);
      return next;
    });
  };

  const resetDraft = () => {
    if (!loaded) return;
    const next: Record<AppRole, Set<Permission>> = {} as Record<AppRole, Set<Permission>>;
    for (const [role] of ALL_ROLES) next[role] = new Set((matrix[role] ?? []) as Permission[]);
    setDraft(next); setError(null); setSuccess(null);
  };

  const save = async () => {
    if (!draft) return;
    setSaving(true); setError(null); setSuccess(null);
    try {
      const payload: Record<string, string[]> = {};
      for (const [role, perms] of Object.entries(draft)) payload[role] = Array.from(perms as Set<Permission>);
      const headers = await authHeaders();
      const res = await fetch(`${API_URL}/api/admin/permissions`, {
        method: "PUT", headers: { ...headers, "Content-Type": "application/json" }, body: JSON.stringify({ permissions: payload }),
      });
      if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.detail || "Gagal menyimpan"); }
      await refresh();
      setSuccess("Permission berhasil diperbarui.");
    } catch (e) { setError(e instanceof Error ? e.message : "Terjadi kesalahan"); }
    finally { setSaving(false); }
  };

  if (!loaded || !draft) {
    return <LoadingState label="Memuat konfigurasi permission…" />;
  }

  const nonAdminRoles = ALL_ROLES.filter(([role]) => role !== "admin");

  return (
    <div className="px-4 md:px-6 py-4">
      <p className="text-[12.5px] text-text-muted mb-4">
        Konfigurasi izin akses per role. Klik nama role untuk melihat dan mengubah izin.
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
                <span className="badge badge-muted">{activeCount}/{ALL_PERMISSIONS.length}</span>
                <ChevronDown className={cn("w-4 h-4 text-text-muted transition-transform duration-200 shrink-0", isExpanded && "rotate-180")} />
              </button>

              {isExpanded && (
                <div className="border-t border-border px-4 py-4">
                  {PERM_GROUPS.map((group) => (
                    <div key={group.label} className="mb-4 last:mb-0">
                      <div className="text-[10px] font-bold uppercase tracking-[0.08em] text-text-light mb-2 px-1">
                        {group.label}
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-1">
                        {group.perms.map((perm) => {
                          const checked = draft[role].has(perm);
                          return (
                            <label
                              key={perm}
                              className="flex items-center gap-2.5 px-2.5 py-2 rounded-[var(--r)] hover:bg-bg-hover cursor-pointer transition-colors duration-140 select-none"
                            >
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={() => togglePerm(role, perm)}
                                className="w-3.5 h-3.5 cursor-pointer accent-primary shrink-0"
                              />
                              <span className="text-[12.5px] text-text leading-snug">{PERMISSION_LABELS[perm]}</span>
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  ))}
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
          <button className="btn btn-primary flex-1" disabled={creating || !form.username || !form.password || !form.full_name} onClick={onCreate}>
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
      if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.detail || "Gagal reset password"); }
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
