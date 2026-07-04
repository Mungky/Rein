/** API client for the SCADA Monitor module (perspectives + streams). */

import { apiClient } from "./client";
import type { Perspective, PerspectiveLayout, Stream } from "@/features/scada/types";

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

  /* ── Streams ── */
  listStreams: () => apiClient.get<{ items: Stream[] }>("/api/scada/streams"),

  createStream: (data: {
    name: string;
    hls_url: string;
    read_user?: string | null;
    read_pass?: string | null;
    enabled?: boolean;
  }) => apiClient.post<Stream>("/api/scada/streams", data),

  updateStream: (
    id: string,
    data: {
      name?: string;
      hls_url?: string;
      read_user?: string | null;
      read_pass?: string | null;
      enabled?: boolean;
    }
  ) => apiClient.patch<Stream>(`/api/scada/streams/${id}`, data),

  deleteStream: (id: string) =>
    apiClient.delete<{ deleted: string }>(`/api/scada/streams/${id}`),
};
