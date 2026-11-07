const DAY = 86_400_000;

/** Dates are Jakarta business dates; UTC is used only for calendar arithmetic. */
export function calendarDate(value?: string | null): string | null {
  if (!value) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const parsed = new Date(`${value}T00:00:00Z`);
    return Number.isFinite(+parsed) && parsed.toISOString().slice(0, 10) === value ? value : null;
  }
  const parsed = new Date(value);
  if (!Number.isFinite(+parsed)) return null;
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(parsed);
  return ["year", "month", "day"].map(type => parts.find(p => p.type === type)?.value).join("-");
}

export function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY).toISOString().slice(0, 10);
}

/** Monday–Sunday; a deadline on Sunday stays in that Sunday's week. */
export function weekEnd(date: string): string {
  return addDays(date, (7 - new Date(`${date}T00:00:00Z`).getUTCDay()) % 7);
}

export function monthWeeks(month: string): string[] {
  const first = weekEnd(`${month}-01`);
  const lastDate = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).toISOString().slice(0, 10);
  const last = weekEnd(lastDate);
  const weeks: string[] = [];
  for (let day = first; day <= last; day = addDays(day, 7)) weeks.push(day);
  return weeks;
}

export function moveDeadline(oldDate: string | null, targetWeekEnd: string): string {
  if (!oldDate) return targetWeekEnd;
  const delta = (Date.parse(`${targetWeekEnd}T00:00:00Z`) - Date.parse(`${weekEnd(oldDate)}T00:00:00Z`)) / DAY;
  return addDays(oldDate, delta);
}

export function shortDate(date: string): string {
  return new Intl.DateTimeFormat("id-ID", { day: "numeric", month: "long", timeZone: "UTC" }).format(new Date(`${date}T00:00:00Z`));
}
