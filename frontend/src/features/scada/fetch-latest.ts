/** Ambil nilai terakhir yang diketahui untuk BERAPA PUN jumlah tag.
 *
 *  Endpoint /latest membatasi 100 id per permintaan. Dulu batas itu ditangani
 *  dengan `.slice(0, 100)` — dan itu bukan "membatasi", itu diam-diam MEMBUANG
 *  sensor ke-101 dan seterusnya. Di plant 300 sensor, dua pertiga tabel
 *  menampilkan "—" sampai kebetulan ada kejadian Realtime datang. Memotongnya
 *  jadi beberapa permintaan menanyakan hal yang sama dalam beberapa tarikan
 *  napas, bukan melupakan sebagian besarnya.
 *
 *  SATU salinan. Sebelumnya ada dua yang isinya sama persis — di
 *  `store.refreshData` (tombol refresh manual) dan di
 *  `analysis/use-live-samples.seedLatest` (semai + pengawas) — lengkap dengan
 *  komentar "jangan pakai .slice(0,100)" yang sama di keduanya. Dua salinan
 *  dari perbaikan yang sama adalah dua tempat yang bisa diam-diam kembali
 *  membuang sensor. */

import { scadaApi } from "@/lib/api/scada";

/** Batas id per permintaan yang diberlakukan endpoint /latest. */
const LATEST_CAP = 100;

/** Panggil `apply` untuk setiap nilai terakhir yang berhasil diambil.
 *
 *  Kegagalan per-potongan ditelan: ini jalur "percepatan", bukan jalur yang
 *  menentukan apakah halaman bisa tampil. Potongan yang gagal cukup ditinggal,
 *  potongan lain tetap sampai.
 */
export async function fetchLatestInChunks(
  ids: string[],
  apply: (tagId: string, v: { value: number; ts: string }) => void
): Promise<void> {
  if (ids.length === 0) return;
  const chunks: string[][] = [];
  for (let i = 0; i < ids.length; i += LATEST_CAP) {
    chunks.push(ids.slice(i, i + LATEST_CAP));
  }
  const pages = await Promise.all(
    chunks.map((c) => scadaApi.getLatest(c).catch(() => null))
  );
  for (const res of pages) {
    for (const item of res?.items ?? []) {
      apply(item.tag_id, { value: item.value, ts: item.ts });
    }
  }
}
