import type { Project } from "@/lib/api/workspace";

export type ProjectCollection = "active" | "completed" | "archived";
export function projectCollection(project: Pick<Project,"archived_at"|"status">): ProjectCollection {
  return project.archived_at ? "archived" : project.status === "completed" ? "completed" : "active";
}
export function filterProjects<T extends Pick<Project,"archived_at"|"status"|"name"|"rpo_number"|"client_name">>(projects:T[], collection:ProjectCollection, query=""):T[] {
  const search=query.trim().toLocaleLowerCase("id-ID");
  return projects.filter(project=>projectCollection(project)===collection&&[project.name,project.rpo_number,project.client_name].join(" ").toLocaleLowerCase("id-ID").includes(search));
}
