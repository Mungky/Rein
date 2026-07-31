"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { RefreshCw, ShieldX, WifiOff } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { useCan, usePermissions } from "@/components/providers/permissions-provider";
import type { Permission } from "@/lib/utils/roles";

export function PageGuard({
  permission,
  children,
}: {
  permission: Permission;
  children: React.ReactNode;
}) {
  const { user, profile, loading: authLoading } = useAuth();
  const { loaded: permsLoaded, error: permsError, labels, refresh } = usePermissions();
  const allowed = useCan(profile?.role, permission);
  const router = useRouter();
  const pathname = usePathname();

  /** Sesi benar-benar hilang → ke halaman login, JANGAN menggantung.
   *
   *  Cabang `!profile` di bawah dulu merender "Memuat profil…" untuk SEGALA
   *  sebab, selamanya. Dan itu jalur yang benar-benar terjadi: sesi yang
   *  ditolak backend (401) memicu signOut, `user` jadi null, profil tidak
   *  pernah datang — lalu halaman duduk memutar teks "memuat" tanpa batas
   *  waktu, tanpa tombol, tanpa pesan. User tidak punya cara tahu bahwa yang
   *  perlu dilakukan hanyalah login lagi.
   *
   *  Dua sebab "tidak ada profil" dibedakan di sini, karena obatnya berbeda:
   *  tidak ada `user` = sesi mati (login ulang), ada `user` tapi tanpa profil =
   *  backend tak terjangkau (coba lagi — mengirim mereka ke login tidak akan
   *  memperbaiki apa pun dan malah membuang sesi yang masih sah). */
  const sessionGone = !authLoading && !user;
  useEffect(() => {
    if (!sessionGone) return;
    router.replace(`/login?next=${encodeURIComponent(pathname ?? "/dcc")}`);
  }, [sessionGone, router, pathname]);

  if (authLoading || !permsLoaded || sessionGone) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-[13px] text-text-muted animate-pulse">
          {sessionGone ? "Sesi berakhir — membuka halaman masuk…" : "Memuat…"}
        </p>
      </div>
    );
  }

  // Matrix could not be fetched — say so loudly instead of guessing access
  if (permsError && !allowed) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3">
        <div className="w-12 h-12 rounded-full bg-amber-bg text-amber flex items-center justify-center">
          <WifiOff className="w-6 h-6" />
        </div>
        <div className="text-center">
          <p className="text-[15px] font-bold text-text mb-1">Gagal Memuat Izin Akses</p>
          <p className="text-[13px] text-text-muted">
            Server tidak bisa dihubungi, jadi hak akses belum bisa dipastikan.
          </p>
        </div>
        <button onClick={() => void refresh()} className="btn btn-secondary btn-sm gap-1.5">
          <RefreshCw className="size-3.5" /> Coba Lagi
        </button>
      </div>
    );
  }

  // Sesinya masih sah (ada `user`), tapi profilnya tidak bisa diambil — server
  // tidak terjangkau atau membalas 5xx. Katakan apa adanya dan beri jalan
  // mencoba lagi, bukan teks "memuat" yang tidak akan pernah selesai.
  if (!profile) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3">
        <div className="w-12 h-12 rounded-full bg-amber-bg text-amber flex items-center justify-center">
          <WifiOff className="w-6 h-6" />
        </div>
        <div className="text-center">
          <p className="text-[15px] font-bold text-text mb-1">Gagal Memuat Profil</p>
          <p className="text-[13px] text-text-muted">
            Anda masih masuk, tapi server tidak bisa dihubungi untuk memastikan
            hak akses.
          </p>
        </div>
        <button
          onClick={() => window.location.reload()}
          className="btn btn-secondary btn-sm gap-1.5"
        >
          <RefreshCw className="size-3.5" /> Coba Lagi
        </button>
      </div>
    );
  }

  if (!allowed) {
    const label = labels[permission] || permission;
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3">
        <div className="w-12 h-12 rounded-full bg-red-bg text-red flex items-center justify-center">
          <ShieldX className="w-6 h-6" />
        </div>
        <div className="text-center">
          <p className="text-[15px] font-bold text-text mb-1">Akses Ditolak</p>
          <p className="text-[13px] text-text-muted">
            Role <span className="font-semibold text-text">{profile.role}</span> tidak memiliki izin <span className="font-semibold text-text">{label}</span>.
          </p>
          <p className="text-[12px] text-text-light mt-2">
            Hubungi administrator untuk mendapatkan akses.
          </p>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
