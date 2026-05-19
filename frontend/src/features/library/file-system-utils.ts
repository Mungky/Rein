/**
 * Recursive folder/file drop helpers using the FileSystem Entry API.
 * All structure is flattened — files end up in the currently-selected
 * library folder regardless of where they sat inside the dropped folder.
 */

interface LibFSEntry {
  isFile: boolean;
  isDirectory: boolean;
  name: string;
  fullPath: string;
}

interface LibFSFileEntry extends LibFSEntry {
  isFile: true;
  isDirectory: false;
  file: (cb: (file: File) => void, err?: (e: unknown) => void) => void;
}

interface LibFSDirectoryEntry extends LibFSEntry {
  isFile: false;
  isDirectory: true;
  createReader: () => LibFSDirectoryReader;
}

interface LibFSDirectoryReader {
  readEntries: (cb: (entries: LibFSEntry[]) => void, err?: (e: unknown) => void) => void;
}

/**
 * Walk a single directory recursively and push every File found into `acc`.
 * `readEntries` may return entries in batches — keep calling until empty.
 */
async function walkEntry(entry: LibFSEntry, acc: File[]): Promise<void> {
  if (entry.isFile) {
    const fileEntry = entry as LibFSFileEntry;
    return new Promise<void>((resolve) => {
      fileEntry.file(
        (file) => {
          acc.push(file);
          resolve();
        },
        () => resolve(),
      );
    });
  }

  if (entry.isDirectory) {
    const dirEntry = entry as LibFSDirectoryEntry;
    const reader = dirEntry.createReader();
    while (true) {
      const batch: LibFSEntry[] = await new Promise((resolve) => {
        reader.readEntries(resolve, () => resolve([]));
      });
      if (batch.length === 0) return;
      for (const child of batch) {
        await walkEntry(child, acc);
      }
    }
  }
}

/**
 * Extract all files from a drop event, including from dropped folders.
 *
 * **Critical:** DataTransfer items are invalidated as soon as the drop handler
 * returns — Promise.all-style async iteration loses them. So we do two phases:
 *
 *   1. Synchronous: snapshot every `webkitGetAsEntry()` result + any direct
 *      `getAsFile()` blobs. Must complete before any `await`.
 *   2. Async: walk the snapshotted entries recursively.
 */
export async function extractFilesFromDrop(event: DragEvent): Promise<File[]> {
  const dt = event.dataTransfer;
  if (!dt) return [];

  // ── Phase 1: SYNCHRONOUS snapshot ──────────────────────────────────────────
  const entries: LibFSEntry[] = [];
  const directFiles: File[] = [];
  const items = Array.from(dt.items);
  let hasEntryApi = false;

  for (const item of items) {
    const getEntry = (item as unknown as { webkitGetAsEntry?: () => LibFSEntry | null }).webkitGetAsEntry;
    if (typeof getEntry === "function") {
      hasEntryApi = true;
      const entry = getEntry();
      if (entry) {
        entries.push(entry);
        continue;
      }
    }
    if (item.kind === "file") {
      const f = item.getAsFile();
      if (f) directFiles.push(f);
    }
  }

  // Fallback: no Entry API at all → use plain dataTransfer.files
  if (!hasEntryApi && directFiles.length === 0) {
    return Array.from(dt.files);
  }

  // ── Phase 2: ASYNC walk ────────────────────────────────────────────────────
  const result: File[] = [...directFiles];
  for (const entry of entries) {
    await walkEntry(entry, result);
  }
  return result;
}
