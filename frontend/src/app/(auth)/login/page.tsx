"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Eye, EyeOff } from "lucide-react";
import { getSupabaseClient } from "@/lib/supabase/client";
import { usernameToEmail } from "@/lib/auth/username";

function ReinDiamondLogo() {
  return (
    <svg width="40" height="40" viewBox="0 0 48 48" fill="none">
      <path d="M24 4L44 24L24 44L4 24Z" fill="white" opacity="0.95" />
      <path d="M24 14L34 24L24 34L14 24Z" fill="white" opacity="0.22" />
    </svg>
  );
}

export default function LoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);

    const supabase = getSupabaseClient();
    if (!supabase) {
      setError("Supabase belum dikonfigurasi. Hubungi administrator.");
      return;
    }

    const trimmed = username.trim().toLowerCase();
    if (!trimmed) { setError("Username wajib diisi."); return; }
    if (!password) { setError("Kata sandi wajib diisi."); return; }

    setLoading(true);
    try {
      const { error: authError } = await supabase.auth.signInWithPassword({
        email: usernameToEmail(trimmed),
        password,
      });

      if (authError) {
        const msg = authError.message.toLowerCase();
        if (msg.includes("invalid login credentials") || msg.includes("invalid email or password")) {
          setError("Username atau kata sandi salah.");
        } else if (msg.includes("email not confirmed")) {
          setError("Akun belum aktif. Hubungi administrator.");
        } else {
          setError("Gagal masuk. Silakan coba lagi.");
        }
        return;
      }

      router.push("/dashboard");
      router.refresh();
    } catch {
      setError("Terjadi kesalahan jaringan. Silakan coba lagi.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-bg-sidebar px-4 py-10">
      <div className="w-full max-w-[390px]">
        {/* Card */}
        <div className="bg-bg rounded-xl overflow-hidden border border-border shadow-[0_8px_32px_rgba(0,0,0,0.10)]">

          {/* Purple gradient header */}
          <div
            className="px-8 pt-8 pb-7 flex flex-col items-center text-center select-none"
            style={{ background: "linear-gradient(145deg, var(--rein-primary) 0%, var(--rein-primary-hover) 100%)" }}
          >
            <ReinDiamondLogo />
            <h1 className="mt-3 text-[22px] font-black tracking-[0.07em] text-white leading-none">
              REIN
            </h1>
            <p className="mt-1.5 text-[11.5px] text-white/60 tracking-[0.02em]">
              Remula Inti Rekayasa
            </p>
          </div>

          {/* Form section */}
          <div className="px-7 py-6">
            <h2 className="text-[14.5px] font-bold text-text text-center mb-5">
              Masuk ke akun Anda
            </h2>

            {error && (
              <div className="flex items-start gap-2 bg-red-bg text-red text-[12.5px] font-medium px-3 py-2.5 rounded-[var(--r)] mb-4 border border-red/15">
                <svg className="w-3.5 h-3.5 mt-px shrink-0" viewBox="0 0 16 16" fill="currentColor">
                  <path d="M8 1a7 7 0 1 0 0 14A7 7 0 0 0 8 1zm.75 3.5v4a.75.75 0 0 1-1.5 0v-4a.75.75 0 0 1 1.5 0zm-.75 7a.875.875 0 1 1 0-1.75.875.875 0 0 1 0 1.75z" />
                </svg>
                <span>{error}</span>
              </div>
            )}

            <form onSubmit={handleSubmit} className="flex flex-col gap-4">
              {/* Username */}
              <div className="flex flex-col gap-1.5">
                <label htmlFor="username" className="text-[12.5px] font-semibold text-text-muted">
                  Username
                </label>
                <input
                  id="username"
                  type="text"
                  autoComplete="username"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  autoFocus
                  value={username}
                  onChange={(e) => { setUsername(e.target.value); if (error) setError(null); }}
                  placeholder="contoh: budi"
                  disabled={loading}
                  className="h-[38px] w-full rounded-[var(--r)] border border-border bg-bg px-3 text-[13.5px] text-text outline-none transition-colors duration-140 focus:border-primary placeholder:text-text-light disabled:opacity-55 disabled:cursor-not-allowed"
                />
              </div>

              {/* Password */}
              <div className="flex flex-col gap-1.5">
                <label htmlFor="password" className="text-[12.5px] font-semibold text-text-muted">
                  Kata Sandi
                </label>
                <div className="relative">
                  <input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => { setPassword(e.target.value); if (error) setError(null); }}
                    placeholder="Masukkan kata sandi"
                    disabled={loading}
                    className="h-[38px] w-full rounded-[var(--r)] border border-border bg-bg px-3 pr-10 text-[13.5px] text-text outline-none transition-colors duration-140 focus:border-primary placeholder:text-text-light disabled:opacity-55 disabled:cursor-not-allowed"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    tabIndex={-1}
                    className="absolute right-0 top-0 flex h-full w-10 items-center justify-center text-text-light hover:text-text-muted transition-colors duration-140"
                  >
                    {showPassword
                      ? <EyeOff className="w-4 h-4" />
                      : <Eye className="w-4 h-4" />
                    }
                  </button>
                </div>
              </div>

              {/* Submit */}
              <button
                type="submit"
                disabled={loading}
                className="btn btn-primary mt-1 w-full h-[38px] text-[13.5px] font-semibold justify-center disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {loading ? (
                  <span className="flex items-center gap-2">
                    <svg className="w-3.5 h-3.5 animate-spin" viewBox="0 0 24 24" fill="none">
                      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" className="opacity-25" />
                      <path fill="currentColor" className="opacity-80" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    Memproses…
                  </span>
                ) : "Masuk"}
              </button>
            </form>
          </div>
        </div>

        <p className="mt-4 text-center text-[11px] text-text-light px-2">
          Hanya akun yang dibuat oleh administrator yang dapat masuk.
        </p>
      </div>
    </div>
  );
}
