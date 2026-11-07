import { describe,expect,test } from "bun:test";
import { filterProjects,projectCollection } from "./project-lifecycle";
import type { Project } from "@/lib/api/workspace";
const projects:Array<Pick<Project,"name"|"rpo_number"|"client_name"|"status"|"archived_at">>=[
  {name:"Plant One",rpo_number:"RPO-100",client_name:"Remula",status:"planning",archived_at:null},
  {name:"Plant Two",rpo_number:"RPO-200",client_name:"Remula",status:"completed",archived_at:null},
  {name:"Plant Three",rpo_number:"RPO-300",client_name:"Remula",status:"completed",archived_at:"2026-11-06T00:00:00Z"},
];
describe("Project collections",()=>{
  test("completed projects leave active results without duplicating or losing records",()=>{
    expect(filterProjects(projects,"active").map(p=>p.rpo_number)).toEqual(["RPO-100"]);
    expect(filterProjects(projects,"completed").map(p=>p.rpo_number)).toEqual(["RPO-200"]);
    expect(filterProjects(projects,"archived").map(p=>p.rpo_number)).toEqual(["RPO-300"]);
  });
  test("restoring a completed project keeps it in completed and search respects collection",()=>{
    expect(projectCollection({...projects[2],archived_at:null})).toBe("completed");
    expect(filterProjects(projects,"completed","  RPO-200  ")).toHaveLength(1);
    expect(filterProjects(projects,"active","plant two")).toHaveLength(0);
  });
});
