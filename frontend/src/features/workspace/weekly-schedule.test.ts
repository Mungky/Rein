import { expect, test } from "bun:test";
import { calendarDate, monthWeeks, moveDeadline, weekEnd } from "./weekly-schedule";

test("deadline 2 August stays in Minggu 2 Agustus; Monday belongs to following week", () => {
  expect(weekEnd("2026-08-02")).toBe("2026-08-02");
  expect(weekEnd("2026-07-27")).toBe("2026-08-02");
  expect(weekEnd("2026-08-03")).toBe("2026-08-09");
});
test("week columns span months, leap days and year boundary", () => {
  expect(monthWeeks("2026-08")).toEqual(["2026-08-02", "2026-08-09", "2026-08-16", "2026-08-23", "2026-08-30", "2026-09-06"]);
  expect(weekEnd("2026-12-31")).toBe("2027-01-03");
  expect(monthWeeks("2028-02").at(-1)).toBe("2028-03-05");
});
test("schedule grouping follows Jakarta date regardless of browser timezone", () => {
  expect(calendarDate("2026-08-02T17:00:00Z")).toBe("2026-08-03");
  expect(calendarDate("2026-08-02T16:59:59Z")).toBe("2026-08-02");
  expect(calendarDate(null)).toBeNull();
  expect(calendarDate("2026-02-30")).toBeNull();
});
test("drag preserves weekday and handles unscheduled WO", () => {
  expect(moveDeadline("2026-07-30", "2026-08-09")).toBe("2026-08-06");
  expect(moveDeadline("2026-08-02", "2026-08-09")).toBe("2026-08-09");
  expect(moveDeadline(null, "2026-08-09")).toBe("2026-08-09");
});
