"use client";

/** HMI decor renderers — static text labels and basic shapes for the Monitor
 *  canvas (langkah awal "SCADA beneran"). Backgrounds are transparent so they
 *  layer over the wall; sizes are CANVAS pixels (the stage scales uniformly,
 *  so decor keeps its proportion on every screen). */

import type { ShapePanelConfig, TextPanelConfig } from "../types";

export function TextDecorPanel({ config }: { config: TextPanelConfig }) {
  return (
    <div
      className="flex h-full w-full items-center overflow-hidden px-2"
      style={{
        justifyContent:
          config.align === "left"
            ? "flex-start"
            : config.align === "right"
              ? "flex-end"
              : "center",
      }}
    >
      <span
        className="whitespace-pre-wrap break-words leading-tight"
        style={{
          fontSize: config.size,
          fontWeight: config.bold ? 700 : 400,
          color: config.color ?? "var(--rein-text)",
          textAlign: config.align,
        }}
      >
        {config.content}
      </span>
    </div>
  );
}

export function ShapeDecorPanel({ config }: { config: ShapePanelConfig }) {
  if (config.shape === "line") {
    // Horizontal line across the panel's middle; for a vertical line use a
    // thin "kotak" (rect) instead — resize does the rest.
    return (
      <div className="flex h-full w-full items-center">
        <div
          className="w-full"
          style={{
            height: Math.max(1, config.stroke_w),
            background: config.stroke ?? "var(--rein-text-light)",
          }}
        />
      </div>
    );
  }
  return (
    <div
      className="h-full w-full"
      style={{
        background: config.fill ?? "transparent",
        border:
          config.stroke && config.stroke_w > 0
            ? `${config.stroke_w}px solid ${config.stroke}`
            : undefined,
        borderRadius: config.shape === "circle" ? "50%" : config.radius,
      }}
    />
  );
}
