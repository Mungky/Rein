"use client";

import { useState, type FormEvent } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { Eye, EyeOff } from "lucide-react";
import { getSupabaseClient } from "@/lib/supabase/client";
import { usernameToEmail } from "@/lib/auth/username";
import { safeNextPath } from "@/lib/auth/next-path";
import { useTheme } from "@/components/providers/theme-provider";
import { ThemeToggle } from "@/components/shared/theme-toggle";
export default function LoginPage() {
  const router = useRouter();
  const { theme, toggleTheme } = useTheme();
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

      // Dibaca di sini, bukan saat render: useSearchParams() akan memaksa
      // halaman ini keluar dari prerender statis, dan pada titik ini kita sudah
      // pasti di browser.
      router.push(safeNextPath(window.location.search));
      router.refresh();
    } catch {
      setError("Terjadi kesalahan jaringan. Silakan coba lagi.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-bg-sidebar via-bg to-primary-soft px-4 py-10 relative overflow-hidden">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-[999] focus:rounded-md focus:bg-primary focus:px-4 focus:py-2 focus:text-text-inv focus:shadow-md"
      >
        Lewati ke konten utama
      </a>

      <div className="absolute top-4 right-4 z-10">
        <ThemeToggle theme={theme} toggleTheme={toggleTheme} />
      </div>

      {/* Soft decorative blobs */}
      <div className="pointer-events-none absolute -top-24 -left-24 size-64 rounded-full bg-primary/10 blur-3xl" aria-hidden="true" />
      <div className="pointer-events-none absolute -bottom-32 -right-24 size-72 rounded-full bg-red/10 blur-3xl" aria-hidden="true" />

      <main id="main-content" className="relative w-full max-w-[400px]">
        {/* Brand head — logo on its own (transparent bg shows brand colors) */}
        <div className="flex flex-col items-center text-center select-none mb-6">
          <div className="relative size-[72px]">
            <Image
              src="/rein-logo.png"
              alt="REIN"
              fill
              sizes="72px"
              priority
              className="object-contain drop-shadow-[0_4px_12px_rgba(15,23,42,0.12)]"
            />
          </div>
          <h1 className="mt-3 text-[24px] font-extrabold tracking-[0.04em] text-text leading-none">
            REIN
          </h1>
          <p className="mt-1.5 text-[12px] text-text-muted tracking-tight">
            Remula Inti Rekayasa
          </p>
        </div>

        {/* Card */}
        <div className="bg-bg rounded-[var(--r-2xl)] overflow-hidden border border-border shadow-[var(--shadow)]">
          {/* Form section */}
          <div className="px-7 py-7">
            <h2 className="text-[15px] font-bold text-text text-center mb-1">
              Masuk ke akun Anda
            </h2>
            <p className="text-[12px] text-text-muted text-center mb-5">
              Gunakan username yang diberikan administrator
            </p>

            {error && (
              <div
                id="login-error-msg"
                role="alert"
                className="flex items-start gap-2 bg-red-bg text-red text-[12.5px] font-medium px-3 py-2.5 rounded-[var(--r)] mb-4 border border-red/15"
              >
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
                  aria-invalid={Boolean(error)}
                  aria-describedby={error ? "login-error-msg" : undefined}
                  className="h-[40px] w-full rounded-[var(--r)] border border-border bg-bg px-3.5 text-[13.5px] text-text outline-none transition-all duration-140 focus:border-primary focus:shadow-[0_0_0_3px_var(--rein-primary-bg)] placeholder:text-text-light disabled:opacity-55 disabled:cursor-not-allowed"
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
                    aria-invalid={Boolean(error)}
                    aria-describedby={error ? "login-error-msg" : undefined}
                    className="h-[40px] w-full rounded-[var(--r)] border border-border bg-bg px-3.5 pr-10 text-[13.5px] text-text outline-none transition-all duration-140 focus:border-primary focus:shadow-[0_0_0_3px_var(--rein-primary-bg)] placeholder:text-text-light disabled:opacity-55 disabled:cursor-not-allowed"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    aria-label={showPassword ? "Sembunyikan kata sandi" : "Tampilkan kata sandi"}
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
                className="btn btn-primary mt-2 w-full h-[42px] text-[13.5px] font-semibold justify-center disabled:opacity-60 disabled:cursor-not-allowed"
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
      </main>
    </div>
  );
}
