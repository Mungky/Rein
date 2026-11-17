/**
 * Validasi tipe file dari magic bytes (PRD §7), bukan hanya ekstensi.
 * Ekstensi menentukan tipe yang diklaim; isi file harus cocok dengan keluarga tipe itu.
 */
type Family = 'jpeg' | 'png' | 'webp' | 'heic' | 'pdf' | 'zip' | 'ole' | 'dwg' | 'text';

const BY_EXT: Record<string, { mime: string; family: Family }> = {
  jpg: { mime: 'image/jpeg', family: 'jpeg' },
  jpeg: { mime: 'image/jpeg', family: 'jpeg' },
  png: { mime: 'image/png', family: 'png' },
  webp: { mime: 'image/webp', family: 'webp' },
  heic: { mime: 'image/heic', family: 'heic' },
  heif: { mime: 'image/heif', family: 'heic' },
  pdf: { mime: 'application/pdf', family: 'pdf' },
  dwg: { mime: 'image/vnd.dwg', family: 'dwg' },
  dxf: { mime: 'image/vnd.dxf', family: 'text' },
  step: { mime: 'model/step', family: 'text' },
  stp: { mime: 'model/step', family: 'text' },
  xlsx: {
    mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    family: 'zip',
  },
  docx: {
    mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    family: 'zip',
  },
  xls: { mime: 'application/vnd.ms-excel', family: 'ole' },
  doc: { mime: 'application/msword', family: 'ole' },
  csv: { mime: 'text/csv', family: 'text' },
  txt: { mime: 'text/plain', family: 'text' },
  zip: { mime: 'application/zip', family: 'zip' },
};

export const ALLOWED_EXTENSIONS = Object.keys(BY_EXT);
/** Jumlah byte awal yang dibutuhkan untuk deteksi. */
export const SNIFF_BYTES = 4096;

const startsWith = (b: Uint8Array, sig: number[], at = 0) => sig.every((v, i) => b[at + i] === v);
const ascii = (b: Uint8Array, from: number, to: number) =>
  String.fromCharCode(...b.subarray(from, Math.min(to, b.length)));

function family(b: Uint8Array): Family | null {
  if (startsWith(b, [0xff, 0xd8, 0xff])) return 'jpeg';
  if (startsWith(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'png';
  if (ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 12) === 'WEBP') return 'webp';
  if (ascii(b, 4, 8) === 'ftyp' && /^(heic|heix|hevc|hevx|mif1|msf1|heif)$/.test(ascii(b, 8, 12)))
    return 'heic';
  if (ascii(b, 0, 5) === '%PDF-') return 'pdf';
  if (startsWith(b, [0x50, 0x4b, 0x03, 0x04]) || startsWith(b, [0x50, 0x4b, 0x05, 0x06]))
    return 'zip';
  if (startsWith(b, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])) return 'ole';
  if (/^AC10\d\d/.test(ascii(b, 0, 6))) return 'dwg';
  if (isText(b)) return 'text';
  return null;
}

/** Teks: tanpa byte NUL dan UTF-8 valid (potongan terakhir boleh terpotong). */
function isText(b: Uint8Array): boolean {
  if (b.includes(0)) return false;
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(b.subarray(0, Math.max(0, b.length - 4)));
    return true;
  } catch {
    return false;
  }
}

export function extensionOf(fileName: string): string {
  const m = /\.([a-z0-9]+)$/i.exec(fileName.trim());
  return m ? m[1]!.toLowerCase() : '';
}

/** Kembalikan MIME resmi jika isi cocok dengan ekstensi yang diizinkan, selain itu null. */
export function sniffAllowed(fileName: string, head: Uint8Array): { mime: string } | null {
  const claimed = BY_EXT[extensionOf(fileName)];
  if (!claimed || head.length === 0) return null;
  const actual = family(head);
  if (actual !== claimed.family) return null;
  if (
    claimed.family === 'text' &&
    extensionOf(fileName) === 'step' &&
    !/ISO-10303-21/.test(ascii(head, 0, 64))
  )
    return null;
  return { mime: claimed.mime };
}

export const isImageMime = (mime: string) => /^image\/(jpeg|png|webp|heic|heif)$/.test(mime);
