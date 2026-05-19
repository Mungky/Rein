/**
 * IndexedDB persistence for the upload queue.
 *
 * Why IDB and not localStorage: File blobs can't be serialized to JSON,
 * but IDB natively stores Blob/File objects. This lets the upload queue
 * survive page refreshes, tab closes, and short network blips.
 *
 * Storage layout: one object store "uploads" keyed by upload item id.
 * Each row holds the File blob plus all metadata needed to resume.
 */

import type { UploadFormValues } from "./types";

const DB_NAME = "rein-library";
const DB_VERSION = 1;
const STORE = "uploads";

export type UploadStatus = "queued" | "uploading" | "success" | "failed";

export interface StoredUpload {
  id: string;
  fileBlob: Blob;
  fileName: string;
  fileSize: number;
  fileType: string;
  fileLastModified: number;
  form: UploadFormValues;
  status: UploadStatus;
  attempt: number;
  error: string | null;
  addedAt: number;
}

let _dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined") {
    return Promise.reject(new Error("IndexedDB not available"));
  }
  if (_dbPromise) return _dbPromise;
  _dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return _dbPromise;
}

async function tx<T>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T> | void): Promise<T | undefined> {
  try {
    const db = await openDb();
    return await new Promise<T | undefined>((resolve, reject) => {
      const t = db.transaction(STORE, mode);
      const store = t.objectStore(STORE);
      let result: T | undefined;
      const req = action(store);
      if (req) req.onsuccess = () => { result = req.result; };
      t.oncomplete = () => resolve(result);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
    });
  } catch {
    return undefined;
  }
}

export async function persistUpload(item: StoredUpload): Promise<void> {
  await tx("readwrite", (s) => s.put(item));
}

export async function deleteUpload(id: string): Promise<void> {
  await tx("readwrite", (s) => s.delete(id));
}

export async function clearUploads(): Promise<void> {
  await tx("readwrite", (s) => s.clear());
}

export async function loadAllUploads(): Promise<StoredUpload[]> {
  const result = await tx<StoredUpload[]>("readonly", (s) => s.getAll());
  return result ?? [];
}

/** Hydrate a stored row back into a real File object usable for upload. */
export function storedToFile(row: StoredUpload): File {
  return new File([row.fileBlob], row.fileName, {
    type: row.fileType,
    lastModified: row.fileLastModified,
  });
}
