/** API client for REIN FastAPI backend. */

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

class ApiClient {
  private baseUrl: string;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl;
  }

  private async getAuthHeaders(): Promise<HeadersInit> {
    // Get Supabase session token
    const { getSupabaseClient } = await import("@/lib/supabase/client");
    const supabase = getSupabaseClient();
    const { data: { session } } = await supabase.auth.getSession();

    return {
      "Content-Type": "application/json",
      ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
    };
  }

  async get<T>(path: string, params?: Record<string, string>): Promise<T> {
    const url = new URL(`${this.baseUrl}${path}`);
    if (params) {
      Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
    }
    const headers = await this.getAuthHeaders();
    const res = await fetch(url.toString(), { headers });
    if (!res.ok) throw new ApiError(res.status, await res.text());
    return res.json();
  }

  /** Download a file the server generated (e.g. the R-Net Excel export).
   *  `rawQuery` is appended verbatim so repeated keys (tag_ids=a&tag_ids=b)
   *  survive — URLSearchParams-in-an-object would collapse them. Returns the
   *  blob plus the filename the server chose in Content-Disposition. */
  async getBlob(
    path: string,
    rawQuery?: string
  ): Promise<{ blob: Blob; filename: string | null }> {
    const headers = await this.getAuthHeaders();
    const res = await fetch(
      `${this.baseUrl}${path}${rawQuery ? `?${rawQuery}` : ""}`,
      { headers }
    );
    if (!res.ok) throw new ApiError(res.status, await res.text());
    const disp = res.headers.get("content-disposition") ?? "";
    const match = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(disp);
    return {
      blob: await res.blob(),
      filename: match ? decodeURIComponent(match[1]) : null,
    };
  }

  async post<T>(path: string, body?: unknown): Promise<T> {
    const headers = await this.getAuthHeaders();
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: "POST",
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) throw new ApiError(res.status, await res.text());
    return res.json();
  }

  async patch<T>(path: string, body?: unknown): Promise<T> {
    const headers = await this.getAuthHeaders();
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: "PATCH",
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) throw new ApiError(res.status, await res.text());
    return res.json();
  }

  async put<T>(path: string, body?: unknown): Promise<T> {
    const headers = await this.getAuthHeaders();
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: "PUT",
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) throw new ApiError(res.status, await res.text());
    return res.json();
  }

  async delete<T>(path: string): Promise<T> {
    const headers = await this.getAuthHeaders();
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: "DELETE",
      headers,
    });
    if (!res.ok) throw new ApiError(res.status, await res.text());
    return res.json();
  }

  async upload<T>(path: string, file: File, fieldName = "file"): Promise<T> {
    const { getSupabaseClient } = await import("@/lib/supabase/client");
    const supabase = getSupabaseClient();
    const { data: { session } } = await supabase.auth.getSession();

    const formData = new FormData();
    formData.append(fieldName, file);

    const res = await fetch(`${this.baseUrl}${path}`, {
      method: "POST",
      headers: {
        ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
      },
      body: formData,
    });
    if (!res.ok) throw new ApiError(res.status, await res.text());
    return res.json();
  }

}

class ApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    this.name = "ApiError";
  }
}

export const apiClient = new ApiClient(API_URL);