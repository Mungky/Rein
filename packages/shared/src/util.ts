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
