/** API client for the R-Net module (perspectives + streams + historian). */

import { apiClient } from "./client";
import type {
  ColumnKind,
  HistorySeries,
  Perspective,
  PerspectiveLayout,
  PublishedLayout,
  RecentSample,
  Sheet,
  Site,
  Stream,
  SummaryItem,
  Tag,
  WorkbenchColumn,
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
    hls_url: string;
    read_user?: string | null;
    read_pass?: string | null;
    enabled?: boolean;
    mosaic_rows?: number;
    mosaic_cols?: number;
    channel_start?: number;
  }) => apiClient.post<Stream>("/api/scada/streams", data),

  updateStream: (
    id: string,
    data: {
      name?: string;
      hls_url?: string;
      read_user?: string | null;
      read_pass?: string | null;
      enabled?: boolean;
      mosaic_rows?: number;
      mosaic_cols?: number;
      channel_start?: number;
    }
  ) => apiClient.patch<Stream>(`/api/scada/streams/${id}`, data),

  deleteStream: (id: string) =>
    apiClient.delete<{ deleted: string }>(`/api/scada/streams/${id}`),

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

  /* ── Workbench: shared custom formula columns (Analisis view) ── */
  listColumns: () =>
    apiClient.get<{ items: WorkbenchColumn[] }>("/api/scada/workbench/columns"),

  createColumn: (data: {
    sheet_id: string;
    name: string;
    kind: ColumnKind;
    formula?: string;
    unit?: string;
    decimals?: number;
  }) => apiClient.post<WorkbenchColumn>("/api/scada/workbench/columns", data),

  updateColumn: (
    id: string,
    data: {
      name?: string;
      formula?: string;
      unit?: string;
      decimals?: number;
      position?: number;
    }
  ) => apiClient.patch<WorkbenchColumn>(`/api/scada/workbench/columns/${id}`, data),

  deleteColumn: (id: string) =>
    apiClient.delete<{ deleted: string }>(`/api/scada/workbench/columns/${id}`),
};
