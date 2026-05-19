"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { uploadFile } from "@/lib/api/library";
import type { UploadFormValues } from "./types";
import {
  clearUploads,
  deleteUpload,
  loadAllUploads,
  persistUpload,
  storedToFile,
  type StoredUpload,
} from "./upload-idb";

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
const MAX_RETRIES = 3;
const RETRY_BACKOFF_MS = 1500;

export interface UploadQueueApi {
  items: UploadItem[];
  add: (files: { file: File; form: UploadFormValues }[]) => void;
  remove: (id: string) => void;
  retry: (id: string) => void;
  retryAllFailed: () => void;
  clearCompleted: () => void;
  clearAll: () => void;
  hydrated: boolean;
}

// ── Helpers to persist a single item state ────────────────────────────────────

function itemToStored(item: UploadItem): StoredUpload {
  return {
    id: item.id,
    fileBlob: item.file,
    fileName: item.file.name,
    fileSize: item.file.size,
    fileType: item.file.type,
    fileLastModified: item.file.lastModified,
    form: item.form,
    status: item.status,
    attempt: item.attempt,
    error: item.error,
    addedAt: Date.now(),
  };
}

function storedToItem(row: StoredUpload): UploadItem {
  // Failed items resume as queued so they retry; uploading ones too (interrupted by refresh).
  const resumed: UploadStatus =
    row.status === "uploading" || row.status === "failed" ? "queued" : row.status;
  return {
    id: row.id,
    file: storedToFile(row),
    form: row.form,
    status: resumed,
    progress: 0,
    attempt: resumed === "queued" ? 0 : row.attempt,
    error: null,
  };
}

export function useUploadQueue(): UploadQueueApi {
  const [items, setItems] = useState<UploadItem[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const runningRef = useRef<Set<string>>(new Set());
  const itemsRef = useRef<UploadItem[]>([]);

  itemsRef.current = items;

  // ── Hydrate from IDB on mount ────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    loadAllUploads()
      .then((rows) => {
        if (cancelled) return;
        if (rows.length === 0) return;
        const restored = rows.map(storedToItem);
        setItems(restored);
      })
      .finally(() => {
        if (!cancelled) setHydrated(true);
      });
    return () => { cancelled = true; };
  }, []);

  // ── Upload action ────────────────────────────────────────────────────────
  const startUpload = useCallback((id: string) => {
    const item = itemsRef.current.find((i) => i.id === id);
    if (!item) {
      runningRef.current.delete(id);
      return;
    }

    setItems((prev) => {
      const next = prev.map((i) =>
        i.id === id
          ? { ...i, status: "uploading" as const, attempt: i.attempt + 1, error: null }
          : i,
      );
      const updated = next.find((i) => i.id === id);
      if (updated) persistUpload(itemToStored(updated));
      return next;
    });

    uploadFile(item.file, item.form, (pct) => {
      setItems((prev) => prev.map((i) => (i.id === id ? { ...i, progress: pct } : i)));
    })
      .then((result) => {
        runningRef.current.delete(id);
        // Successful: keep in queue with success status (visible in report) until user clears.
        setItems((prev) => {
          const next = prev.map((i) =>
            i.id === id ? { ...i, status: "success" as const, progress: 100, result } : i,
          );
          const updated = next.find((i) => i.id === id);
          if (updated) persistUpload(itemToStored(updated));
          return next;
        });
      })
      .catch((err) => {
        runningRef.current.delete(id);
        const message = err instanceof Error ? err.message : "Upload gagal";
        setItems((prev) => {
          const next = prev.map((i) => {
            if (i.id !== id) return i;
            if (i.attempt < MAX_RETRIES) {
              const delay = RETRY_BACKOFF_MS * Math.pow(2, i.attempt - 1);
              window.setTimeout(() => {
                setItems((p) => {
                  const reset = p.map((x) =>
                    x.id === id ? { ...x, status: "queued" as const, error: null } : x,
                  );
                  const r = reset.find((x) => x.id === id);
                  if (r) persistUpload(itemToStored(r));
                  return reset;
                });
              }, delay);
              return {
                ...i,
                status: "failed" as const,
                error: `${message} — akan mencoba lagi (${i.attempt}/${MAX_RETRIES})…`,
              };
            }
            return { ...i, status: "failed" as const, error: message };
          });
          const updated = next.find((i) => i.id === id);
          if (updated) persistUpload(itemToStored(updated));
          return next;
        });
      });
  }, []);

  // ── Schedule queued items into concurrency slots ─────────────────────────
  useEffect(() => {
    if (!hydrated) return;
    const queued = items.filter((i) => i.status === "queued" && !runningRef.current.has(i.id));
    if (queued.length === 0) return;
    const available = CONCURRENCY - runningRef.current.size;
    if (available <= 0) return;
    for (const item of queued.slice(0, available)) {
      runningRef.current.add(item.id);
      startUpload(item.id);
    }
  }, [items, startUpload, hydrated]);

  // ── Public API ───────────────────────────────────────────────────────────
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
    for (const item of created) persistUpload(itemToStored(item));
    setItems((prev) => [...prev, ...created]);
  }, []);

  const remove = useCallback((id: string) => {
    deleteUpload(id);
    setItems((prev) => prev.filter((i) => i.id !== id));
  }, []);

  const retry = useCallback((id: string) => {
    setItems((prev) => {
      const next = prev.map((i) =>
        i.id === id
          ? { ...i, status: "queued" as const, error: null, attempt: 0, progress: 0 }
          : i,
      );
      const updated = next.find((i) => i.id === id);
      if (updated) persistUpload(itemToStored(updated));
      return next;
    });
  }, []);

  const retryAllFailed = useCallback(() => {
    setItems((prev) => {
      const next = prev.map((i) =>
        i.status === "failed"
          ? { ...i, status: "queued" as const, error: null, attempt: 0, progress: 0 }
          : i,
      );
      for (const i of next) {
        if (i.status === "queued") persistUpload(itemToStored(i));
      }
      return next;
    });
  }, []);

  const clearCompleted = useCallback(() => {
    setItems((prev) => {
      const removed = prev.filter((i) => i.status === "success");
      for (const i of removed) deleteUpload(i.id);
      return prev.filter((i) => i.status !== "success");
    });
  }, []);

  const clearAll = useCallback(() => {
    setItems((prev) => {
      // Only purge non-active items; keep uploading slots alive
      const removed = prev.filter((i) => i.status !== "uploading");
      for (const i of removed) deleteUpload(i.id);
      return prev.filter((i) => i.status === "uploading");
    });
    if (itemsRef.current.every((i) => i.status !== "uploading")) {
      clearUploads();
    }
  }, []);

  return { items, add, remove, retry, retryAllFailed, clearCompleted, clearAll, hydrated };
}
