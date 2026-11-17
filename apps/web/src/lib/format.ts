/** Ukuran file gaya Indonesia: "3,2 MB", "240 KB", "512 B". */
export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  const mb = n / 1024 / 1024;
  return `${(mb < 10 ? mb.toFixed(1) : Math.round(mb).toString()).replace('.', ',')} MB`;
}

const TZ = 'Asia/Jakarta';
const asDate = (d: string) => new Date(d.length === 10 ? `${d}T00:00:00+07:00` : d);

/** "20 Nov" */
export function shortDate(d: string): string {
  return new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'short', timeZone: TZ }).format(
    asDate(d),
  );
}

/** "Jumat, 20 November 2026" */
export function longDate(d: string): string {
  return new Intl.DateTimeFormat('id-ID', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: TZ,
  }).format(asDate(d));
}

/** "14.05" untuk hari ini, "Kemarin 14.05", selain itu "12 Nov 14.05". */
export function stamp(iso: string, now = new Date()): string {
  const d = new Date(iso);
  const time = new Intl.DateTimeFormat('id-ID', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: TZ,
  }).format(d);
  const day = (x: Date) => new Date(x.getTime() + 7 * 3600_000).toISOString().slice(0, 10);
  if (day(d) === day(now)) return time;
  if (day(d) === day(new Date(now.getTime() - 86_400_000))) return `Kemarin ${time}`;
  return `${shortDate(day(d))} ${time}`;
}

/** Judul grup per hari untuk inbox/logbook: "Hari ini", "Kemarin", "Senin, 9 November". */
export function dayLabel(iso: string, now = new Date()): string {
  const day = (x: Date) => new Date(x.getTime() + 7 * 3600_000).toISOString().slice(0, 10);
  const d = day(new Date(iso));
  if (d === day(now)) return 'Hari ini';
  if (d === day(new Date(now.getTime() - 86_400_000))) return 'Kemarin';
  return new Intl.DateTimeFormat('id-ID', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: TZ,
  }).format(new Date(iso));
}

/** Nama depan untuk sapaan & ringkasan. */
export const firstName = (full: string) => full.split(' ')[0] ?? full;
