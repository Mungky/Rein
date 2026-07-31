/** Menempel titik live ke deret historis TANPA mencampur dua resolusi.
 *
 *  MASALAH YANG DIPERBAIKI
 *      Grafik di tab Data dirakit dari dua sumber: deret historis yang sudah
 *      di-bucket server (mis. rata-rata 48 detik untuk jendela 24 jam), lalu
 *      titik live sesi ini yang ditempel di ujung kanan supaya kurvanya
 *      bergerak di antara pengambilan data tiap 60 detik.
 *
 *      Versi lama menempelkannya APA ADANYA. Titik live datang secepat sensor
 *      mengirim — bisa tiap detik — jadi satu garis membawa dua resolusi
 *      sekaligus: mulus di 23 jam pertama, lalu tiba-tiba padat berduri di
 *      beberapa menit terakhir. Sambungannya terlihat jelas, dan lebih buruk
 *      lagi: bagian berduri itu TERBACA seperti sensornya baru saja jadi tidak
 *      stabil, padahal yang berubah cuma cara menggambarnya.
 *
 *      Paling parah di sparkline mini, yang jendelanya 24 jam dalam kotak
 *      setinggi 28 piksel: bucket 12 menit di kiri, nilai per detik di kanan.
 *
 *  CARANYA
 *      Ekornya di-bucket dulu ke lebar yang SAMA dengan deret historisnya,
 *      lebarnya dibaca dari deret itu sendiri (jarak terkecil antar titik) —
 *      bukan dihitung ulang dari rentang/jatah titik, supaya rumusnya tidak
 *      perlu diduplikasi dari server dan tidak bisa lambat laun menyimpang.
 *
 *  KONSEKUENSI YANG PERLU DISADARI
 *      Ujung kurva sekarang maju satu langkah per BUCKET, bukan per sampel.
 *      Di rentang 1 jam (bucket 6 detik) itu tetap terasa mengalir; di 24 jam
 *      (bucket 48 detik) ia bergerak sekali tiap ~48 detik, sementara data
 *      historisnya sendiri diambil ulang tiap 60 detik.
 *
 *      Itu pertukaran yang disengaja. Alternatifnya — menampilkan tiap sampel
 *      di ujung — berarti bagian terakhir grafik digambar dengan aturan yang
 *      berbeda dari sisanya, dan grafik yang berbohong soal resolusinya lebih
 *      buruk daripada grafik yang bergeraknya sedikit lebih kasar. */

import type { RecentSample } from "../types";

/** Lebar bucket sebuah deret historis, dalam milidetik.
 *
 *  Diambil dari jarak TERKECIL antar titik berurutan, bukan dari yang pertama:
 *  server hanya mengirim bucket yang ada isinya, jadi sensor yang sempat diam
 *  meninggalkan lubang, dan jarak di sekitar lubang itu kelipatan dari lebar
 *  sebenarnya. Yang terkecil adalah yang benar. */
export function bucketMsOf(base: { ts: string }[]): number | null {
  if (base.length < 2) return null;
  let min = Infinity;
  for (let i = 1; i < base.length; i++) {
    const d = new Date(base[i].ts).getTime() - new Date(base[i - 1].ts).getTime();
    if (d > 0 && d < min) min = d;
  }
  return Number.isFinite(min) ? min : null;
}

/** Deret historis + ekor live, satu resolusi. Keduanya urut menaik. */
export function withLiveTail(
  base: RecentSample[],
  live: RecentSample[]
): RecentSample[] {
  if (base.length === 0) return live;

  const lastT = new Date(base[base.length - 1].ts).getTime();
  const tail = live.filter((s) => new Date(s.ts).getTime() > lastT);
  if (tail.length === 0) return base;

  const bucketMs = bucketMsOf(base);
  // Tanpa lebar yang bisa dipercaya (deret terlalu pendek), atau kalau ekornya
  // memang sudah lebih renggang dari bucket-nya, tempel apa adanya — mem-bucket
  // di situ hanya menghapus titik tanpa memperbaiki apa pun.
  if (bucketMs === null || bucketMs <= 1000) return base.concat(tail);

  const sums = new Map<number, { total: number; n: number }>();
  for (const s of tail) {
    const t = new Date(s.ts).getTime();
    const slot = Math.floor(t / bucketMs) * bucketMs;
    const acc = sums.get(slot);
    if (acc) {
      acc.total += s.value;
      acc.n += 1;
    } else {
      sums.set(slot, { total: s.value, n: 1 });
    }
  }

  const bucketed: RecentSample[] = [...sums.entries()]
    .sort((a, b) => a[0] - b[0])
    // Bucket yang tumpang tindih dengan titik historis terakhir dibuang: server
    // sudah memberi versinya, dan menimpanya dengan rata-rata sebagian dari
    // sesi ini akan membuat titik itu melompat setiap kali halaman dibuka.
    .filter(([slot]) => slot > lastT)
    .map(([slot, { total, n }]) => ({
      ts: new Date(slot).toISOString(),
      value: total / n,
    }));

  return bucketed.length ? base.concat(bucketed) : base;
}
