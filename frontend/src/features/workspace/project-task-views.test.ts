import { expect, test } from "bun:test";
import { filterBoardTasks, emptyTaskFilters } from "./project-task-views";
import type { BoardTask } from "@/lib/api/workspace";

const task = { id: "one", name: "Inspeksi POMPA", assigned_to: "primary", status: "in_progress",
  planning: { assignees: [{ id: "secondary", name: "Engineer" }], tags: [{ id: "qa", name: "QA" }], priority: 2, blocked: true, overdue: true } } as BoardTask;

test("filters recognize secondary assignee and case-insensitive trimmed search", () => {
  expect(filterBoardTasks([task], { ...emptyTaskFilters, assignee_id: "secondary", q: " pompa " })).toEqual([task]);
});
test("blocked/overdue remain independent of task lifecycle status", () => {
  expect(filterBoardTasks([task], { ...emptyTaskFilters, status: "in_progress", blocked: "true", overdue: "true" })).toEqual([task]);
  expect(task.status).toBe("in_progress");
});
test("tag and priority filters compose without altering original cards", () => {
  expect(filterBoardTasks([task], { ...emptyTaskFilters, tag_id: "qa", priority: "2" })).toHaveLength(1);
  expect(filterBoardTasks([task], { ...emptyTaskFilters, tag_id: "missing" })).toHaveLength(0);
  expect(task.planning?.tags).toHaveLength(1);
});
