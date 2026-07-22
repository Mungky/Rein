"use client";

/** Fixed-canvas stage (OBS-style) — layout v2.
 *
 *  A page owns a canvas resolution (e.g. 1920×1080); every panel is an
 *  absolute canvas-pixel rect. The stage scales the WHOLE canvas uniformly to
 *  fit its container (letterboxed like a 16:9 video), so browser zoom or a
 *  different device never reflows the layout — positions are eternal.
 *
 *  View mode: hover chrome per panel (title chip, maximize, interact/reload
 *  for web channels). Edit mode: free drag + resize with snap guides (canvas
 *  edges, center lines, other panels' edges) + numeric inspector. */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Maximize2,
  MousePointer2,
  RefreshCw,
  Settings2,
  Trash2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { CanvasSize, Panel, PanelRect } from "../types";
import {
  reloadWebSlot,
  setWebInteract,
  useWebInteract,
} from "../web-live-layer";

const MIN_SIZE = 48; // canvas px
const SNAP_SCREEN_PX = 8;

/** Uniform letterbox fit of the canvas inside a box — shared with the
 *  component palette so drag-drop can map pointer → canvas coordinates. */
export function stageTransform(boxW: number, boxH: number, canvas: CanvasSize) {
  const scale =
    boxW > 0 && boxH > 0 ? Math.min(boxW / canvas.w, boxH / canvas.h) : 0;
  return {
    scale,
    offX: (boxW - canvas.w * scale) / 2,
    offY: (boxH - canvas.h * scale) / 2,
  };
}

/* ── Quick-split presets ── */

export const STAGE_PRESETS = [
  { key: "1", label: "1 Penuh" },
  { key: "2x2", label: "2×2" },
  { key: "3x3", label: "3×3" },
  { key: "4x4", label: "4×4" },
  { key: "1+2", label: "1 Besar + 2" },
] as const;

export function presetRects(
  key: string,
  count: number,
  canvas: CanvasSize
): PanelRect[] {
  const { w: W, h: H } = canvas;
  const grid = (r: number, c: number): PanelRect[] =>
    Array.from({ length: r * c }, (_, i) => ({
      x: (i % c) * (W / c),
      y: Math.floor(i / c) * (H / r),
      w: W / c,
      h: H / r,
    }));
  let cells: PanelRect[];
  switch (key) {
    case "1":
      cells = [{ x: 0, y: 0, w: W, h: H }];
      break;
    case "2x2":
      cells = grid(2, 2);
      break;
    case "3x3":
      cells = grid(3, 3);
      break;
    case "4x4":
      cells = grid(4, 4);
      break;
    case "1+2":
      cells = [
        { x: 0, y: 0, w: (W * 2) / 3, h: H },
        { x: (W * 2) / 3, y: 0, w: W / 3, h: H / 2 },
        { x: (W * 2) / 3, y: H / 2, w: W / 3, h: H / 2 },
      ];
      break;
    default:
      cells = [{ x: 0, y: 0, w: W, h: H }];
  }
  // More panels than cells → extras cascade at quarter size.
  return Array.from({ length: count }, (_, i) =>
    i < cells.length
      ? cells[i]
      : {
          x: Math.min(W / 2, 40 * (i - cells.length + 1)),
          y: Math.min(H / 2, 40 * (i - cells.length + 1)),
          w: W / 2,
          h: H / 2,
        }
  );
}

/* ── Stage ── */

interface DragState {
  panelId: string;
  mode: "move" | "resize";
  edges: { l: boolean; r: boolean; t: boolean; b: boolean };
  startX: number; // pointer, screen px
  startY: number;
  orig: PanelRect;
  /** Screen aspect (w/h) — resize keeps it locked (OBS-style). null = free. */
  aspect: number | null;
}

export function CanvasStage({
  canvas,
  panels,
  editMode,
  fullscreen,
  panelTitle,
  renderContent,
  webChannelIdOf,
  panelAspect,
  hideChrome = false,
  onRectChange,
  onRemove,
  onMaximize,
  onEditPanel,
}: {
  canvas: CanvasSize;
  panels: Panel[];
  editMode: boolean;
  fullscreen: boolean;
  panelTitle: (panel: Panel) => string;
  renderContent: (panel: Panel) => React.ReactNode;
  /** channel_id when the panel is a live web channel (interact/reload chrome). */
  webChannelIdOf?: (panel: Panel) => string | null;
  /** Screen aspect (w/h) per panel — resize keeps it locked. null = free. */
  panelAspect?: (panel: Panel) => number | null;
  /** Hide per-panel chrome (titles/buttons) — e.g. while a channel is
   *  maximized, so nothing floats above the maximize backdrop. */
  hideChrome?: boolean;
  onRectChange?: (id: string, rect: PanelRect) => void;
  onRemove?: (id: string) => void;
  onMaximize?: (id: string) => void;
  /** Edit mode: open the panel inspector (double-click / gear button). */
  onEditPanel?: (id: string) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [guides, setGuides] = useState<{ xs: number[]; ys: number[] }>({
    xs: [],
    ys: [],
  });
  const dragRef = useRef<DragState | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const r = entries[0]?.contentRect;
      if (r) setBox({ w: r.width, h: r.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const { scale, offX, offY } = stageTransform(box.w, box.h, canvas);

  const shown = panels.filter((p) => p.rect);

  /* ── Edit: drag / resize with snapping ── */

  const snapCandidates = useCallback(
    (excludeId: string) => {
      const xs = [0, canvas.w / 2, canvas.w];
      const ys = [0, canvas.h / 2, canvas.h];
      for (const p of shown) {
        if (p.id === excludeId || !p.rect) continue;
        xs.push(p.rect.x, p.rect.x + p.rect.w);
        ys.push(p.rect.y, p.rect.y + p.rect.h);
      }
      return { xs, ys };
    },
    [canvas.w, canvas.h, shown]
  );

  // Latest-drag-logic ref: listeners are attached per drag (see startDrag)
  // and always call the freshest closure through this ref (updated post-render).
  const moveImpl = useRef<(e: PointerEvent) => void>(() => {});
  useEffect(() => {
    moveImpl.current = (e: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag || scale <= 0 || !onRectChange) return;
      const dx = (e.clientX - drag.startX) / scale;
      const dy = (e.clientY - drag.startY) / scale;
      const th = SNAP_SCREEN_PX / scale;
      const cand = snapCandidates(drag.panelId);
      const gx: number[] = [];
      const gy: number[] = [];
      let { x, y, w, h } = drag.orig;

      const snap1 = (val: number, list: number[]): number | null => {
        let best: number | null = null;
        let bestD = th;
        for (const c of list) {
          const d = Math.abs(val - c);
          if (d < bestD) {
            bestD = d;
            best = c;
          }
        }
        return best;
      };

      if (drag.mode === "move") {
        x = drag.orig.x + dx;
        y = drag.orig.y + dy;
        // snap left, right, or centerX — whichever is closest
        const sl = snap1(x, cand.xs);
        const sr = snap1(x + w, cand.xs);
        const sc = snap1(x + w / 2, cand.xs);
        if (sl !== null) {
          x = sl;
          gx.push(sl);
        } else if (sr !== null) {
          x = sr - w;
          gx.push(sr);
        } else if (sc !== null) {
          x = sc - w / 2;
          gx.push(sc);
        }
        const st = snap1(y, cand.ys);
        const sb = snap1(y + h, cand.ys);
        const sm = snap1(y + h / 2, cand.ys);
        if (st !== null) {
          y = st;
          gy.push(st);
        } else if (sb !== null) {
          y = sb - h;
          gy.push(sb);
        } else if (sm !== null) {
          y = sm - h / 2;
          gy.push(sm);
        }
        x = Math.min(Math.max(x, 0), canvas.w - w);
        y = Math.min(Math.max(y, 0), canvas.h - h);
      } else if (drag.aspect !== null) {
        // Aspect-locked resize (OBS-style): width drives, height follows;
        // the opposite corner stays anchored — the screen can never squish.
        const a = drag.aspect;
        const anchorX = drag.edges.l ? drag.orig.x + drag.orig.w : drag.orig.x;
        const anchorY = drag.edges.t ? drag.orig.y + drag.orig.h : drag.orig.y;
        let newW = drag.edges.r ? drag.orig.w + dx : drag.orig.w - dx;
        // Snap the moving vertical edge
        const movingX = drag.edges.r ? anchorX + newW : anchorX - newW;
        const sx = snap1(movingX, cand.xs);
        if (sx !== null) {
          newW = Math.abs(sx - anchorX);
          gx.push(sx);
        }
        // Clamp: min size + stay inside the canvas on BOTH axes
        const maxWx = drag.edges.r ? canvas.w - anchorX : anchorX;
        const maxHy = drag.edges.b ? canvas.h - anchorY : anchorY;
        newW = Math.max(
          Math.max(MIN_SIZE, MIN_SIZE * a),
          Math.min(newW, maxWx, maxHy * a)
        );
        const newH = newW / a;
        x = drag.edges.l ? anchorX - newW : anchorX;
        y = drag.edges.t ? anchorY - newH : anchorY;
        w = newW;
        h = newH;
      } else {
        // Free resize by active edges (legacy panels without a screen aspect)
        let l = drag.orig.x;
        let t = drag.orig.y;
        let r = drag.orig.x + drag.orig.w;
        let b = drag.orig.y + drag.orig.h;
        if (drag.edges.l) l = Math.min(drag.orig.x + dx, r - MIN_SIZE);
        if (drag.edges.r) r = Math.max(drag.orig.x + drag.orig.w + dx, l + MIN_SIZE);
        if (drag.edges.t) t = Math.min(drag.orig.y + dy, b - MIN_SIZE);
        if (drag.edges.b) b = Math.max(drag.orig.y + drag.orig.h + dy, t + MIN_SIZE);
        if (drag.edges.l) {
          const s = snap1(l, cand.xs);
          if (s !== null && s <= r - MIN_SIZE) {
            l = s;
            gx.push(s);
          }
        }
        if (drag.edges.r) {
          const s = snap1(r, cand.xs);
          if (s !== null && s >= l + MIN_SIZE) {
            r = s;
            gx.push(s);
          }
        }
        if (drag.edges.t) {
          const s = snap1(t, cand.ys);
          if (s !== null && s <= b - MIN_SIZE) {
            t = s;
            gy.push(s);
          }
        }
        if (drag.edges.b) {
          const s = snap1(b, cand.ys);
          if (s !== null && s >= t + MIN_SIZE) {
            b = s;
            gy.push(s);
          }
        }
        l = Math.max(0, l);
        t = Math.max(0, t);
        r = Math.min(canvas.w, r);
        b = Math.min(canvas.h, b);
        x = l;
        y = t;
        w = r - l;
        h = b - t;
      }

      setGuides({ xs: gx, ys: gy });
      onRectChange(drag.panelId, {
        x: Math.round(x),
        y: Math.round(y),
        w: Math.round(w),
        h: Math.round(h),
      });
    };
  });

  function startDrag(
    e: React.PointerEvent,
    panel: Panel,
    mode: "move" | "resize",
    edges: DragState["edges"] = { l: false, r: false, t: false, b: false }
  ) {
    if (!editMode || !panel.rect) return;
    e.preventDefault();
    e.stopPropagation();
    setSelectedId(panel.id);
    dragRef.current = {
      panelId: panel.id,
      mode,
      edges,
      startX: e.clientX,
      startY: e.clientY,
      orig: { ...panel.rect },
      aspect: mode === "resize" ? panelAspect?.(panel) ?? null : null,
    };
    const onMove = (ev: PointerEvent) => moveImpl.current(ev);
    const onUp = () => {
      dragRef.current = null;
      setGuides({ xs: [], ys: [] });
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  // Delete key removes the selected panel (edit mode)
  useEffect(() => {
    if (!editMode) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Delete" || !selectedId || !onRemove) return;
      const target = e.target as HTMLElement | null;
      if (target && ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) return;
      onRemove(selectedId);
      setSelectedId(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [editMode, selectedId, onRemove]);

  const selected = shown.find((p) => p.id === selectedId) ?? null;

  const RESIZE_HANDLES: {
    key: string;
    edges: DragState["edges"];
    className: string;
    cursor: string;
  }[] = [
    { key: "nw", edges: { l: true, t: true, r: false, b: false }, className: "-left-1 -top-1", cursor: "nwse-resize" },
    { key: "ne", edges: { r: true, t: true, l: false, b: false }, className: "-right-1 -top-1", cursor: "nesw-resize" },
    { key: "sw", edges: { l: true, b: true, r: false, t: false }, className: "-left-1 -bottom-1", cursor: "nesw-resize" },
    { key: "se", edges: { r: true, b: true, l: false, t: false }, className: "-right-1 -bottom-1", cursor: "nwse-resize" },
  ];

  return (
    <div
      ref={containerRef}
      className="relative h-full w-full overflow-hidden"
      // Light mode = abu lembut (panel putih tidak silau); fullscreen tetap
      // hitam karena itu dinding TV.
      style={{ background: fullscreen ? "#000" : "var(--rnet-stage-bg)" }}
      onPointerDown={() => editMode && setSelectedId(null)}
    >
      {scale > 0 && (
        <>
          {/* Canvas area (letterboxed) */}
          <div
            className={cn("absolute", editMode && "outline outline-1")}
            style={{
              left: offX,
              top: offY,
              width: canvas.w * scale,
              height: canvas.h * scale,
              background: fullscreen ? "#000" : "var(--rnet-canvas-bg)",
              outlineColor: "var(--rnet-cell-ring)",
            }}
          />

          {/* CONTENT cells — z-10, purely visual. All interaction/chrome
              lives in the z-40 layer below so it always floats ABOVE the
              keep-alive iframes (z-30). */}
          {shown.map((panel) => {
            const r = panel.rect!;
            return (
              <div
                key={panel.id}
                className="absolute z-10 overflow-hidden ring-1 ring-[var(--rnet-cell-ring)]"
                style={{
                  left: offX + r.x * scale,
                  top: offY + r.y * scale,
                  width: r.w * scale,
                  height: r.h * scale,
                }}
              >
                {renderContent(panel)}
              </div>
            );
          })}

          {/* CHROME + interaction layer — z-40, above the iframe layer.
              Hidden entirely while a channel is maximized (nothing may float
              above the maximize backdrop). */}
          {/* eslint-disable-next-line react-hooks/refs -- dragRef/moveImpl are
              only touched inside pointer-event handlers, never during render */}
          {!hideChrome && shown.map((panel) => {
            const r = panel.rect!;
            const isSel = editMode && selectedId === panel.id;
            const webId = webChannelIdOf?.(panel) ?? null;
            return (
              <div
                key={`chrome-${panel.id}`}
                className={cn(
                  "group/cell absolute z-40",
                  editMode
                    ? "cursor-move"
                    : "pointer-events-none",
                  editMode &&
                    (isSel
                      ? "ring-2 ring-primary"
                      : "ring-1 ring-[var(--rnet-cell-ring)]")
                )}
                style={{
                  left: offX + r.x * scale,
                  top: offY + r.y * scale,
                  width: r.w * scale,
                  height: r.h * scale,
                }}
                onPointerDown={
                  editMode ? (e) => startDrag(e, panel, "move") : undefined
                }
                onDoubleClick={
                  editMode && onEditPanel
                    ? (e) => {
                        e.stopPropagation();
                        onEditPanel(panel.id);
                      }
                    : undefined
                }
              >
                {/* View-mode chrome — tombol saja, menepi ke kanan. Chip judul
                    sengaja TIDAK ada di sini: ia menutupi isi komponen, dan
                    tiap komponen sudah punya elemen judulnya sendiri di
                    kanvas. Judul tetap tampil di mode Atur Layout. */}
                {!editMode && (
                  <div className="absolute inset-x-0 top-0 flex items-start justify-end gap-1 p-1.5">
                    <span className="pointer-events-auto flex items-center gap-1 opacity-60 transition-opacity hover:opacity-100">
                      {webId && <InteractButton channelId={webId} />}
                      {webId && (
                        <ChromeButton
                          title="Muat ulang halaman"
                          onClick={() => reloadWebSlot(webId)}
                        >
                          <RefreshCw className="size-3.5" />
                        </ChromeButton>
                      )}
                      {onMaximize && (
                        <ChromeButton
                          title="Perbesar channel ini"
                          onClick={() => onMaximize(panel.id)}
                        >
                          <Maximize2 className="size-3.5" />
                        </ChromeButton>
                      )}
                    </span>
                  </div>
                )}

                {/* Edit-mode label + resize handles */}
                {editMode && (
                  <>
                    <span className="pointer-events-none absolute left-1 top-1 max-w-[85%] truncate rounded-[var(--r-xs)] bg-black/60 px-1.5 py-0.5 text-[10px] font-semibold text-white">
                      {panelTitle(panel)}
                    </span>
                    {isSel &&
                      RESIZE_HANDLES.map((hdl) => (
                        <span
                          key={hdl.key}
                          className={cn(
                            "absolute size-2.5 rounded-[2px] border border-white bg-primary",
                            hdl.className
                          )}
                          style={{ cursor: hdl.cursor }}
                          onPointerDown={(e) =>
                            startDrag(e, panel, "resize", hdl.edges)
                          }
                        />
                      ))}
                  </>
                )}
              </div>
            );
          })}

          {/* Snap guide lines */}
          {editMode &&
            guides.xs.map((gx) => (
              <div
                key={`gx${gx}`}
                className="pointer-events-none absolute z-50 w-px bg-red-500"
                style={{ left: offX + gx * scale, top: offY, height: canvas.h * scale }}
              />
            ))}
          {editMode &&
            guides.ys.map((gy) => (
              <div
                key={`gy${gy}`}
                className="pointer-events-none absolute z-50 h-px bg-red-500"
                style={{ top: offY + gy * scale, left: offX, width: canvas.w * scale }}
              />
            ))}

          {/* Numeric inspector (edit mode, panel selected) */}
          {editMode && selected?.rect && onRectChange && (
            <div
              className="absolute bottom-3 left-1/2 z-50 flex -translate-x-1/2 items-center gap-2 rounded-full bg-black/80 px-3 py-1.5 text-white backdrop-blur-sm"
              onPointerDown={(e) => e.stopPropagation()}
            >
              <span className="max-w-[140px] truncate text-[11px] font-semibold">
                {panelTitle(selected)}
              </span>
              {(["x", "y", "w", "h"] as const).map((k) => (
                <label key={k} className="flex items-center gap-1 text-[10.5px]">
                  <span className="uppercase text-white/50">{k}</span>
                  <input
                    type="number"
                    value={Math.round(selected.rect![k])}
                    onChange={(e) =>
                      onRectChange(selected.id, {
                        ...selected.rect!,
                        [k]: Number(e.target.value) || 0,
                      })
                    }
                    className="w-16 rounded-[var(--r-xs)] bg-white/10 px-1.5 py-0.5 text-[11px] text-white outline-none"
                  />
                </label>
              ))}
              {onEditPanel && (
                <button
                  type="button"
                  onClick={() => onEditPanel(selected.id)}
                  className="flex size-6 items-center justify-center rounded-full text-white/80 hover:bg-white/15"
                  title="Atur komponen ini (atau klik dua kali panelnya)"
                >
                  <Settings2 className="size-3.5" />
                </button>
              )}
              {onRemove && (
                <button
                  type="button"
                  onClick={() => {
                    onRemove(selected.id);
                    setSelectedId(null);
                  }}
                  className="flex size-6 items-center justify-center rounded-full text-red-400 hover:bg-red-500/20"
                  title="Hapus panel (Delete)"
                >
                  <Trash2 className="size-3.5" />
                </button>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function ChromeButton({
  title,
  onClick,
  active = false,
  children,
}: {
  title: string;
  onClick: () => void;
  active?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className={cn(
        "flex size-7 items-center justify-center rounded-full backdrop-blur-sm",
        active
          ? "bg-primary text-white ring-2 ring-primary/50"
          : "bg-black/60 text-white hover:bg-black/80"
      )}
    >
      {children}
    </button>
  );
}

/** Mouse toggle for a live web channel — iframes are click-through by
 *  default so the wall can't be poked accidentally. */
function InteractButton({ channelId }: { channelId: string }) {
  const interact = useWebInteract(channelId);
  return (
    <ChromeButton
      title={interact ? "Kunci interaksi (jadi tonton saja)" : "Interact — aktifkan mouse di halaman ini"}
      active={interact}
      onClick={() => setWebInteract(channelId, !interact)}
    >
      <MousePointer2 className="size-3.5" />
    </ChromeButton>
  );
}
