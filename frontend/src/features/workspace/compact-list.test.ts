import { expect,test } from "bun:test";
import type { BoardTask } from "@/lib/api/workspace";
import { compactTarget,filterWork,pageSlice,personInitials,taskPeople } from "./compact-list";
const tasks=Array.from({length:1200},(_,i)=>({id:String(i),wo_number:i+1,name:`Pekerjaan plant ${i}`,description:i===1199?"Komponen turbin khusus":"",phase_name:"Refurbishment",deadline:i%2?"2026-11-08":"2026-11-01",status:i%5===0?"done":"todo",assigned_to:"primary",assigned_name:"Andi",planning:{assignees:[{id:"primary",name:"Andi"},{id:"secondary",name:"Budi",avatar_url:"/photo.png"}]}} as BoardTask));
test("large project renders bounded pages while search covers every WO",()=>{
  expect(pageSlice(tasks,0).items).toHaveLength(25);
  const result=filterWork(tasks,"turbin khusus","secondary","","2026-11-06");
  expect(result.map(task=>task.wo_number)).toEqual([1200]);
  expect(pageSlice(tasks,47).items.at(-1)?.wo_number).toBe(1200);
});
test("filtering clamps an old page without losing matched records",()=>{
  const result=pageSlice(tasks.slice(0,3),90);
  expect(result.page).toBe(0);expect(result.start).toBe(1);expect(result.end).toBe(3);
  expect(pageSlice([],5)).toMatchObject({page:0,total:0,start:0,end:0});
});
test("target filter excludes closed overdue work and includes secondary PIC",()=>{
  const late=filterWork(tasks,"","secondary","late","2026-11-06");
  expect(late.length).toBeGreaterThan(0);
  expect(late.every(task=>task.status!=="done"&&task.deadline!<"2026-11-06")).toBe(true);
  expect(filterWork(tasks,"","missing","","2026-11-06")).toHaveLength(0);
});
test("avatar names and initial fallback preserve all PICs",()=>{
  expect(taskPeople(tasks[0])[1].avatar_url).toBe("/photo.png");
  expect(personInitials(" Fikri   Mustaqim ")).toBe("FM");
  expect(personInitials("Éka")).toBe("É");
  expect(personInitials("")).toBe("?");
  expect(compactTarget("2027-08-02")).toContain("27");
});
