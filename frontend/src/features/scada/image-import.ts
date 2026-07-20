"use client";

/** Import gambar/logo untuk panel Image: file dari disk dikecilkan di browser
 *  (maks 1024 px sisi terpanjang) lalu di-encode jadi data URI supaya ikut
 *  tersimpan di layout JSON — tanpa server upload, tanpa file storage.
 *  PNG dipertahankan (logo butuh transparansi); selainnya jadi JPEG. */

const MAX_DIM = 1024;
// Selaras dengan batas backend (ImagePanelConfig.src max_length 800 rb chars)
const MAX_DATA_URI_CHARS = 800_000;

export async function importImageAsDataUri(file: File): Promise<string> {
  if (!/^image\/(png|jpe?g|webp|gif)$/i.test(file.type)) {
    throw new Error("Format tidak didukung — pakai PNG, JPG, WebP, atau GIF.");
  }
  const url = URL.createObjectURL(file);
  try {
    const img = await loadImage(url);
    const scale = Math.min(1, MAX_DIM / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.max(1, Math.round(img.naturalWidth * scale));
    const h = Math.max(1, Math.round(img.naturalHeight * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas tidak tersedia di browser ini.");
    ctx.drawImage(img, 0, 0, w, h);

    // PNG menjaga transparansi logo; foto (jpeg/webp/gif) dikompres ke JPEG.
    const isPng = /png$/i.test(file.type);
    let out = isPng
      ? canvas.toDataURL("image/png")
      : canvas.toDataURL("image/jpeg", 0.85);
    if (out.length > MAX_DATA_URI_CHARS && isPng) {
      // Logo PNG raksasa: coba versi JPEG sebagai jalan keluar terakhir
      out = canvas.toDataURL("image/jpeg", 0.85);
    }
    if (out.length > MAX_DATA_URI_CHARS) {
      throw new Error(
        "Gambar masih terlalu besar setelah dikompres (maks ±600 KB). Kecilkan dulu gambarnya."
      );
    }
    return out;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Ukuran natural (px) sebuah data URI/URL gambar — untuk rect awal panel. */
export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Gagal membaca gambar."));
    img.src = src;
  });
}
