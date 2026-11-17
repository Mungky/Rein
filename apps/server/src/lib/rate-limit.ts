/**
 * Pembatas jendela tetap di memori proses. Cukup karena REIN berjalan 1 instance (PRD §10).
 * Dipakai untuk: kegagalan login per IP (30/15 menit → blokir 15 menit), kirim ulang email (5/jam).
 */
interface Entry {
  count: number;
  windowStart: number;
  blockedUntil: number;
}

export class FixedWindowLimiter {
  private readonly entries = new Map<string, Entry>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly blockMs: number = windowMs,
  ) {}

  /** Sisa waktu blokir dalam ms (0 = tidak diblokir). */
  blockedFor(key: string, now = Date.now()): number {
    const e = this.entries.get(key);
    return e && e.blockedUntil > now ? e.blockedUntil - now : 0;
  }

  /** Catat satu kejadian. Mengembalikan true jika batas tercapai (key kini diblokir). */
  record(key: string, now = Date.now()): boolean {
    let e = this.entries.get(key);
    if (!e || now - e.windowStart >= this.windowMs) {
      e = { count: 0, windowStart: now, blockedUntil: 0 };
      this.entries.set(key, e);
    }
    e.count += 1;
    if (e.count >= this.limit) {
      e.blockedUntil = now + this.blockMs;
      return true;
    }
    this.prune(now);
    return false;
  }

  /** Untuk kuota (mis. 5 email/jam): true jika masih boleh, sekaligus mencatat. */
  take(key: string, now = Date.now()): boolean {
    if (this.blockedFor(key, now) > 0) return false;
    let e = this.entries.get(key);
    if (!e || now - e.windowStart >= this.windowMs) {
      e = { count: 0, windowStart: now, blockedUntil: 0 };
      this.entries.set(key, e);
    }
    if (e.count >= this.limit) {
      e.blockedUntil = e.windowStart + this.windowMs;
      return false;
    }
    e.count += 1;
    return true;
  }

  reset(key: string): void {
    this.entries.delete(key);
  }

  private prune(now: number): void {
    if (this.entries.size < 10_000) return;
    for (const [k, e] of this.entries) {
      if (e.blockedUntil < now && now - e.windowStart >= this.windowMs) this.entries.delete(k);
    }
  }
}
