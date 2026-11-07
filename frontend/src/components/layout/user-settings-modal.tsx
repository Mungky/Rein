"use client";

import { useRef, useState } from "react";
import {
  Camera,
  Check,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  Lock,
  Trash2,
  UserCog,
  X,
} from "lucide-react";
import { getSupabaseClient } from "@/lib/supabase/client";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

async function getBearerHeaders(): Promise<Record<string, string>> {
  const supabase = getSupabaseClient();
  const token = supabase
    ? (await supabase.auth.getSession()).data.session?.access_token
    : null;
  return {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

/** Resize & center-crop an image file into a compact 256x256 JPEG data URL. */
async function resizeAvatarImage(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Gagal membaca file gambar"));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("Format gambar tidak didukung"));
      img.onload = () => {
        const size = 256;
        const canvas = document.createElement("canvas");
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          reject(new Error("Canvas tidak tersedia"));
          return;
        }
        const minSide = Math.min(img.width, img.height);
        const sx = (img.width - minSide) / 2;
        const sy = (img.height - minSide) / 2;
        ctx.drawImage(img, sx, sy, minSide, minSide, 0, 0, size, size);
        resolve(canvas.toDataURL("image/jpeg", 0.86));
      };
      img.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  });
}

interface UserSettingsModalProps {
  userName: string;
  userInitials: string;
  username: string;
  roleLabel: string;
  avatarUrl: string | null;
  onClose: () => void;
  onSaved: () => Promise<void> | void;
}

export function UserSettingsModal({
  userName,
  userInitials,
  username,
  roleLabel,
  avatarUrl,
  onClose,
  onSaved,
}: UserSettingsModalProps) {
  const [displayName, setDisplayName] = useState(userName);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(avatarUrl);
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setError("Pilih file gambar (JPG, PNG, atau WebP).");
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setError("Ukuran gambar maksimal 10 MB.");
      return;
    }
    try {
      setError(null);
      const dataUrl = await resizeAvatarImage(file);
      setAvatarPreview(dataUrl);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal memproses foto profil");
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccessMsg(null);

    const trimmedName = displayName.trim();
    if (!trimmedName) {
      setError("Display Name tidak boleh kosong.");
      return;
    }

    if (newPassword || confirmPassword) {
      if (newPassword.length < 6) {
        setError("Password baru minimal 6 karakter.");
        return;
      }
      if (newPassword !== confirmPassword) {
        setError("Konfirmasi password tidak cocok.");
        return;
      }
    }

    setSaving(true);
    try {
      const headers = await getBearerHeaders();

      // 1. Update display name & avatar
      const profileRes = await fetch(`${API_URL}/api/auth/me`, {
        method: "PATCH",
        headers,
        body: JSON.stringify({
          full_name: trimmedName,
          avatar_url: avatarPreview,
        }),
      });
      if (!profileRes.ok) {
        const body = await profileRes.json().catch(() => ({}));
        throw new Error(body.detail || "Gagal menyimpan profil");
      }

      // 2. Update password if filled
      if (newPassword) {
        const pwRes = await fetch(`${API_URL}/api/auth/me/password`, {
          method: "POST",
          headers,
          body: JSON.stringify({ password: newPassword }),
        });
        if (!pwRes.ok) {
          const body = await pwRes.json().catch(() => ({}));
          throw new Error(body.detail || "Gagal memperbarui password");
        }
        setNewPassword("");
        setConfirmPassword("");
      }

      await onSaved();
      setSuccessMsg("Konfigurasi pengguna berhasil disimpan.");
      setTimeout(() => {
        onClose();
      }, 900);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Terjadi kesalahan saat menyimpan");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 backdrop-blur-[3px] p-4 animate-[fadeIn_160ms_ease]"
      onClick={onClose}
    >
      <div
        className="bg-bg border border-border rounded-[var(--r-xl)] shadow-[var(--shadow-lg)] w-full max-w-[480px] overflow-hidden animate-[scaleIn_180ms_cubic-bezier(0.22,1,0.36,1)]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-border-soft bg-bg">
          <div className="flex items-center gap-2.5">
            <div className="size-9 rounded-[var(--r-md)] bg-primary-soft text-primary flex items-center justify-center shrink-0">
              <UserCog className="size-5" />
            </div>
            <div>
              <h2 className="text-[15px] font-bold text-text leading-tight">
                Konfigurasi Pengguna
              </h2>
              <p className="text-[11.5px] text-text-muted mt-0.5">
                Ubah foto profil, display name, dan password akun Anda
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="btn btn-ghost btn-icon btn-sm text-text-muted"
            aria-label="Tutup konfigurasi pengguna"
          >
            <X className="size-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4 max-h-[82vh] overflow-y-auto">
          {/* 1. Foto Profil */}
          <div className="flex items-center gap-4 p-3.5 rounded-[var(--r-lg)] bg-bg-ctrl/60 border border-border-soft">
            <div className="relative size-16 rounded-full overflow-hidden bg-gradient-to-br from-primary to-primary-hover text-white font-bold text-[18px] flex items-center justify-center shrink-0 shadow-xs border-2 border-bg">
              {avatarPreview ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={avatarPreview}
                  alt={displayName}
                  className="size-full object-cover"
                />
              ) : (
                <span>{userInitials}</span>
              )}
            </div>

            <div className="flex-1 min-w-0">
              <div className="text-[12.5px] font-semibold text-text">Foto Profil</div>
              <p className="text-[11px] text-text-muted mt-0.5">
                Format JPG, PNG, atau WebP (otomatis disesuaikan).
              </p>
              <div className="flex flex-wrap items-center gap-2 mt-2">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  onChange={handleFileChange}
                  className="hidden"
                />
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="btn btn-default btn-sm text-[11.5px] gap-1.5"
                >
                  <Camera className="size-3.5" />
                  Ganti Foto
                </button>
                {avatarPreview && (
                  <button
                    type="button"
                    onClick={() => setAvatarPreview(null)}
                    className="btn btn-ghost btn-sm text-[11.5px] text-red hover:bg-red-bg gap-1"
                  >
                    <Trash2 className="size-3.5" />
                    Hapus
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* 2. Display Name */}
          <div>
            <label className="text-[11px] font-bold uppercase tracking-wider text-text-light block mb-1">
              Display Name
            </label>
            <input
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="Nama lengkap yang ditampilkan"
              required
              maxLength={255}
              className="field-input text-[13px] w-full"
            />
          </div>

          {/* 3. Read-Only Username & Role */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
            <div>
              <label className="flex items-center justify-between text-[11px] font-bold uppercase tracking-wider text-text-light mb-1">
                <span>Username</span>
                <Lock className="size-3 text-text-light" />
              </label>
              <input
                type="text"
                value={username ? `@${username}` : "—"}
                disabled
                readOnly
                className="field-input text-[12.5px] font-mono w-full bg-bg-ctrl text-text-muted cursor-not-allowed opacity-80"
              />
            </div>
            <div>
              <label className="flex items-center justify-between text-[11px] font-bold uppercase tracking-wider text-text-light mb-1">
                <span>Role</span>
                <Lock className="size-3 text-text-light" />
              </label>
              <input
                type="text"
                value={roleLabel}
                disabled
                readOnly
                className="field-input text-[12.5px] w-full bg-bg-ctrl text-text-muted cursor-not-allowed opacity-80"
              />
            </div>
            <p className="sm:col-span-2 text-[11px] text-text-light flex items-center gap-1.5">
              <Lock className="size-3 shrink-0" />
              Username dan Role hanya dapat diubah oleh Administrator.
            </p>
          </div>

          {/* 4. Ganti Password */}
          <div className="pt-3 border-t border-border-soft space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5 text-[12.5px] font-bold text-text">
                <KeyRound className="size-3.5 text-primary" />
                <span>Ganti Password</span>
              </div>
              <span className="text-[11px] text-text-light">Kosongkan jika tidak diubah</span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="relative">
                <label className="text-[11px] text-text-muted block mb-1">
                  Password Baru
                </label>
                <div className="relative">
                  <input
                    type={showPassword ? "text" : "password"}
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="Minimal 6 karakter"
                    minLength={6}
                    className="field-input text-[12.5px] w-full pr-8"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-text-light hover:text-text"
                    tabIndex={-1}
                  >
                    {showPassword ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
                  </button>
                </div>
              </div>

              <div>
                <label className="text-[11px] text-text-muted block mb-1">
                  Konfirmasi Password
                </label>
                <input
                  type={showPassword ? "text" : "password"}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Ulangi password baru"
                  className="field-input text-[12.5px] w-full"
                />
              </div>
            </div>
          </div>

          {error && (
            <div className="px-3 py-2 rounded-[var(--r-md)] bg-red-bg border border-red/25 text-[12px] text-red">
              {error}
            </div>
          )}

          {successMsg && (
            <div className="px-3 py-2 rounded-[var(--r-md)] bg-green-bg border border-green/25 text-[12px] text-green flex items-center gap-1.5 font-medium">
              <Check className="size-3.5" />
              {successMsg}
            </div>
          )}

          {/* Footer */}
          <div className="flex items-center justify-end gap-2 pt-3 border-t border-border-soft">
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="btn btn-default text-[12.5px]"
            >
              Batal
            </button>
            <button
              type="submit"
              disabled={saving}
              className="btn btn-primary text-[12.5px] gap-1.5"
            >
              {saving ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Check className="size-3.5" />
              )}
              Simpan Perubahan
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
