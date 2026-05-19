"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { uploadFile } from "@/lib/api/library";
import type { UploadFormValues } from "./types";

export type UploadStatus = "queued" | "uploading" | "success" | "failed";

export interface UploadItem {
  id: string;
  file: File;
  form: UploadFormValues;
  status: UploadStatus;
  progress: number;
  attempt: number;
  error: string | null;
  result?: { file_id: string; file_name: string; gdrive_web_link?: string };
}

const CONCURRENCY = 3;
const MAX_RETRIES = 2;
const RETRY_BACKOFF_MS = 1500;

export interface UploadQueueApi {
  items: UploadItem[];
  add: (files: { file: File; form: UploadFormValues }[]) => void;
  remove: (id: string) => void;
  retry: (id: string) => void;
  clearCompleted: () => void;
  clearAll: () => void;
}

export function useUploadQueue(): UploadQueueApi {
  const [items, setItems] = useState<UploadItem[]>([]);
  const runningRef = useRef<Set<string>>(new Set());
  const itemsRef = useRef<UploadItem[]>([]);

  itemsRef.current = items;

  const startUpload = useCallback((id: string) => {
    const item = itemsRef.current.find((i) => i.id === id);
    if (!item) {
      runningRef.current.delete(id);
      return;
    }

    setItems((prev) =>
      prev.map((i) =>
        i.id === id
          ? { ...i, status: "uploading" as const, attempt: i.attempt + 1, error: null }
          : i,
      ),
    );

    uploadFile(item.file, item.form, (pct) => {
      setItems((prev) => prev.map((i) => (i.id === id ? { ...i, progress: pct } : i)));
    })
      .then((result) => {
        runningRef.current.delete(id);
        setItems((prev) =>
          prev.map((i) =>
            i.id === id ? { ...i, status: "success" as const, progress: 100, result } : i,
          ),
        );
      })
      .catch((err) => {
        runningRef.current.delete(id);
        const message = err instanceof Error ? err.message : "Upload gagal";
        setItems((prev) =>
          prev.map((i) => {
            if (i.id !== id) return i;
            if (i.attempt < MAX_RETRIES) {
              const delay = RETRY_BACKOFF_MS * Math.pow(2, i.attempt - 1);
              window.setTimeout(() => {
                setItems((p) =>
                  p.map((x) =>
                    x.id === id ? { ...x, status: "queued" as const, error: null } : x,
                  ),
                );
              }, delay);
              return {
                ...i,
                status: "failed" as const,
                error: `${message} — akan mencoba lagi…`,
              };
            }
            return { ...i, status: "failed" as const, error: message };
          }),
        );
      });
  }, []);

  // Schedule queued items into available concurrency slots
  useEffect(() => {
    const queued = items.filter((i) => i.status === "queued" && !runningRef.current.has(i.id));
    if (queued.length === 0) return;
    const available = CONCURRENCY - runningRef.current.size;
    if (available <= 0) return;
    for (const item of queued.slice(0, available)) {
      runningRef.current.add(item.id);
      startUpload(item.id);
    }
  }, [items, startUpload]);

  const add = useCallback((batch: { file: File; form: UploadFormValues }[]) => {
    if (batch.length === 0) return;
    const now = Date.now();
    const created: UploadItem[] = batch.map((n, i) => ({
      id: `${now}-${i}-${n.file.name}-${n.file.size}`,
      file: n.file,
      form: n.form,
      status: "queued",
      progress: 0,
      attempt: 0,
      error: null,
    }));
    setItems((prev) => [...prev, ...created]);
  }, []);

  const remove = useCallback((id: string) => {
    setItems((prev) => prev.filter((i) => i.id !== id));
  }, []);

  const retry = useCallback((id: string) => {
    setItems((prev) =>
      prev.map((i) =>
        i.id === id
          ? { ...i, status: "queued" as const, error: null, attempt: 0, progress: 0 }
          : i,
      ),
    );
  }, []);

  const clearCompleted = useCallback(() => {
    setItems((prev) => prev.filter((i) => i.status !== "success"));
  }, []);

  const clearAll = useCallback(() => {
    setItems((prev) => prev.filter((i) => i.status === "uploading"));
  }, []);

  return { items, add, remove, retry, clearCompleted, clearAll };
}
