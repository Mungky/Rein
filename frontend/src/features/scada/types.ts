/** R-Net types — keep the layout contract in sync with
 *  `backend/app/schemas/scada.py`. */

/** Legacy (layout v1) 12-column grid position. */
export interface PanelGridPos {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Layout v2 (OBS-style): absolute CANVAS-pixel rectangle — the whole canvas
 *  scales uniformly on every screen/zoom, so rects never reflow. */
export interface PanelRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Per-page canvas resolution (like an OBS scene). */
export interface CanvasSize {
  w: number;
  h: number;
}

export const DEFAULT_CANVAS: CanvasSize = { w: 1920, h: 1080 };

interface PanelBase {
  id: string;
  title: string;
  /** v1 placement (legacy pages only). */
  grid?: PanelGridPos;
  /** v2 placement — canvas pixels. */
  rect?: PanelRect;
}

export interface VideoPanelConfig {
  stream_id: string;
  object_fit: "contain" | "cover";
  muted: boolean;
}

export type ChartRange = "1h" | "6h" | "24h" | "7d" | "30d";

/** Elemen modular komponen nilai (gauge/level/led): bagian mana yang tampil.
 *  Posisi & ukurannya diatur lewat kanvas komponen (lihat PanelLayout). */
export interface PanelElements {
  show_title?: boolean;
  show_value?: boolean;
  show_status?: boolean;
  /** Nama perangkat (device_key sensor) — bawaan sembunyi. */
  show_device?: boolean;
  /** Baris kecil "Diperbarui HH:mm" / rentang 24 jam. */
  show_footer?: boolean;
}

/** Satu kotak elemen di kanvas komponen — PERSEN (0–100) dari kotak panel,
 *  jadi ikut mengecil/membesar bersama panelnya. */
export interface ElementBox {
  x: number;
  y: number;
  w: number;
  h: number;
  /** Perataan isi kotak; bawaan tengah. */
  align?: "left" | "center" | "right";
  /** Tinggi huruf terhadap tinggi kotak (0,2–1); bawaan 0,7. */
  scale?: number;
}

/** Tata letak bebas komponen: kotak per elemen. Elemen tanpa entri memakai
 *  kotak bawaan jenisnya (lihat LAYOUT_PRESETS di panels/elements.tsx). */
export interface PanelLayout {
  title?: ElementBox;
  value?: ElementBox;
  status?: ElementBox;
  device?: ElementBox;
  footer?: ElementBox;
  /** Gambar komponen: jarum/donat/tangki/lampu/grafik batang. */
  graphic?: ElementBox;
}

export interface ChartPanelConfig {
  tag_ids: string[]; // 0–4 historian tags (0 = belum diatur, placeholder)
  range: ChartRange;
  show_minmax: boolean;
  /** Warna per garis, sejajar dengan tag_ids; null = warna slot bawaan. */
  colors?: (string | null)[];
  /** Batas sumbu Y; null = otomatis. */
  y_min?: number | null;
  y_max?: number | null;
  line_style?: "smooth" | "linear" | "step";
  show_legend?: boolean;
  show_grid?: boolean;
}

/** Kolom tabel yang bisa dipilih & diurutkan sendiri. */
export type TableColumn = "tag" | "device" | "unit" | "value" | "min" | "avg" | "max";

export interface TablePanelConfig {
  tag_ids: string[]; // 0–8 historian tags
  range: ChartRange;
  /** Urutan + isi kolom; undefined = bawaan (tag, value, min, avg, max). */
  columns?: TableColumn[];
  show_header?: boolean;
  show_footer?: boolean;
}

export type GaugeStyle = "stat" | "arc" | "donut";

export interface GaugePanelConfig {
  tag_id: string | null; // null = belum diatur (dipasang dari palet, diatur lewat inspector)
  // Ambang Waspada/Kritis TIDAK di sini lagi — dibaca dari tag (config.warn_min/
  // warn_max/alarm_min/alarm_max) lewat readTagThresholds. Satu sumber ambang.
  /** Bentuk tampilan: "stat" (angka besar, bawaan), "arc" (jarum), "donut". */
  style?: GaugeStyle;
  /** Skala gauge untuk arc/donut; null = 0–100. */
  min?: number | null;
  max?: number | null;
  /** Override label/satuan tag; null = ikut tag. */
  label?: string | null;
  unit?: string | null;
  /** Warna zona normal; null = hijau tema. */
  color?: string | null;
  decimals?: number | null;
  elements?: PanelElements;
  layout?: PanelLayout;
}

export type BarMetric = "avg" | "last" | "min" | "max";

export interface BarPanelConfig {
  tag_ids: string[]; // idealnya ≥2 (perbandingan); 0 = belum diatur
  range: ChartRange;
  metric: BarMetric;
  /** Warna batang (satu ukuran = satu warna); null = warna chart bawaan. */
  color?: string | null;
  /** "horizontal" = batang mendatar (bawaan), "vertical" = batang tegak. */
  orientation?: "horizontal" | "vertical";
  elements?: PanelElements;
  layout?: PanelLayout;
}

/** Level/tangki: isi naik-turun mengikuti nilai sensor (min–max = 0–100%). */
export interface LevelPanelConfig {
  tag_id: string | null;
  min: number;
  max: number;
  // Ambang Waspada/Kritis dibaca dari tag (lihat GaugePanelConfig), bukan di sini.
  /** Warna cairan saat normal; null = warna chart bawaan. */
  color?: string | null;
  label?: string | null;
  unit?: string | null;
  elements?: PanelElements;
  layout?: PanelLayout;
}

/** LED indikator: menyala saat nilai berada di sisi `direction` dari ambang. */
export interface LedPanelConfig {
  tag_id: string | null;
  threshold: number;
  direction: "above" | "below";
  on_color?: string | null; // default hijau tema
  off_color?: string | null; // default abu redup
  on_label?: string;
  off_label?: string;
  label?: string | null;
  show_value?: boolean;
  elements?: PanelElements;
  layout?: PanelLayout;
}

/** Kolom panel alarm yang bisa dipilih & diurutkan sendiri. */
export type AlarmColumn =
  | "tag"
  | "bounds"
  | "device"
  | "value"
  | "status"
  | "time"
  | "ack";

export interface AlarmPanelConfig {
  tag_ids: string[]; // 1–8 tags to watch
  range: ChartRange; // window for the min/avg context (status uses latest)
  /** Urutan + isi kolom; undefined = bawaan (tag, bounds, value, status, ack). */
  columns?: AlarmColumn[];
  /** Strip "Semua normal / N alarm aktif" + tombol Riwayat. */
  show_header?: boolean;
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
  /** Native viewport (OBS-style source resolution): the page is laid out at
   *  exactly this size then scaled into its cell — the embedded site's own
   *  fullscreen fills this viewport (= its panel). null = fill cell (legacy). */
  view_w?: number | null;
  view_h?: number | null;
}

/** VNC channel source: a dedicated PC mirrored VIEW-ONLY via noVNC/websockify
 *  (e.g. browser showing a cloud SCADA). `url` = websockify endpoint; https://
 *  is accepted and normalized to wss:// at connect time. The password is a
 *  dedicated view-only one — every scada:view user can read it. */
export interface VncPanelConfig {
  url: string;
  password?: string | null;
  view_w?: number | null;
  view_h?: number | null;
}

/** A layout cell that shows one TV-style channel (see Channel below). */
export interface ChannelPanelConfig {
  channel_id: string;
}

/* ── SCADA HMI decor components (text + shapes) ── */

/** Static text label on the canvas. Plain text only — never HTML. */
export interface TextPanelConfig {
  content: string;
  /** Font size in CANVAS pixels (the canvas scales uniformly). */
  size: number;
  /** null = follow theme text color. */
  color: string | null;
  align: "left" | "center" | "right";
  bold: boolean;
}

export interface ShapePanelConfig {
  shape: "rect" | "circle" | "line";
  /** null = transparent fill / no border. */
  fill: string | null;
  stroke: string | null;
  stroke_w: number;
  /** Corner rounding for "rect" (canvas px). */
  radius: number;
}

/** Gambar/logo pemanis HMI. `src` = data URI hasil impor (dikecilkan di
 *  browser) atau URL http(s) langsung. Dirender lewat <img> — aman dari
 *  script; SVG tidak dieksekusi di dalam <img>. */
export interface ImagePanelConfig {
  src: string;
  fit: "contain" | "cover" | "fill";
  /** 0.1–1; default 1. */
  opacity?: number;
  /** Corner rounding (canvas px). */
  radius?: number;
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
  | (PanelBase & { type: "channel"; config: ChannelPanelConfig })
  | (PanelBase & { type: "text"; config: TextPanelConfig })
  | (PanelBase & { type: "shape"; config: ShapePanelConfig })
  | (PanelBase & { type: "level"; config: LevelPanelConfig })
  | (PanelBase & { type: "led"; config: LedPanelConfig })
  | (PanelBase & { type: "image"; config: ImagePanelConfig });

/* ── Channels (TV-style registry) ── */

export type ChannelKind =
  | "screen"
  | "chart"
  | "table"
  | "gauge"
  | "bar"
  | "alarm"
  | "activity";

/** Manual crop region in SOURCE pixels (relative to src_w×src_h). */
export interface CropRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A "screen" channel: shows one Source (stream/web/vnc) by id, optionally
 *  cropped (grid-divide 2×2/3×3 or a free rectangle). The source KIND comes
 *  from the referenced Stream.source_type — the channel doesn't store it. */
export interface ScreenChannelConfig {
  stream_id: string;
  crop?: CropRect | null;
  /** Reference resolution the crop was drawn against (auto-detected). */
  src_w?: number | null;
  src_h?: number | null;
  view_w?: number | null;
  view_h?: number | null;
}

/** One TV-style channel: number + nickname + one source definition. Defined
 *  on halaman Channel; the Monitor layout references channels by id. */
export interface Channel {
  id: string;
  number: number;
  name: string;
  kind: ChannelKind;
  config:
    | ScreenChannelConfig
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
  version: 1 | 2;
  /** v2 only — canvas resolution this page was designed at. */
  canvas?: CanvasSize;
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

export type SourceType = "stream" | "web" | "vnc";

/** A "Screen" source a channel can show. Despite the name it holds all three
 *  source kinds (`source_type`): "stream" (HLS/WebRTC video), "web" (embedded
 *  page/HMI), "vnc" (view-only PC mirror). Managed in the "Kelola Screen"
 *  dialog; a channel of kind "screen" references one by id and crops it. */
export interface Stream {
  id: string;
  name: string;
  source_type: SourceType;
  /** stream only — HLS playlist URL (null for web/vnc). */
  hls_url: string | null;
  /** stream only — optional WHEP endpoint: players try WebRTC (sub-second)
   *  first, then fall back to LL-HLS automatically. */
  webrtc_url: string | null;
  read_user: string | null;
  read_pass: string | null;
  /** web: the page URL; vnc: the noVNC/websockify endpoint (https→wss). */
  url: string | null;
  /** vnc: the VIEW-ONLY password (exposed like read_pass — the viewer's
   *  browser connects directly and needs it). */
  secret: string | null;
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

/* ── Alarms (server-side engine) ─────────────────────────────────────── */

/** "high" = di atas alarm_max, "low" = di bawah alarm_min,
 *  "silent" = sensor berhenti mengirim data,
 *  "expiring" = data akan diarsip & direset dari 0 dalam beberapa hari. */
export type AlarmKind = "high" | "low" | "silent" | "expiring";

/** One alarm occurrence from scada_alarm_events. Open (active) while
 *  cleared_at is null; the row itself is permanent history. */
export interface AlarmEvent {
  id: string;
  tag_id: string;
  tag_label: string;
  tag_unit: string;
  kind: AlarmKind;
  triggered_at: string;
  trigger_value: number | null;
  threshold: number | null;
  cleared_at: string | null;
  ack_at: string | null;
  ack_name: string | null;
}

export interface AlarmSettings {
  email_enabled: boolean;
  email_recipients: string;
  telegram_enabled: boolean;
  telegram_chat_id: string;
  cooldown_min: number;
  sound_enabled: boolean;
  /** Whether TELEGRAM_BOT_TOKEN is configured server-side (token itself is
   *  never exposed) — used to hint that Telegram can't work yet. */
  telegram_token_set: boolean;
}

/** Last-known live value per tag (scada_tag_latest). */
export interface LatestItem {
  tag_id: string;
  ts: string;
  value: number;
}

/** One archived historian cycle on Google Drive (scada_tag_archives). */
export interface Archive {
  tag_id: string;
  tag_label: string;
  file_name: string;
  web_link: string | null;
  row_count: number;
  cycle_start: string;
  cycle_end: string;
  created_at: string | null;
}

/** The 4 sampling levels a tag can pick; seconds are admin-tunable. */
export type SamplingLevel = "fastest" | "fast" | "slow" | "slowest";

/** R-Net global settings (sampling-level durations + retention knobs). */
export interface RnetSettings {
  level_fastest_s: number;
  level_fast_s: number;
  level_slow_s: number;
  level_slowest_s: number;
  ring_window_h: number;
  store_months: number;
  reset_warn_days: number;
}

/** One bucketed mini-series point (avg over the bucket). */
export interface SparklinePoint {
  t: string; // bucket start ISO
  v: number; // bucket average
}

export interface SparklineSeries {
  tag_id: string;
  points: SparklinePoint[];
}
