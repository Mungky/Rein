/** R-Net types — keep the layout contract in sync with
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

export type ChartRange = "1h" | "6h" | "24h" | "7d" | "30d";

export interface ChartPanelConfig {
  tag_ids: string[]; // 1–4 historian tags
  range: ChartRange;
  show_minmax: boolean;
}

export interface TablePanelConfig {
  tag_ids: string[]; // 1–8 historian tags
  range: ChartRange;
}

export interface GaugePanelConfig {
  tag_id: string;
  warning: number | null;
  critical: number | null;
  direction: "above" | "below"; // which side of the threshold is bad
}

export type BarMetric = "avg" | "last" | "min" | "max";

export interface BarPanelConfig {
  tag_ids: string[]; // 2–8 tags — a comparison needs at least two bars
  range: ChartRange;
  metric: BarMetric;
}

/** Discriminated union on `type`. Implemented: "video", "chart", "table",
 *  "gauge", "bar" — "alarm" is reserved. The backend rejects unknown types
 *  at save time. */
export type Panel =
  | (PanelBase & { type: "video"; config: VideoPanelConfig })
  | (PanelBase & { type: "chart"; config: ChartPanelConfig })
  | (PanelBase & { type: "table"; config: TablePanelConfig })
  | (PanelBase & { type: "gauge"; config: GaugePanelConfig })
  | (PanelBase & { type: "bar"; config: BarPanelConfig })
  | (PanelBase & { type: "alarm"; config: Record<string, unknown> });

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

export interface Sheet {
  id: string;
  name: string;
  position: number;
  created_at: string | null;
  updated_at: string | null;
}

export interface Tag {
  id: string;
  sheet_id: string;
  source: string; // "simulator" | "vnet" (later)
  device_key: string;
  label: string;
  unit: string;
  enabled: boolean;
  config: Record<string, unknown>;
  /** Manual metadata cell values keyed by workbench column id */
  meta: Record<string, string | number>;
  created_at: string | null;
  updated_at: string | null;
}

export interface HistoryPoint {
  t: string; // bucket start, ISO 8601 UTC
  avg: number;
  min: number;
  max: number;
}

export interface HistorySeries {
  tag_id: string;
  label: string;
  unit: string;
  points: HistoryPoint[];
}

export interface SummaryItem {
  tag_id: string;
  label: string;
  unit: string;
  last: number | null;
  last_ts: string | null;
  min: number | null;
  max: number | null;
  avg: number | null;
}

export type ColumnKind = "formula" | "text" | "number";

export interface WorkbenchColumn {
  id: string;
  sheet_id: string;
  name: string;
  kind: ColumnKind;
  formula: string | null; // set only for kind "formula"
  unit: string;
  decimals: number;
  position: number;
  created_at: string | null;
  updated_at: string | null;
}

export interface RecentSample {
  ts: string;
  value: number;
}
