/** SCADA Monitor types — keep the layout contract in sync with
 *  `backend/app/schemas/scada.py`. */

export interface PanelGridPos {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface PanelBase {
  id: string;
  title: string;
  grid: PanelGridPos;
}

export interface VideoPanelConfig {
  stream_id: string;
  object_fit: "contain" | "cover";
  muted: boolean;
}

/** Discriminated union on `type`. Only "video" is implemented in Phase 1 —
 *  "chart" / "table" / "alarm" are reserved for sensor/historian/alarm panels.
 *  The backend rejects unknown types at save time. */
export type Panel =
  | (PanelBase & { type: "video"; config: VideoPanelConfig })
  | (PanelBase & {
      type: "chart" | "table" | "alarm";
      config: Record<string, unknown>;
    });

export type PanelType = Panel["type"];

export interface PerspectiveLayout {
  version: 1;
  panels: Panel[];
}

export interface Perspective {
  id: string;
  name: string;
  layout: PerspectiveLayout;
  is_default: boolean;
  created_at: string | null;
  updated_at: string | null;
}

export interface Stream {
  id: string;
  name: string;
  hls_url: string;
  read_user: string | null;
  read_pass: string | null;
  enabled: boolean;
  created_at: string | null;
  updated_at: string | null;
}
