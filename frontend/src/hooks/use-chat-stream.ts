"use client";

import { useState, useCallback, useRef } from "react";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

/** Message types matching the backend ChatStreamEvent schema */
export type ChatMessageType =
  | "user"
  | "assistant"
  | "tool_call"
  | "search_results"
  | "proposal"
  | "confirmation";

export interface ChatMessage {
  id: string;
  type: ChatMessageType;
  time: string;
  text?: string;
  tool?: string;
  args?: Record<string, string>;
  results?: SearchResult[];
  file?: { name: string; size: string };
  detected?: Record<string, { value: string; label?: string; code?: string; confidence: number }>;
  status?: string;
  confirmationData?: Record<string, unknown>;
}

export interface SearchResult {
  id: string;
  name: string;
  client: string;
  project: string;
  date: string;
  size: string;
  doc_number?: string;
  doc_type?: string;
  status?: string;
}

export interface UseChatStreamReturn {
  messages: ChatMessage[];
  isStreaming: boolean;
  error: string | null;
  send: (text: string) => void;
  clearError: () => void;
}

/**
 * Hook for streaming chat with the NimBus AI backend.
 * Connects to POST /api/chat/ via fetch + ReadableStream SSE.
 * Parses all event types: text, tool_call, search_results, confirmation.
 */
export function useChatStream(conversationId?: string): UseChatStreamReturn {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const convId = useRef(conversationId || `conv-${Date.now()}`);

  const now = () =>
    new Date().toLocaleTimeString("id", { hour: "2-digit", minute: "2-digit" });

  const send = useCallback(async (text: string) => {
    if (!text.trim() || isStreaming) return;

    const userMsg: ChatMessage = {
      id: `u-${Date.now()}`,
      type: "user",
      time: now(),
      text: text.trim(),
    };

    setMessages((prev) => [...prev, userMsg]);
    setIsStreaming(true);
    setError(null);

    const assistantId = `a-${Date.now()}`;
    let currentText = "";

    try {
      // Get auth token
      let headers: Record<string, string> = { "Content-Type": "application/json" };
      try {
        const { getSupabaseClient } = await import("@/lib/supabase/client");
        const supabase = getSupabaseClient();
        if (supabase) {
          const { data: { session } } = await supabase.auth.getSession();
          if (session?.access_token) {
            headers["Authorization"] = `Bearer ${session.access_token}`;
          }
        }
      } catch {
        // Auth not available, continue without token
      }

      abortRef.current = new AbortController();

      const response = await fetch(`${API_URL}/api/chat/`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          messages: [{ role: "user", content: text.trim() }],
          conversation_id: convId.current,
        }),
        signal: abortRef.current.signal,
      });

      if (!response.ok) {
        throw new Error(`Server error: ${response.status}`);
      }

      const reader = response.body?.getReader();
      if (!reader) throw new Error("No response body");

      const decoder = new TextDecoder();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split("\n");
        for (const line of lines) {
          if (!line.startsWith("data:")) continue;
          const data = line.slice(5).trim();
          if (data === "[DONE]") continue;

          try {
            const event = JSON.parse(data);

            if (event.type === "text" && event.content) {
              currentText += event.content;
              setMessages((prev) => {
                const updated = [...prev];
                const idx = updated.findIndex((m) => m.id === assistantId);
                const assistantMsg: ChatMessage = {
                  id: assistantId,
                  type: "assistant",
                  time: now(),
                  text: currentText,
                };
                if (idx >= 0) {
                  updated[idx] = assistantMsg;
                } else {
                  updated.push(assistantMsg);
                }
                return updated;
              });
            } else if (event.type === "tool_call") {
              setMessages((prev) => [
                ...prev,
                {
                  id: `tc-${Date.now()}`,
                  type: "tool_call",
                  time: now(),
                  tool: event.tool,
                  args: event.args,
                },
              ]);
            } else if (event.type === "search_results") {
              setMessages((prev) => [
                ...prev,
                {
                  id: `sr-${Date.now()}`,
                  type: "search_results",
                  time: now(),
                  results: (event.results || []).map((r: Record<string, unknown>) => ({
                    id: r.id || "",
                    name: r.title || r.doc_number || "",
                    client: r.client_name || "",
                    project: r.project_name || "",
                    date: r.created_at || "",
                    size: r.file_size ? String(r.file_size) : "",
                    doc_number: r.doc_number,
                    doc_type: r.doc_type,
                    status: r.status,
                  })),
                },
              ]);
            } else if (event.type === "confirmation") {
              setMessages((prev) => [
                ...prev,
                {
                  id: `cf-${Date.now()}`,
                  type: "confirmation",
                  time: now(),
                  text: event.message,
                  confirmationData: event.data,
                },
              ]);
            }
          } catch {
            // Not JSON, skip
          }
        }
      }

      // If no text was received, show a fallback message
      if (!currentText) {
        setMessages((prev) => [
          ...prev,
          {
            id: assistantId,
            type: "assistant",
            time: now(),
            text: "Maaf, saya tidak bisa terhubung ke server AI. Silakan coba lagi.",
          },
        ]);
      }
    } catch (err: unknown) {
      if (err instanceof Error && err.name === "AbortError") return;
      const message = err instanceof Error ? err.message : "Terjadi kesalahan";
      setError(message);
      setMessages((prev) => [
        ...prev,
        {
          id: `err-${Date.now()}`,
          type: "assistant",
          time: now(),
          text: `⚠️ ${message}`,
        },
      ]);
    } finally {
      setIsStreaming(false);
      abortRef.current = null;
    }
  }, [isStreaming]);

  const clearError = useCallback(() => setError(null), []);

  return { messages, isStreaming, error, send, clearError };
}