import { addDays, weekEnd } from "./weekly-schedule";
export type TimelineScale = "week" | "month" | "all";
export function timelineRange(scale:TimelineScale, anchor:string, rows:{start:string;end:string}[]) {
  if(scale==="all"&&rows.length)return {start:rows.reduce((v,r)=>r.start<v?r.start:v,rows[0].start),end:rows.reduce((v,r)=>r.end>v?r.end:v,rows[0].end)};
  if(scale==="week"){const end=weekEnd(anchor);return {start:addDays(end,-6),end};}
  const start=anchor.slice(0,7)+"-01";
  const next=new Date(`${start}T00:00:00Z`);next.setUTCMonth(next.getUTCMonth()+1);
  return {start,end:addDays(next.toISOString().slice(0,10),-1)};
}
