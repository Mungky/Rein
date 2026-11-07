import { expect,test } from "bun:test";
import { timelineRange } from "./timeline-range";
test("bar week uses Monday to Sunday across month boundary",()=>{
  expect(timelineRange("week","2026-08-02",[])).toEqual({start:"2026-07-27",end:"2026-08-02"});
});
test("bar months handle leap years and December rollover",()=>{
  expect(timelineRange("month","2028-02-20",[])).toEqual({start:"2028-02-01",end:"2028-02-29"});
  expect(timelineRange("month","2026-12-10",[])).toEqual({start:"2026-12-01",end:"2026-12-31"});
});
test("all schedules include the earliest start and latest end regardless of row order",()=>{
  expect(timelineRange("all","2026-11-01",[{start:"2026-11-05",end:"2026-12-02"},{start:"2026-08-01",end:"2026-08-02"}])).toEqual({start:"2026-08-01",end:"2026-12-02"});
});
