/**
 * Mobile-optimized layout for field workers.
 *
 * No sidebar, no topbar — just a minimal full-screen viewport.
 * TIDAK ADA pemeriksaan auth di sini. Komentar lama mengklaim gerbangnya
 * dipegang SupabaseProvider di root layout — provider itu tidak pernah
 * memeriksa apa pun (useSupabase tak pernah dipakai) dan kini sudah dihapus.
 * Rute /m/* juga tidak ada di daftar terjaga middleware. Lihat Fase 3.
 */

export default function MobileLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-full bg-bg-ctrl flex flex-col">
      {children}
    </div>
  );
}
