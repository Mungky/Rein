import type { ProjectBoard } from "@/lib/api/workspace";

/** Optimistic placement only: never mutate a task's lifecycle or review data. */
export function moveBoardCard(board: ProjectBoard, taskId: string, stageId: string, beforeId: string | null): ProjectBoard {
  const task = board.tasks.find((item) => item.id === taskId);
  if (!task || !board.stages.some((stage) => stage.id === stageId)) return board;
  const target = board.tasks.filter((item) => item.stage_id === stageId && item.id !== taskId);
  const index = beforeId ? target.findIndex((item) => item.id === beforeId) : -1;
  target.splice(index < 0 ? target.length : index, 0, { ...task, stage_id: stageId });
  const reordered = target.map((item, board_order) => ({ ...item, board_order }));
  return { ...board, tasks: [...board.tasks.filter((item) => item.stage_id !== stageId && item.id !== taskId), ...reordered] };
}
