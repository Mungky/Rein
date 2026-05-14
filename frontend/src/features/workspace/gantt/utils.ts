import { format, differenceInDays, addDays, startOfDay, eachDayOfInterval, eachWeekOfInterval, eachMonthOfInterval } from "date-fns";
import { id as idLocale } from "date-fns/locale/id";

export type ZoomLevel = "week" | "month" | "quarter";

export interface DateRange {
  start: Date;
  end: Date;
}

export function computeDateRange(dates: (Date | null | undefined)[], padDays = 14): DateRange {
  const valid = dates.filter((d): d is Date => d instanceof Date && !isNaN(d.getTime()));
  if (valid.length === 0) {
    const now = startOfDay(new Date());
    return { start: addDays(now, -padDays), end: addDays(now, 90) };
  }
  const minDate = valid.reduce((a, b) => (a < b ? a : b));
  const maxDate = valid.reduce((a, b) => (a > b ? a : b));
  return {
    start: addDays(startOfDay(minDate), -padDays),
    end: addDays(startOfDay(maxDate), padDays),
  };
}

export function dayOffset(date: Date, rangeStart: Date): number {
  return differenceInDays(startOfDay(date), startOfDay(rangeStart));
}

export function totalDays(range: DateRange): number {
  return Math.max(differenceInDays(range.end, range.start), 1);
}

export function pxPerDay(zoom: ZoomLevel): number {
  switch (zoom) {
    case "week": return 48;
    case "month": return 16;
    case "quarter": return 6;
  }
}

export function formatHeader(date: Date, zoom: ZoomLevel): string {
  switch (zoom) {
    case "week": return format(date, "d MMM", { locale: idLocale });
    case "month": return format(date, "d", { locale: idLocale });
    case "quarter": return format(date, "MMM", { locale: idLocale });
  }
}

export function formatMonthHeader(date: Date): string {
  return format(date, "MMMM yyyy", { locale: idLocale });
}

export function getColumnDates(range: DateRange, zoom: ZoomLevel): Date[] {
  switch (zoom) {
    case "week": return eachDayOfInterval({ start: range.start, end: range.end });
    case "month": return eachDayOfInterval({ start: range.start, end: range.end });
    case "quarter": return eachWeekOfInterval({ start: range.start, end: range.end }, { weekStartsOn: 1 });
  }
}

export function todayOffset(rangeStart: Date): number {
  return dayOffset(new Date(), rangeStart);
}