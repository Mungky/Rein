"use client";

/** Grid canvas — react-grid-layout v2 wrapper.
 *  12 columns; drag/resize only in edit mode (view mode is fully static). */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  GridLayout,
  useContainerWidth,
  type Layout,
} from "react-grid-layout";
import "react-grid-layout/css/styles.css";
import { cn } from "@/lib/utils";
import type { Panel, PanelGridPos } from "../types";

const GRID_COLS = 12;
const ROW_HEIGHT = 40;
const GRID_MARGIN: readonly [number, number] = [8, 8];
const FULLSCREEN_MARGIN = 4;

export function GridCanvas({
  panels,
  editMode,
  fullscreen,
  onGridChange,
  renderPanelContent,
}: {
  panels: Panel[];
  editMode: boolean;
  fullscreen: boolean;
  onGridChange: (positions: { id: string; grid: PanelGridPos }[]) => void;
  renderPanelContent: (panel: Panel) => React.ReactNode;
}) {
  const { width, mounted, containerRef } = useContainerWidth();

  // In fullscreen the wall must fill the screen exactly: scale row height so
  // the tallest column of panels spans the whole viewport (no dead space,
  // no scrollbar). Outside fullscreen a fixed row height + scroll is fine.
  const [viewportH, setViewportH] = useState(0);
  useEffect(() => {
    const update = () => setViewportH(window.innerHeight);
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  const totalRows = useMemo(
    () => Math.max(1, ...panels.map((p) => p.grid.y + p.grid.h)),
    [panels]
  );
  const rowHeight =
    fullscreen && viewportH > 0
      ? Math.max(
          24,
          Math.floor(
            (viewportH - (totalRows + 1) * FULLSCREEN_MARGIN) / totalRows
          )
        )
      : ROW_HEIGHT;

  const layout: Layout = useMemo(
    () =>
      panels.map((p) => ({
        i: p.id,
        x: p.grid.x,
        y: p.grid.y,
        w: p.grid.w,
        h: p.grid.h,
      })),
    [panels]
  );

  const handleLayoutChange = useCallback(
    (next: Layout) => {
      if (!editMode) return;
      onGridChange(
        next.map((item) => ({
          id: item.i,
          grid: { x: item.x, y: item.y, w: item.w, h: item.h },
        }))
      );
    },
    [editMode, onGridChange]
  );

  return (
    <div
      ref={containerRef}
      className={cn(
        "h-full w-full",
        fullscreen ? "overflow-hidden" : "overflow-y-auto"
      )}
    >
      {mounted && (
        <GridLayout
          width={width}
          layout={layout}
          gridConfig={{
            cols: GRID_COLS,
            rowHeight,
            margin: fullscreen
              ? [FULLSCREEN_MARGIN, FULLSCREEN_MARGIN]
              : GRID_MARGIN,
          }}
          dragConfig={{ enabled: editMode, handle: ".panel-drag-handle" }}
          resizeConfig={{ enabled: editMode }}
          onLayoutChange={handleLayoutChange}
        >
          {panels.map((panel) => (
            <div key={panel.id}>{renderPanelContent(panel)}</div>
          ))}
        </GridLayout>
      )}
    </div>
  );
}
