"use client";

/** Kanvas Komponen — pengatur tata letak isi panel, gaya OBS.
 *
 *  Komponen aslinya dirender LANGSUNG di kanvas (WYSIWYG, data hidup), dengan
 *  kotak elemen melayang di atasnya: geser untuk memindah, tarik sudut untuk
 *  mengubah ukuran (= ukuran huruf, karena tinggi huruf mengikuti tinggi
 *  kotak). Semua koordinat dalam PERSEN, jadi hasilnya ikut menskala saat
 *  panel dibesar-kecilkan di halaman Monitor. */

import { useCallback, useEffect, useRef, useState } from "react";
import { AlignCenter, AlignLeft, AlignRight, RotateCcw } from "lucide-react";
import { cn } from "@/lib/utils";
import type {
  ElementBox,
  Panel,
  PanelElements,
  PanelLayout,
  Tag,
} from "./types";
import {
  LAYOUT_PRESETS,
  layoutKindOf,
  resolveLayout,
} from "./panels/elements";
import type { ElementKey } from "./panels/elements";
import { renderPanel } from "./panels/panel-registry";

const MIN_SIZE = 4; // persen
const SNAP = 1; // persen — pembulatan halus saat menggeser

interface DragState {
  key: ElementKey;
  mode: "move" | "resize";
  startX: number;
  startY: number;
  orig: ElementBox;
}

export function LayoutEditor({
  panel,
  tags,
  onChange,
}: {
  panel: Panel;
  tags: Tag[];
  /** Terapkan layout baru ke DRAFT (WYSIWYG langsung). */
  onChange: (layout: PanelLayout) => void;
}) {
  const cfg = panel.config as {
    style?: string | null;
    layout?: PanelLayout;
    elements?: PanelElements;
  };
  const kind = layoutKindOf(panel.type, cfg);
  const boxRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const [selected, setSelected] = useState<ElementKey | null>(null);

  const elements = kind
    ? resolveLayout(kind, cfg.elements, cfg.layout).filter((e) => e.visible)
    : [];

  const patchBox = useCallback(
    (key: ElementKey, box: ElementBox) => {
      onChange({ ...(cfg.layout ?? {}), [key]: box });
    },
    [cfg.layout, onChange]
  );

  // Logika drag terbaru selalu lewat ref: listener dipasang per-drag.
  const moveImpl = useRef<(e: PointerEvent) => void>(() => {});
  useEffect(() => {
    moveImpl.current = (e: PointerEvent) => {
      const drag = dragRef.current;
      const el = boxRef.current;
      if (!drag || !el) return;
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;
      const dx = ((e.clientX - drag.startX) / rect.width) * 100;
      const dy = ((e.clientY - drag.startY) / rect.height) * 100;
      const round = (v: number) => Math.round(v / SNAP) * SNAP;

      if (drag.mode === "move") {
        patchBox(drag.key, {
          ...drag.orig,
          x: round(Math.min(Math.max(drag.orig.x + dx, -10), 100 - MIN_SIZE)),
          y: round(Math.min(Math.max(drag.orig.y + dy, -10), 100 - MIN_SIZE)),
        });
      } else {
        patchBox(drag.key, {
          ...drag.orig,
          w: round(Math.min(Math.max(drag.orig.w + dx, MIN_SIZE), 140)),
          h: round(Math.min(Math.max(drag.orig.h + dy, MIN_SIZE), 140)),
        });
      }
    };
  });

  function startDrag(
    e: React.PointerEvent,
    key: ElementKey,
    box: ElementBox,
    mode: "move" | "resize"
  ) {
    e.preventDefault();
    e.stopPropagation();
    setSelected(key);
    dragRef.current = {
      key,
      mode,
      startX: e.clientX,
      startY: e.clientY,
      orig: box,
    };
    const onMove = (ev: PointerEvent) => moveImpl.current(ev);
    const onUp = () => {
      dragRef.current = null;
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  if (!kind) return null;

  const sel = elements.find((el) => el.key === selected) ?? null;

  return (
    <div className="flex flex-col gap-2 rounded-[var(--r)] border border-border-soft bg-bg-sidebar/50 p-3">
      <div className="flex items-center gap-2">
        <span className="flex-1 text-[12px] font-bold text-text">
          Kanvas Komponen
        </span>
        <button
          type="button"
          onClick={() => {
            onChange({});
            setSelected(null);
          }}
          className="btn btn-ghost btn-sm gap-1"
          title="Kembalikan semua kotak ke posisi bawaan"
        >
          <RotateCcw className="size-3" /> Atur Ulang
        </button>
      </div>

      {/* Kanvas: komponen asli + kotak elemen di atasnya */}
      <div
        ref={boxRef}
        className="relative aspect-[4/3] w-full select-none overflow-hidden rounded-[var(--r)] border border-border bg-bg"
        onPointerDown={() => setSelected(null)}
      >
        <div className="pointer-events-none absolute inset-0">
          {renderPanel(panel, [], tags)}
        </div>

        {elements.map((el) => {
          const isSel = selected === el.key;
          return (
            <div
              key={el.key}
              className={cn(
                "absolute cursor-move border border-dashed",
                isSel
                  ? "border-primary bg-primary/10"
                  : "border-text-light/50 hover:border-primary/60 hover:bg-primary/5"
              )}
              style={{
                left: `${el.box.x}%`,
                top: `${el.box.y}%`,
                width: `${el.box.w}%`,
                height: `${el.box.h}%`,
              }}
              onPointerDown={(e) => startDrag(e, el.key, el.box, "move")}
            >
              <span
                className={cn(
                  "pointer-events-none absolute -top-0.5 left-0 max-w-full -translate-y-full truncate rounded-t-[3px] px-1 text-[9px] font-bold",
                  isSel ? "bg-primary text-white" : "bg-black/55 text-white/85"
                )}
              >
                {el.label}
              </span>
              {isSel && (
                <span
                  className="absolute -bottom-1 -right-1 size-3 cursor-nwse-resize rounded-[2px] border border-white bg-primary"
                  onPointerDown={(e) => startDrag(e, el.key, el.box, "resize")}
                />
              )}
            </div>
          );
        })}
      </div>

      {/* Setelan elemen terpilih */}
      {sel ? (
        <div className="flex flex-col gap-2 rounded-[var(--r-sm)] border border-border-soft bg-bg p-2">
          <div className="flex items-center gap-2">
            <span className="flex-1 text-[11.5px] font-bold text-text">
              {sel.label}
            </span>
            {sel.key !== "graphic" && (
              <div className="flex items-center gap-0.5">
                {(
                  [
                    { v: "left", Icon: AlignLeft },
                    { v: "center", Icon: AlignCenter },
                    { v: "right", Icon: AlignRight },
                  ] as const
                ).map(({ v, Icon }) => (
                  <button
                    key={v}
                    type="button"
                    onClick={() => patchBox(sel.key, { ...sel.box, align: v })}
                    className={cn(
                      "flex size-6 cursor-pointer items-center justify-center rounded-[var(--r-xs)]",
                      (sel.box.align ?? "center") === v
                        ? "bg-primary/10 text-primary"
                        : "text-text-light hover:bg-bg-hover"
                    )}
                    title={`Rata ${v === "left" ? "kiri" : v === "center" ? "tengah" : "kanan"}`}
                  >
                    <Icon className="size-3.5" />
                  </button>
                ))}
              </div>
            )}
          </div>

          {sel.key !== "graphic" && (
            <div>
              <label className="mb-1 block text-[11px] font-semibold text-text-muted">
                Tinggi Huruf ({Math.round((sel.box.scale ?? 0.7) * 100)}% kotak)
              </label>
              <input
                type="range"
                min={20}
                max={100}
                value={Math.round((sel.box.scale ?? 0.7) * 100)}
                onChange={(e) =>
                  patchBox(sel.key, {
                    ...sel.box,
                    scale: Number(e.target.value) / 100,
                  })
                }
                className="w-full"
              />
            </div>
          )}

          <div className="grid grid-cols-4 gap-1.5">
            {(["x", "y", "w", "h"] as const).map((k) => (
              <label key={k} className="flex flex-col gap-0.5">
                <span className="text-[10px] font-semibold uppercase text-text-light">
                  {k}
                </span>
                <input
                  type="number"
                  value={Math.round(sel.box[k])}
                  onChange={(e) =>
                    patchBox(sel.key, {
                      ...sel.box,
                      [k]: Number(e.target.value) || 0,
                    })
                  }
                  className="field-input h-7 px-1.5 text-[11px]"
                />
              </label>
            ))}
          </div>
          <button
            type="button"
            onClick={() => {
              const preset = LAYOUT_PRESETS[kind].find((p) => p.key === sel.key);
              if (preset) patchBox(sel.key, preset.box);
            }}
            className="btn btn-ghost btn-sm self-start gap-1"
          >
            <RotateCcw className="size-3" /> Kembalikan {sel.label}
          </button>
        </div>
      ) : (
        <p className="text-[11px] text-text-light">
          Klik kotak untuk memilih, geser untuk memindah, tarik sudut kanan-bawah
          untuk mengubah ukuran (ukuran kotak = ukuran huruf). Semuanya persen —
          ikut menskala saat panel dibesar-kecilkan.
        </p>
      )}
    </div>
  );
}
