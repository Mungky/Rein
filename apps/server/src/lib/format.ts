/** Format tanggal Indonesia untuk teks notifikasi (in-app & WhatsApp). Input `YYYY-MM-DD`. */
export const longDate = (d: string) =>
  new Intl.DateTimeFormat('id-ID', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${d}T00:00:00Z`));

export const shortDate = (d: string) =>
  new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(
    new Date(`${d}T00:00:00Z`),
  );

const WIB_MS = 7 * 3600_000;

/** Tanggal WIB (`YYYY-MM-DD`) dari sebuah waktu, digeser `addDays` hari. */
export function wibDate(now: Date, addDays = 0): string {
  return new Date(now.getTime() + WIB_MS + addDays * 86_400_000).toISOString().slice(0, 10);
}

/** Awal hari WIB (00:00 WIB) dari sebuah waktu, sebagai Date UTC. */
export function wibDayStart(now: Date): Date {
  return new Date(`${wibDate(now)}T00:00:00+07:00`);
}

/** Jam WIB `HH:MM` dari sebuah waktu. */
export function wibClock(now: Date): string {
  return new Date(now.getTime() + WIB_MS).toISOString().slice(11, 16);
}

/**
 * Jam tenang (PRD §6.2 butir 4). `start`/`end` = `HH:MM[:SS]` WIB; rentang boleh melewati
 * tengah malam (21:00–07:00). Mengembalikan waktu berakhirnya jam tenang bila `now` di dalamnya.
 */
export function quietUntil(now: Date, start: string, end: string): Date | null {
  const s = start.slice(0, 5);
  const e = end.slice(0, 5);
  if (s === e) return null;
  const t = wibClock(now);
  const inside = s < e ? t >= s && t < e : t >= s || t < e;
  if (!inside) return null;
  const today = new Date(`${wibDate(now)}T${e}:00+07:00`);
  return today.getTime() > now.getTime() ? today : new Date(today.getTime() + 86_400_000);
}
