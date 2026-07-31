/** API client for the R-Net module (perspectives + streams + historian). */

import { apiClient } from "./client";
import type {
  AlarmEvent,
  AlarmSettings,
  Archive,
  Channel,
  ChannelKind,
  Coverage,
  HistorySeries,
  Lane,
  LatestItem,
  Perspective,
  PerspectiveLayout,
  PublishedLayout,
  RecentSample,
  RnetSettings,
  RollupArchive,
  Sheet,
  Site,
  SparklineSeries,
  Stream,
  SummaryItem,
  Tag,
} from "@/features/scada/types";

export const scadaApi = {
  /* ── Perspectives (per-user) ── */
  listPerspectives: () =>
    apiClient.get<{ items: Perspective[] }>("/api/scada/perspectives"),

  createPerspective: (name: string, layout: PerspectiveLayout) =>
    apiClient.post<Perspective>("/api/scada/perspectives", { name, layout }),

  updatePerspective: (
    id: string,
    data: { name?: string; layout?: PerspectiveLayout }
  ) => apiClient.patch<Perspective>(`/api/scada/perspectives/${id}`, data),

  deletePerspective: (id: string) =>
    apiClient.delete<{ deleted: string }>(`/api/scada/perspectives/${id}`),

  setDefaultPerspective: (id: string) =>
    apiClient.post<Perspective>(`/api/scada/perspectives/${id}/default`, {}),

  /** The admin-published default layout (Masalah D) — exists=false when none. */
  getPublishedLayout: () =>
    apiClient.get<PublishedLayout>("/api/scada/perspectives/published"),

  /** Publish one of the caller's perspectives as THE admin default (scada:manage). */
  publishPerspective: (id: string) =>
    apiClient.post<Perspective>(`/api/scada/perspectives/${id}/publish`, {}),

  /** Remove admin-default status from the caller's perspective (scada:manage). */
  unpublishPerspective: (id: string) =>
    apiClient.post<Perspective>(`/api/scada/perspectives/${id}/unpublish`, {}),

  /** Overwrite the caller's perspective with the current admin default. */
  resetPerspectiveToDefault: (id: string) =>
    apiClient.post<Perspective>(`/api/scada/perspectives/${id}/reset-to-default`, {}),

  /* ── Streams ── */
  listStreams: () => apiClient.get<{ items: Stream[] }>("/api/scada/streams"),

  createStream: (data: {
    name: string;
    source_type?: "stream" | "web" | "vnc";
    hls_url?: string | null;
    webrtc_url?: string | null;
    read_user?: string | null;
    read_pass?: string | null;
    url?: string | null;
    secret?: string | null;
    enabled?: boolean;
  }) => apiClient.post<Stream>("/api/scada/streams", data),

  updateStream: (
    id: string,
    data: {
      name?: string;
      source_type?: "stream" | "web" | "vnc";
      hls_url?: string | null;
      webrtc_url?: string | null;
      read_user?: string | null;
      read_pass?: string | null;
      url?: string | null;
      secret?: string | null;
      enabled?: boolean;
    }
  ) => apiClient.patch<Stream>(`/api/scada/streams/${id}`, data),

  deleteStream: (id: string) =>
    apiClient.delete<{ deleted: string }>(`/api/scada/streams/${id}`),

  /* ── Channels (TV-style registry: number + nickname + one source) ── */
  listChannels: () => apiClient.get<{ items: Channel[] }>("/api/scada/channels"),

  createChannel: (data: {
    number: number;
    name: string;
    kind: ChannelKind;
    config: Record<string, unknown>;
    enabled?: boolean;
  }) => apiClient.post<Channel>("/api/scada/channels", data),

  updateChannel: (
    id: string,
    data: {
      number?: number;
      name?: string;
      kind?: ChannelKind;
      config?: Record<string, unknown>;
      enabled?: boolean;
    }
  ) => apiClient.patch<Channel>(`/api/scada/channels/${id}`, data),

  deleteChannel: (id: string) =>
    apiClient.delete<{ deleted: string }>(`/api/scada/channels/${id}`),

  /* ── Sites (MQTT brokers) ── */
  listSites: () => apiClient.get<{ items: Site[] }>("/api/scada/sites"),

  createSite: (data: {
    name: string;
    mqtt_host: string;
    mqtt_port?: number;
    mqtt_username?: string | null;
    mqtt_password?: string | null;
    base_topic?: string;
    enabled?: boolean;
  }) => apiClient.post<Site>("/api/scada/sites", data),

  updateSite: (
    id: string,
    data: {
      name?: string;
      mqtt_host?: string;
      mqtt_port?: number;
      mqtt_username?: string | null;
      mqtt_password?: string | null;
      base_topic?: string;
      enabled?: boolean;
    }
  ) => apiClient.patch<Site>(`/api/scada/sites/${id}`, data),

  deleteSite: (id: string) =>
    apiClient.delete<{ deleted: string }>(`/api/scada/sites/${id}`),

  /* ── Workbench: sheets ("Tabel") ── */
  listSheets: () => apiClient.get<{ items: Sheet[] }>("/api/scada/sheets"),

  createSheet: (name: string) =>
    apiClient.post<Sheet>("/api/scada/sheets", { name }),

  updateSheet: (id: string, data: { name?: string; position?: number }) =>
    apiClient.patch<Sheet>(`/api/scada/sheets/${id}`, data),

  deleteSheet: (id: string) =>
    apiClient.delete<{ deleted: string }>(`/api/scada/sheets/${id}`),

  /* ── Historian: tags ── */
  listTags: () => apiClient.get<{ items: Tag[] }>("/api/scada/tags"),

  createTag: (data: {
    sheet_id: string;
    source?: "simulator" | "mqtt";
    site_id?: string | null;
    device_key: string;
    label: string;
    unit?: string;
    enabled?: boolean;
    config?: Record<string, unknown>;
    meta?: Record<string, string | number>;
  }) => apiClient.post<Tag>("/api/scada/tags", data),

  updateTag: (
    id: string,
    data: {
      sheet_id?: string;
      source?: "simulator" | "mqtt";
      site_id?: string | null;
      device_key?: string;
      label?: string;
      unit?: string;
      enabled?: boolean;
      config?: Record<string, unknown>;
      meta?: Record<string, string | number>;
    }
  ) => apiClient.patch<Tag>(`/api/scada/tags/${id}`, data),

  deleteTag: (id: string) =>
    apiClient.delete<{ deleted: string }>(`/api/scada/tags/${id}`),

  getRecentSamples: (id: string, limit = 100) =>
    apiClient.get<{ items: RecentSample[] }>(
      `/api/scada/tags/${id}/recent?limit=${limit}`
    ),

  /** Riwayat mentah berhalaman (keyset, terbaru dulu) — feed scroll tanpa
   *  batas halaman Riwayat. `before` = ts baris tertua yang sudah dimuat. */
  /** Export dirakit di SERVER (audit D-7) — satu permintaan, satu berkas.
   *  Satu sensor kembali sebagai .csv polos, beberapa sensor sebagai .zip
   *  berisi satu CSV per sensor. Menggantikan perakitan di browser yang bisa
   *  menembak ribuan permintaan dan menyimpan jutaan baris di memori tab. */
  exportData: (tagIds: string[], start: Date, end: Date, lane: Lane = "raw") => {
    const q = new URLSearchParams();
    for (const id of tagIds) q.append("tag_ids", id);
    q.set("start", start.toISOString());
    q.set("end", end.toISOString());
    // "raw" = setiap nilai, tapi cuma 24-48 jam terakhir yang ada.
    // "rollup" = satu baris per menit, 30-61 hari.
    q.set("lane", lane);
    return apiClient.getBlob("/api/scada/export", q.toString());
  },

  /** Jendela yang BENAR-BENAR terisi di tiap lajur, dari nama partisi — bukan
   *  dari konstanta kebijakan. Tanpa tag_ids: ringkasan lajur saja. */
  getCoverage: (tagIds?: string[]) => {
    const q = new URLSearchParams();
    for (const id of tagIds ?? []) q.append("tag_ids", id);
    const qs = q.toString();
    return apiClient.get<Coverage>(
      "/api/scada/coverage" + (qs ? `?${qs}` : "")
    );
  },

  getSamplesPage: (id: string, opts: { before?: string; limit?: number } = {}) => {
    const params = new URLSearchParams();
    if (opts.before) params.set("before", opts.before);
    params.set("limit", String(opts.limit ?? 2000));
    return apiClient.get<{ items: RecentSample[]; has_more: boolean }>(
      `/api/scada/tags/${id}/samples?${params.toString()}`
    );
  },

  /* ── Historian: bucketed history ── */
  getHistory: (tagIds: string[], start: Date, end: Date, points = 300) => {
    const params = new URLSearchParams();
    for (const id of tagIds) params.append("tag_ids", id);
    params.set("start", start.toISOString());
    params.set("end", end.toISOString());
    params.set("points", String(points));
    return apiClient.get<{ series: HistorySeries[] }>(
      `/api/scada/history?${params.toString()}`
    );
  },

  /** Bucketed mini-series (default 12 jam) for the tags ON SCREEN, in one call
   *  — feeds the sparklines in the Analisis table.
   *
   *  Pass the ids of the rows actually being rendered (one page's worth, max
   *  60). Omitting them makes the server pick, and it picks by database order:
   *  on a 300-sensor plant that meant an arbitrary 60 rows had a sparkline and
   *  240 had none. */
  getSparklines: (rangeH = 12, points = 120, tagIds?: string[]) => {
    const params = new URLSearchParams({
      range_h: String(rangeH),
      points: String(points),
    });
    for (const id of tagIds ?? []) params.append("tag_ids", id);
    return apiClient.get<{ items: SparklineSeries[] }>(
      `/api/scada/sparklines?${params.toString()}`
    );
  },

  /** Isi TERAKHIR dari setiap topik MQTT yang sedang dilanggan jembatan —
   *  sumber jawaban untuk "kolom Field harus diisi apa". scada:manage. */
  listTopicProbes: () =>
    apiClient.get<{
      items: {
        site_id: string;
        site_name: string;
        topic: string;
        gateway: string;
        bundled: boolean;
        fields: { name: string; value: number; used_by: string[] }[];
        seen_at: string;
      }[];
    }>("/api/scada/topic-probes"),

  /** Buat banyak sensor sekaligus dari satu daftar (CSV yang sudah diurai).
   *  Semua-atau-tidak sama sekali: kalau ada satu baris bermasalah, TIDAK ADA
   *  yang dibuat dan `errors` berisi nomor barisnya. */
  importTags: (body: {
    sheet_id: string;
    site_id: string;
    rows: Record<string, unknown>[];
  }) =>
    apiClient.post<{
      created: number;
      errors: { row: number; label: string; message: string }[];
    }>("/api/scada/tags/import", body),

  /* ── Historian: latest value + min/avg/max snapshot (table/gauge panels) ── */
  getSummary: (tagIds: string[], start: Date, end: Date) => {
    const params = new URLSearchParams();
    for (const id of tagIds) params.append("tag_ids", id);
    params.set("start", start.toISOString());
    params.set("end", end.toISOString());
    return apiClient.get<{ items: SummaryItem[] }>(
      `/api/scada/summary?${params.toString()}`
    );
  },

  /* ── Alarms (server-side engine — see backend scada_alarms router) ── */
  listActiveAlarms: () =>
    apiClient.get<{ items: AlarmEvent[] }>("/api/scada/alarms/active"),

  listAlarmHistory: (opts: {
    page?: number;
    pageSize?: number;
    tagId?: string;
    kind?: string;
    start?: Date;
    end?: Date;
  } = {}) => {
    const params = new URLSearchParams();
    params.set("page", String(opts.page ?? 1));
    params.set("page_size", String(opts.pageSize ?? 25));
    if (opts.tagId) params.set("tag_id", opts.tagId);
    if (opts.kind) params.set("kind", opts.kind);
    if (opts.start) params.set("start", opts.start.toISOString());
    if (opts.end) params.set("end", opts.end.toISOString());
    return apiClient.get<{
      items: AlarmEvent[];
      total: number;
      page: number;
      page_size: number;
    }>(`/api/scada/alarms/history?${params.toString()}`);
  },

  ackAlarm: (eventId: string) =>
    apiClient.post<AlarmEvent>(`/api/scada/alarms/${eventId}/ack`, {}),

  /** Last-known live value per tag (scada_tag_latest) — cheap, cap 100 tags. */
  getLatest: (tagIds: string[]) =>
    apiClient.get<{ items: LatestItem[] }>(
      `/api/scada/latest?tag_ids=${tagIds.join(",")}`
    ),

  /** Per-tag cycle archives on Drive — where each sensor's data lives after
   *  its 1-month reset. */
  listArchives: () =>
    apiClient.get<{ items: Archive[] }>("/api/scada/archives"),

  /** Per-PLANT summary-month archives on Drive (.zip of per-sensor CSVs) —
   *  where the 1-minute lane goes once its month partition is dropped. The
   *  endpoint has existed since the rollup archiver shipped; nothing in the
   *  frontend had ever called it, so those files were invisible in R-Net. */
  listRollupArchives: () =>
    apiClient.get<{ items: RollupArchive[] }>("/api/scada/rollup-archives"),

  /* ── R-Net settings (sampling-level durations + retention) ── */
  getRnetSettings: () =>
    apiClient.get<RnetSettings>("/api/scada/settings"),

  updateRnetSettings: (data: Partial<RnetSettings>) =>
    apiClient.patch<RnetSettings>("/api/scada/settings", data),

  getAlarmSettings: () =>
    apiClient.get<AlarmSettings>("/api/scada/alarm-settings"),

  updateAlarmSettings: (data: {
    email_enabled?: boolean;
    email_recipients?: string;
    telegram_enabled?: boolean;
    telegram_chat_id?: string;
    cooldown_min?: number;
    sound_enabled?: boolean;
  }) => apiClient.put<AlarmSettings>("/api/scada/alarm-settings", data),

  sendTestAlarm: () =>
    apiClient.post<{ sent: string[] }>("/api/scada/alarm-settings/test", {}),

};
