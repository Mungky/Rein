/** Menghormati prefers-reduced-motion untuk transisi Svelte (CSS sudah ditangani base.css). */
export function prefersReducedMotion(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** Durasi transisi: 0 jika user meminta gerak dikurangi. */
export function dur(ms: number): number {
  return prefersReducedMotion() ? 0 : ms;
}

/** Easing prototype: cubic-bezier(.2,.8,.2,1) sebagai fungsi JS untuk transisi Svelte. */
export function easeOut(t: number): number {
  // Aproksimasi cubic-bezier(.2,.8,.2,1) memakai pencarian biner pada kurva bezier.
  const p1x = 0.2,
    p1y = 0.8,
    p2x = 0.2,
    p2y = 1;
  const bx = (s: number) => 3 * (1 - s) * (1 - s) * s * p1x + 3 * (1 - s) * s * s * p2x + s * s * s;
  const by = (s: number) => 3 * (1 - s) * (1 - s) * s * p1y + 3 * (1 - s) * s * s * p2y + s * s * s;
  let lo = 0,
    hi = 1,
    s = t;
  for (let i = 0; i < 20; i++) {
    s = (lo + hi) / 2;
    if (bx(s) < t) lo = s;
    else hi = s;
  }
  return by(s);
}
