import { describe, expect, test } from "bun:test";
import { moveBoardCard } from "./board-state";
import type { BoardTask, ProjectBoard } from "@/lib/api/workspace";

const reviewedTask = { id: "a", stage_id: "first", board_order: 0, status: "done", reviewed_by: "manager", review_notes: "Keep review", deadline: "2026-11-10" } as BoardTask;
const secondTask = { id: "b", stage_id: "second", board_order: 0, status: "in_progress" } as BoardTask;
const board: ProjectBoard = { version: 7, stages: [{ id: "first", name: "One", sequence: 0, folded: false }, { id: "second", name: "Two", sequence: 1, folded: false }], tasks: [reviewedTask, secondTask] };

describe("Project card placement", () => {
  test("moving a completed WO preserves approval and deadline, without mutating rollback snapshot", () => {
    const moved = moveBoardCard(board, "a", "second", "b");
    expect(moved.tasks.map((t) => t.id)).toEqual(["a", "b"]);
    expect(moved.tasks[0]).toMatchObject({ status: "done", reviewed_by: "manager", review_notes: "Keep review", deadline: "2026-11-10" });
    expect(board.tasks[0].stage_id).toBe("first");
    expect(moved.version).toBe(7);
    expect(moved.tasks.map((t) => t.board_order)).toEqual([0, 1]);
  });
  test("reordering within a stage keeps each card exactly once", () => {
    const placed = moveBoardCard(board, "a", "second", null);
    const moved = moveBoardCard(placed, "a", "second", "b");
    expect(moved.tasks.map((t) => t.id)).toEqual(["a", "b"]);
    expect(new Set(moved.tasks.map((t) => t.id)).size).toBe(board.tasks.length);
  });
  test("an unknown target never removes a card", () => {
    expect(moveBoardCard(board, "a", "missing", null)).toBe(board);
  });
});
