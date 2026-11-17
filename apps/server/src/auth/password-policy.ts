import { passwordSchema } from '@rein/shared';
import { dictionary } from '@zxcvbn-ts/language-common';

/** 10.000 password paling umum (urut frekuensi, zxcvbn-ts) — PRD §5 & FR-005. */
const COMMON = new Set(
  ((dictionary as Record<string, string[]>)['passwords-common'] ?? [])
    .slice(0, 10_000)
    .map((p) => p.toLowerCase()),
);

/** Kembalikan pesan masalah (Bahasa Indonesia) atau null jika password boleh dipakai. */
export function passwordProblem(
  password: string,
  ctx: { username?: string; email?: string | null } = {},
): string | null {
  const base = passwordSchema.safeParse(password);
  if (!base.success) return base.error.issues[0]?.message ?? 'Password tidak valid';
  const lower = password.toLowerCase();
  if (COMMON.has(lower)) return 'Password terlalu umum, pilih yang lain';
  const local = ctx.email?.split('@')[0]?.toLowerCase();
  if ((ctx.username && lower === ctx.username.toLowerCase()) || (local && lower === local)) {
    return 'Password tidak boleh sama dengan username atau email';
  }
  return null;
}

export function isCommonPassword(password: string): boolean {
  return COMMON.has(password.toLowerCase());
}
