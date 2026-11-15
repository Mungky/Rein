import { hash, verify } from '@node-rs/argon2';

/**
 * argon2id (default @node-rs/argon2), m=19 MiB, t=2, p=1, dengan pepper dari AUTH_PEPPER
 * sebagai `secret` (PRD §5). Dipakai untuk password dan PIN.
 */
function options(pepper: string) {
  return {
    memoryCost: 19456,
    timeCost: 2,
    parallelism: 1,
    secret: new TextEncoder().encode(pepper),
  };
}

export function hashSecret(plain: string, pepper: string): Promise<string> {
  return hash(plain, options(pepper));
}

export async function verifySecret(
  hashed: string | null | undefined,
  plain: string,
  pepper: string,
): Promise<boolean> {
  if (!hashed) return false;
  try {
    return await verify(hashed, plain, options(pepper));
  } catch {
    return false;
  }
}

let dummyHash: Promise<string> | undefined;

/**
 * Samakan waktu respons saat user tidak ditemukan, agar tidak bisa membedakan
 * "user tidak ada" dari "password salah" lewat timing (FR-001 AC2).
 */
export async function burnVerifyTime(pepper: string): Promise<void> {
  dummyHash ??= hashSecret('rein-dummy-password', pepper);
  await verifySecret(await dummyHash, 'bukan-password', pepper);
}
