import { prefersReducedMotion } from './motion';

export type ThemePref = 'system' | 'light' | 'dark';
const KEY = 'rein:theme';

function readPref(): ThemePref {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'light' || v === 'dark' ? v : 'system';
  } catch {
    return 'system';
  }
}

export const theme = $state<{ pref: ThemePref }>({ pref: 'system' });

function systemDark(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches;
}

export function effectiveTheme(): 'light' | 'dark' {
  if (theme.pref === 'system') return systemDark() ? 'dark' : 'light';
  return theme.pref;
}

function apply(pref: ThemePref): void {
  theme.pref = pref;
  const root = document.documentElement;
  if (pref === 'system') delete root.dataset.theme;
  else root.dataset.theme = pref;
  try {
    if (pref === 'system') localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, pref);
  } catch {
    // storage diblokir — tema tetap berlaku untuk sesi ini
  }
}

/** Dipanggil sekali saat aplikasi dimuat (sebelum render pertama). */
export function initTheme(): void {
  apply(readPref());
}

/**
 * Ganti terang ⇄ gelap dengan efek reveal lingkaran dari titik tombol (View Transitions),
 * sama seperti prototype. Tanpa dukungan API / reduced motion → langsung berganti.
 */
export function toggleTheme(src?: Element | null): void {
  const next = effectiveTheme() === 'dark' ? 'light' : 'dark';
  const run = () => apply(next);
  const doc = document as Document & {
    startViewTransition?: (cb: () => void) => { ready: Promise<void> };
  };
  if (!doc.startViewTransition || prefersReducedMotion()) {
    run();
    return;
  }
  const r = src?.getBoundingClientRect() ?? { left: innerWidth - 40, top: 24, width: 0, height: 0 };
  const x = r.left + r.width / 2;
  const y = r.top + r.height / 2;
  try {
    const t = doc.startViewTransition(run);
    t.ready
      .then(() => {
        const rad = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y));
        document.documentElement.animate(
          { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${rad}px at ${x}px ${y}px)`] },
          {
            duration: 520,
            easing: 'cubic-bezier(.2,.8,.2,1)',
            pseudoElement: '::view-transition-new(root)',
          },
        );
      })
      .catch(() => {});
  } catch {
    run();
  }
}
