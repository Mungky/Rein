import type { BoardTask } from "@/lib/api/workspace";
import { calendarDate, weekEnd } from "./weekly-schedule";
import { workOrderLabel } from "./work-order-ui";

export function pageSlice<T>(items:T[],page:number,size=25) {
  const pageSize=Math.max(1,Math.min(200,Math.floor(size)||25));
  const pages=Math.max(1,Math.ceil(items.length/pageSize));
  const index=Math.max(0,Math.min(Math.floor(page)||0,pages-1));
  return {items:items.slice(index*pageSize,(index+1)*pageSize),page:index,pages,total:items.length,start:items.length?index*pageSize+1:0,end:Math.min((index+1)*pageSize,items.length)};
}
export function personInitials(name:string) {return name.trim().split(/\s+/).filter(Boolean).slice(0,2).map(word=>[...word][0]).join("").toLocaleUpperCase("id-ID")||"?";}
const targetDateFormat=new Intl.DateTimeFormat("id-ID",{day:"numeric",month:"short",year:"2-digit",timeZone:"UTC"});
export function compactTarget(date:string){return targetDateFormat.format(new Date(`${date}T00:00:00Z`));}
export function taskPeople(task:BoardTask) {
  const people=task.planning?.assignees??[];
  return people.length?people:task.assigned_to?[{id:task.assigned_to,name:task.assigned_name??"PIC",avatar_url:task.assigned_avatar_url}]:[];
}
export type TargetFilter=""|"late"|"week"|"month"|"unscheduled";
export function filterWork(tasks:BoardTask[],query:string,pic:string,target:TargetFilter,today:string,status="") {
  const text=query.trim().toLocaleLowerCase("id-ID");
  return tasks.filter(task=>{
    if(status&&(task.status==="overdue"?"todo":task.status)!==status)return false;
    const people=taskPeople(task);
    if(pic&&!people.some(person=>person.id===pic))return false;
    if(text&&![workOrderLabel(task),task.description??"",task.location??"",task.phase_name,...people.map(person=>person.name)].join(" ").toLocaleLowerCase("id-ID").includes(text))return false;
    const end=calendarDate(task.deadline);
    if(target==="unscheduled")return !end;
    if(target==="late")return !!end&&end<today&&!["done","cancelled"].includes(task.status);
    if(target==="week")return !!end&&weekEnd(end)===weekEnd(today);
    if(target==="month")return !!end&&end.slice(0,7)===today.slice(0,7);
    return true;
  });
}
