/** Ukuran file gaya Indonesia: "3,2 MB", "240 KB", "512 B". */
export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  const mb = n / 1024 / 1024;
  return `${(mb < 10 ? mb.toFixed(1) : Math.round(mb).toString()).replace('.', ',')} MB`;
}
