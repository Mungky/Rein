"use client";

/** Admin — Users tab: list, create, rename, role change, activate/deactivate,
 *  reset password. Moved verbatim from app/(app)/admin/page.tsx. */

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
  Eye,
  EyeOff,
  Loader2,
  Trash2,
} from "lucide-react";
import type { AppRole } from "@/lib/utils/roles";
import { cn } from "@/lib/utils";
import { isValidUsername } from "@/lib/auth/username";
import { API_URL, ALL_ROLES, authHeaders, FieldRow } from "./shared";

export interface UserProfile {
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

export function UsersTab({ currentUserId }: { currentUserId?: string }) {
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newUser, setNewUser] = useState<NewUserForm>({ username: "", password: "", full_name: "", role: "engineer_mechanical" });
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [editingNameFor, setEditingNameFor] = useState<string | null>(null);
  const [nameDraft, setNameDraft] = useState("");
  const [editingUsernameFor, setEditingUsernameFor] = useState<string | null>(null);
  const [usernameDraft, setUsernameDraft] = useState("");
  const [resetTarget, setResetTarget] = useState<UserProfile | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<UserProfile | null>(null);
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

  const saveUsername = async (userId: string) => {
    const trimmed = usernameDraft.trim().toLowerCase();
    if (!trimmed) return;
    if (!isValidUsername(trimmed)) {
      setError("Username hanya boleh huruf kecil, angka, titik, garis bawah, atau strip (3-32 karakter).");
      return;
    }
    setUpdatingId(userId); setError(null);
    try {
      const headers = await authHeaders();
      const res = await fetch(`${API_URL}/api/admin/users/${userId}/username`, {
        method: "PATCH", headers: { ...headers, "Content-Type": "application/json" }, body: JSON.stringify({ username: trimmed }),
      });
      if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error((e as { detail?: string }).detail || "Gagal mengubah username"); }
      setEditingUsernameFor(null);
      fetchUsers();
    } catch (err) { setError(err instanceof Error ? err.message : "Terjadi kesalahan"); }
    finally { setUpdatingId(null); }
  };

  const deleteUser = async (target: UserProfile) => {
    setUpdatingId(target.id); setError(null);
    try {
      const headers = await authHeaders();
      const res = await fetch(`${API_URL}/api/admin/users/${target.id}`, {
        method: "DELETE",
        headers,
      });
      if (!res.ok) {
        const errPayload: unknown = await res.json().catch(() => null);
        const detail = errPayload && typeof errPayload === "object" && "detail" in errPayload && typeof errPayload.detail === "string" ? errPayload.detail : "Gagal menghapus pengguna";
        throw new Error(detail);
      }
      setDeleteTarget(null);
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
      {deleteTarget && (
        <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) setDeleteTarget(null); }}>
          <div className="modal-panel max-w-sm" onClick={(e) => e.stopPropagation()}>
            <div className="px-5 py-4 border-b border-border-soft flex items-center justify-between">
              <h3 className="text-[15px] font-bold text-text">Hapus Pengguna</h3>
              <button onClick={() => setDeleteTarget(null)} aria-label="Tutup dialog" className="btn btn-ghost btn-icon btn-sm">
                <X className="size-4" />
              </button>
            </div>
            <div className="p-5 text-[13px] text-text-muted space-y-2">
              <p>
                Hapus akun <strong className="text-text font-semibold">{deleteTarget.full_name}</strong> (@{deleteTarget.username})?
              </p>
              <p className="text-[12px] text-text-light">
                Akun ini tidak akan bisa login lagi dan akan dihapus dari daftar pengguna, tetapi namanya tetap dipertahankan di riwayat Project dengan penanda merah (Sudah tidak bekerja).
              </p>
            </div>
            <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-border-soft bg-bg-ctrl/40">
              <button
                type="button"
                disabled={updatingId === deleteTarget.id}
                onClick={() => setDeleteTarget(null)}
                className="btn btn-default btn-sm"
              >
                Batal
              </button>
              <button
                type="button"
                disabled={updatingId === deleteTarget.id}
                onClick={() => deleteUser(deleteTarget)}
                className="btn btn-sm bg-red text-white hover:bg-red/90"
              >
                {updatingId === deleteTarget.id && <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" />}
                Hapus Akun
              </button>
            </div>
          </div>
        </div>
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
                      <div className="w-9 h-9 rounded-full overflow-hidden bg-gradient-to-br from-primary to-primary-hover text-white flex items-center justify-center text-[11px] font-bold shrink-0 shadow-[0_1px_3px_rgba(37,99,235,0.25)]">
                        {u.avatar_url ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={u.avatar_url} alt={u.full_name} className="size-full object-cover" />
                        ) : (
                          u.initials || u.full_name?.slice(0, 2).toUpperCase() || "??"
                        )}
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
                          <button className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity text-text-light hover:text-primary p-0.5" aria-label={`Ubah nama ${u.full_name}`} onClick={() => { setEditingNameFor(u.id); setNameDraft(u.full_name); }}>
                            <Pencil className="w-3 h-3" />
                          </button>
                        </div>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3.5 text-[12.5px] text-text-muted font-mono">
                    {editingUsernameFor === u.id ? (
                      <div className="flex items-center gap-1.5">
                        <input
                          autoFocus value={usernameDraft}
                          onChange={(e) => setUsernameDraft(e.target.value.toLowerCase())}
                          onKeyDown={(e) => { if (e.key === "Enter") saveUsername(u.id); if (e.key === "Escape") setEditingUsernameFor(null); }}
                          className="field-input text-[12px] font-mono w-[150px] h-8"
                        />
                        <button className="btn btn-primary btn-icon btn-sm" onClick={() => saveUsername(u.id)} disabled={updatingId === u.id}><Save className="w-3.5 h-3.5" /></button>
                        <button className="btn btn-default btn-icon btn-sm" onClick={() => setEditingUsernameFor(null)}><X className="w-3.5 h-3.5" /></button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-1.5">
                        <span>{u.username}</span>
                        <button
                          className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity text-text-light hover:text-primary p-0.5"
                          aria-label={`Ubah username ${u.username}`}
                          title="Ubah username (Admin)"
                          onClick={() => { setEditingUsernameFor(u.id); setUsernameDraft(u.username); }}
                        >
                          <Pencil className="w-3 h-3" />
                        </button>
                      </div>
                    )}
                  </td>
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
                      <div className="inline-flex items-center justify-end gap-1.5">
                        <button className="btn btn-default btn-sm gap-1.5" onClick={() => setResetTarget(u)}>
                          <KeyRound className="w-3.5 h-3.5" /> Reset Password
                        </button>
                        <button
                          className="btn btn-default btn-sm gap-1.5 text-red hover:bg-red-bg hover:border-red/30 disabled:opacity-40 disabled:cursor-not-allowed"
                          disabled={isSelf}
                          title={isSelf ? "Tidak dapat menghapus akun sendiri" : `Hapus pengguna ${u.full_name}`}
                          onClick={() => setDeleteTarget(u)}
                        >
                          <Trash2 className="w-3.5 h-3.5" /> Hapus
                        </button>
                      </div>
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
                <button
                  className="btn btn-default btn-sm gap-1 text-red hover:bg-red-bg hover:border-red/30 disabled:opacity-40"
                  disabled={isSelf || updatingId === u.id}
                  onClick={() => setDeleteTarget(u)}
                >
                  <Trash2 className="w-3.5 h-3.5" /> Hapus
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

function CreateUserModal({ form, setForm, onCancel, onCreate, creating }: {
  form: NewUserForm;
  setForm: (updater: (p: NewUserForm) => NewUserForm) => void;
  onCancel: () => void;
  onCreate: () => void;
  creating: boolean;
}) {
  const [showPw, setShowPw] = useState(false);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onCancel(); }}>
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
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
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
