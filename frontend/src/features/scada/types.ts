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

export interface AlarmPanelConfig {
  tag_ids: string[]; // 1–8 tags to watch
  range: ChartRange; // window for the min/avg context (status uses latest)
}

/** One cell of a video wall → one channel = (stream, cell index in its mosaic). */
export interface WallCell {
  stream_id: string;
  cell: number; // 0-based, row-major, within that stream's mosaic
}

export interface WallPanelConfig {
  rows: number; // 1–6
  cols: number; // 1–6
  cells: (WallCell | null)[]; // row-major, length = rows×cols; null = empty
  /** How each channel fills its cell. "cover" (default) crops to fill; contain
   *  shows the whole camera letterboxed (nothing cut off). */
  fit?: "cover" | "contain";
}

/** Activity panel has no config — it always shows everyone currently on REIN. */
export type ActivityPanelConfig = Record<string, never>;

/** Web-embed panel: a live web page (e.g. Wecon V-Net HMI) inside the grid.
 *  No OBS/MediaMTX involved — the viewer's browser loads the page directly. */
export interface WebPanelConfig {
  url: string;
  /** Visual zoom, 1 = 100%. Lets you tighten an HMI to fit the cell. */
  zoom?: number;
  /** Shift the page inside the cell (CSS px, pre-zoom) — crops away the
   *  embedded site's own navbar/sidebar without fullscreen. */
  offset_x?: number;
  offset_y?: number;
}

/** A layout cell that shows one TV-style channel (see Channel below). */
export interface ChannelPanelConfig {
  channel_id: string;
}

/** Discriminated union on `type`. Implemented: "video", "chart", "table",
 *  "gauge", "bar", "alarm", "wall", "activity". The backend rejects unknown
 *  types at save time. */
export type Panel =
  | (PanelBase & { type: "video"; config: VideoPanelConfig })
  | (PanelBase & { type: "chart"; config: ChartPanelConfig })
  | (PanelBase & { type: "table"; config: TablePanelConfig })
  | (PanelBase & { type: "gauge"; config: GaugePanelConfig })
  | (PanelBase & { type: "bar"; config: BarPanelConfig })
  | (PanelBase & { type: "alarm"; config: AlarmPanelConfig })
  | (PanelBase & { type: "wall"; config: WallPanelConfig })
  | (PanelBase & { type: "activity"; config: ActivityPanelConfig })
  | (PanelBase & { type: "web"; config: WebPanelConfig })
  | (PanelBase & { type: "channel"; config: ChannelPanelConfig });

/* ── Channels (TV-style registry) ── */

export type ChannelKind =
  | "video"
  | "web"
  | "chart"
  | "table"
  | "gauge"
  | "bar"
  | "alarm"
  | "activity";

/** Video channel source: a stream, optionally cropped to ONE mosaic cell
 *  (row-major, 0-based; null = whole frame). */
export interface ChannelVideoConfig {
  stream_id: string;
  cell: number | null;
}

/** One TV-style channel: number + nickname + one source definition. Defined
 *  on halaman Channel; the Monitor layout references channels by id. */
export interface Channel {
  id: string;
  number: number;
  name: string;
  kind: ChannelKind;
  config:
    | ChannelVideoConfig
    | WebPanelConfig
    | ChartPanelConfig
    | TablePanelConfig
    | GaugePanelConfig
    | BarPanelConfig
    | AlarmPanelConfig
    | ActivityPanelConfig
    | Record<string, unknown>;
  enabled: boolean;
  created_at: string | null;
  updated_at: string | null;
}

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
  /** True when this is the single admin-published default layout (Masalah D) */
  is_published: boolean;
  /** True when this is the admin default shown to a user who doesn't own it:
   *  view-only, forked into the user's own copy on edit ("Simpan Sebagai"). */
  read_only: boolean;
  created_at: string | null;
  updated_at: string | null;
}

/** The admin-published default layout, or exists=false when none is set. */
export interface PublishedLayout {
  exists: boolean;
  name: string | null;
  layout: PerspectiveLayout | null;
}

export interface Stream {
  id: string;
  name: string;
  hls_url: string;
  read_user: string | null;
  read_pass: string | null;
  enabled: boolean;
  /** Video-wall mosaic: one OBS output can carry mosaic_rows×mosaic_cols cameras. */
  mosaic_rows: number;
  mosaic_cols: number;
  /** Global channel number of cell 0 (a 3×3 stream starting at 1 owns 1..9). */
  channel_start: number;
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

/** An MQTT broker / physical plant. The broker password is never returned —
 *  only `has_password`. Managed from the "Kelola Site" dialog in Analisis. */
export interface Site {
  id: string;
  name: string;
  enabled: boolean;
  mqtt_host: string;
  mqtt_port: number;
  mqtt_username: string | null;
  base_topic: string;
  has_password: boolean;
  created_at: string | null;
  updated_at: string | null;
}

export interface Tag {
  id: string;
  sheet_id: string;
  source: string; // "simulator" | "mqtt"
  /** Set for source "mqtt" — which site (broker) publishes this tag */
  site_id: string | null;
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
