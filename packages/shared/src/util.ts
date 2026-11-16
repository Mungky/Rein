/** Utilitas tanpa dependensi (aman untuk bundle klien — tidak menarik Zod). */

/** Normalisasi nomor Indonesia ke E.164 (`+62…`). Mengembalikan null jika tidak valid. */
export function normalizePhoneId(input: string): string | null {
  const digits = input.replace(/[^\d+]/g, '');
  let n = digits;
  if (n.startsWith('+')) n = n.slice(1);
  if (n.startsWith('0')) n = `62${n.slice(1)}`;
  else if (n.startsWith('8')) n = `62${n}`;
  if (!/^62\d{8,13}$/.test(n)) return null;
  return `+${n}`;
}

/**
 * Hanya path internal yang boleh dipakai sebagai tujuan redirect `next` (FR-001 AC1).
 * Menolak URL absolut, protocol-relative (`//host`), dan backslash.
 */
export function safeNextPath(next: string | null | undefined, fallback = '/'): string {
  if (!next || typeof next !== 'string') return fallback;
  if (!next.startsWith('/') || next.startsWith('//') || next.includes('\\')) return fallback;
  for (let i = 0; i < next.length; i++) if (next.charCodeAt(i) < 0x20) return fallback;
  return next;
}

/** Label nomor WO per project: 1 → "WO 01", 120 → "WO 120" (PRD §4.2). */
export function woNumberLabel(seq: number): string {
  return `WO ${String(seq).padStart(2, '0')}`;
}

/** Tanggal hari ini di zona Asia/Jakarta (UTC+7, tanpa DST) sebagai "YYYY-MM-DD". */
export function todayWib(now: Date = new Date()): string {
  return new Date(now.getTime() + 7 * 3600_000).toISOString().slice(0, 10);
}

/** Terlambat = deadline < hari ini dan status bukan Selesai/Dibatalkan (PRD §4.5). */
export function isOverdue(deadline: string, status: string, today: string = todayWib()): boolean {
  return deadline < today && status !== 'done' && status !== 'canceled';
}
