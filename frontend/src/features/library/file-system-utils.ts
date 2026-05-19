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
 * Falls back to `event.dataTransfer.files` if the FileSystem API is unavailable.
 */
export async function extractFilesFromDrop(event: DragEvent): Promise<File[]> {
  const dt = event.dataTransfer;
  if (!dt) return [];

  const items = Array.from(dt.items);
  const hasEntryApi = items.some((it) => typeof (it as unknown as { webkitGetAsEntry?: unknown }).webkitGetAsEntry === "function");

  if (!hasEntryApi) {
    return Array.from(dt.files);
  }

  const result: File[] = [];
  await Promise.all(
    items.map(async (item) => {
      const getEntry = (item as unknown as { webkitGetAsEntry?: () => LibFSEntry | null }).webkitGetAsEntry;
      const entry = getEntry?.();
      if (entry) {
        await walkEntry(entry, result);
      } else if (item.kind === "file") {
        const f = item.getAsFile();
        if (f) result.push(f);
      }
    }),
  );
  return result;
}
