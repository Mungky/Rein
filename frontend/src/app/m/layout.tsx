/**
 * Mobile-optimized layout for field workers.
 *
 * No sidebar, no topbar — just a minimal full-screen viewport.
 * Auth check happens via the shared SupabaseProvider in root layout.
 */

export default function MobileLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-full bg-bg-ctrl flex flex-col">
      {children}
    </div>
  );
}
