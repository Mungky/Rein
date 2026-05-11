/** API client for clients and projects. */

import { apiClient } from "./client";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Client {
  id: string;
  code: string;
  name: string;
  is_active: boolean;
}

export interface Project {
  id: string;
  code: string;
  name: string;
  client_id: string;
  is_active: boolean;
}

export interface ClientCreate {
  code: string;
  name: string;
}

export interface ClientUpdate {
  code?: string;
  name?: string;
}

export interface ProjectCreate {
  code: string;
  name: string;
  client_id: string;
}

export interface ProjectUpdate {
  code?: string;
  name?: string;
  client_id?: string;
}

// ---------------------------------------------------------------------------
// Clients API
// ---------------------------------------------------------------------------

export const clientsApi = {
  list: (activeOnly = true) =>
    apiClient.get<Client[]>("/api/clients/", { active_only: String(activeOnly) }),

  create: (data: ClientCreate) =>
    apiClient.post<Client>("/api/clients/", data),

  update: (id: string, data: ClientUpdate) =>
    apiClient.patch<Client>(`/api/clients/${id}`, data),

  deactivate: (id: string) =>
    apiClient.patch<Client>(`/api/clients/${id}/deactivate`, {}),
};

// ---------------------------------------------------------------------------
// Projects API
// ---------------------------------------------------------------------------

export const projectsApi = {
  list: (clientId?: string, activeOnly = true) =>
    apiClient.get<Project[]>("/api/projects/", {
      ...(clientId ? { client_id: clientId } : {}),
      active_only: String(activeOnly),
    }),

  create: (data: ProjectCreate) =>
    apiClient.post<Project>("/api/projects/", data),

  update: (id: string, data: ProjectUpdate) =>
    apiClient.patch<Project>(`/api/projects/${id}`, data),

  deactivate: (id: string) =>
    apiClient.patch<Project>(`/api/projects/${id}/deactivate`, {}),
};