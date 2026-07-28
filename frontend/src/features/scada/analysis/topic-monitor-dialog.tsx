"use client";

/** "Pemantau Topik" — apa yang SEDANG dikirim tiap topik MQTT.
 *
 *  Mengisi sensor gabungan berarti mengetik nama field yang harus sama PERSIS
 *  dengan nama variabel di script gateway. Sebelum ini, satu-satunya cara
 *  mengetahuinya adalah membuka Node-RED di PC lapangan lewat remote desktop,
 *  menyalakan kotak debug, dan membaca sidebar-nya. Salah ketik sedikit →
 *  sensornya kosong, tanpa pesan error di mana pun.
 *
 *  Halaman ini jembatan yang menjawabnya: untuk tiap topik yang dilanggan,
 *  paket TERAKHIR yang masuk, sudah diurai jadi nama → nilai, plus penanda
 *  sensor mana yang sudah memakainya. Jadi sekaligus daftar periksa: mana yang
 *  sudah dipasang, mana yang masih menganggur.
 *
 *  Bukan log berjalan — "topik ini mengirim apa" itu pertanyaan tentang
 *  SEKARANG, dan menyimpan tiap pesan di 300 sensor berarti gigabyte per hari
 *  untuk jawaban yang sama. Satu baris per (topik, gateway), ditimpa terus. */

import { useCallback, useEffect, useState } from "react";
import { Check, Copy, RadioTower, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Drawer } from "@/components/ui/drawer";
import { scadaApi } from "@/lib/api/scada";
import { usePanelRefresh } from "../panels/use-panel-refresh";
import { cn } from "@/lib/utils";

interface Probe {
  site_id: string;
  site_name: string;
  topic: string;
  gateway: string;
  bundled: boolean;
  fields: { name: string; value: number; used_by: string[] }[];
  seen_at: string;
}

/** Berapa lama sejak paket terakhir, dalam bahasa manusia. Ditandai basi lewat
 *  60 detik: semua level sampling di R-Net ≤ 60 detik, jadi topik yang diam
 *  lebih lama dari itu memang patut dicurigai. */
function usia(seenAt: string, nowMs: number): { teks: string; basi: boolean } {
  const d = Math.max(0, Math.round((nowMs - new Date(seenAt).getTime()) / 1000));
  const basi = d > 60;
  if (d < 60) return { teks: `${d} dtk lalu`, basi };
  if (d < 3600) return { teks: `${Math.floor(d / 60)} mnt lalu`, basi };
  return { teks: `${Math.floor(d / 3600)} jam lalu`, basi };
}

const angka = (v: number) =>
  Number.isInteger(v) ? String(v) : v.toFixed(Math.min(4, 6)).replace(/0+$/, "");

export function TopicMonitorDialog({ onClose }: { onClose: () => void }) {
  const [items, setItems] = useState<Probe[] | null>(null);
  const [buka, setBuka] = useState<Set<string>>(new Set());
  const [disalin, setDisalin] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState<number | null>(null);

  // Jam dinding di STATE, tidak pernah Date.now() saat render (aturan kemurnian).
  // Tick pertama lewat setTimeout(0), bukan setState langsung di badan efek —
  // sama seperti tabel Analisis; satu frame pertama merender "—" lalu terkoreksi.
  useEffect(() => {
    const first = setTimeout(() => setNowMs(Date.now()), 0);
    const t = setInterval(() => setNowMs(Date.now()), 1000);
    return () => {
      clearTimeout(first);
      clearInterval(t);
    };
  }, []);

  const muat = useCallback(async () => {
    try {
      const res = await scadaApi.listTopicProbes();
      setItems(res.items);
      // Buka sendiri kalau topiknya sedikit — kalau cuma ada 3, tidak ada
      // gunanya menyuruh orang mengklik 3 kali.
      setBuka((prev) =>
        prev.size === 0 && res.items.length <= 4
          ? new Set(res.items.map((p) => p.topic + "|" + p.gateway))
          : prev
      );
    } catch {
      setItems([]);
    }
  }, []);

  usePanelRefresh(muat);

  /** Yang disalin adalah nama LENGKAP dengan gateway-nya — `lombok1.waterlevel1`,
   *  bukan `waterlevel1`.
   *
   *  Bentuk lengkap benar di KEDUA bentuk topik, jadi tidak ada pilihan yang
   *  perlu ditebak orang yang menyalin: kalau topiknya sudah satu per gateway,
   *  jembatan mengupas awalannya karena cocok dengan gateway paket itu; kalau
   *  satu topik memuat seluruh plant, awalan itulah yang memisahkan Line 1 dari
   *  Line 2. Menyalin bentuk polos hanya benar di salah satunya, dan salahnya
   *  tidak bergejala — sensornya diam-diam membaca dua alat bergantian.
   *
   *  Paket tanpa kolom `gateway` tidak punya awalan untuk ditambahkan, jadi
   *  disalin apa adanya. */
  async function salin(teks: string) {
    try {
      await navigator.clipboard.writeText(teks);
      setDisalin(teks);
      setTimeout(() => setDisalin((c) => (c === teks ? null : c)), 1500);
    } catch {
      toast.error("Gagal menyalin");
    }
  }

  return (
    <Drawer
      title="Pemantau Topik"
      subtitle="Isi terakhir dari tiap topik MQTT — sumber nama untuk kolom Perangkat"
      icon={<RadioTower className="size-5" />}
      onClose={onClose}
      footer={
        <>
          <span className="mr-auto text-[11.5px] text-text-muted">
            {items === null
              ? "Memuat…"
              : `${items.length} topik · diperbarui otomatis tiap 60 dtk`}
          </span>
          <button
            type="button"
            onClick={() => void muat()}
            className="btn btn-ghost btn-sm gap-1.5"
          >
            <RefreshCw className="size-3.5" />
            Muat ulang
          </button>
          <button type="button" onClick={onClose} className="btn btn-primary btn-sm">
            Tutup
          </button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        {items !== null && items.length === 0 && (
          <div className="rounded-[var(--r-lg)] border border-border-soft bg-bg-sidebar px-3 py-3 text-[12px] text-text-muted">
            <p className="font-semibold text-text">Belum ada topik terpantau.</p>
            <p className="mt-1.5">
              Jembatan hanya berlangganan topik yang sudah dipakai minimal satu
              sensor. Cara memakainya: buat sensor, isi{" "}
              <span className="font-semibold">Topik</span>
              dikosongkan dulu), tunggu ~30 detik sampai jembatan membaca ulang
              konfigurasinya — nama-nama field-nya akan muncul di sini.
            </p>
          </div>
        )}

        {items?.map((p) => {
          const key = p.topic + "|" + p.gateway;
          const terbuka = buka.has(key);
          const u = nowMs === null ? null : usia(p.seen_at, nowMs);
          return (
            <div
              key={key}
              className="overflow-hidden rounded-[var(--r-lg)] border border-border-soft"
            >
              <button
                onClick={() =>
                  setBuka((prev) => {
                    const next = new Set(prev);
                    if (next.has(key)) next.delete(key);
                    else next.add(key);
                    return next;
                  })
                }
                className="flex w-full cursor-pointer items-center gap-2 bg-bg-sidebar px-3 py-2 text-left hover:bg-bg-hover"
              >
                <span className="min-w-0 flex-1 truncate font-mono text-[11.5px] text-text">
                  {p.topic}
                </span>
                {p.gateway && (
                  <span className="shrink-0 rounded-[var(--r-sm)] bg-primary/10 px-1.5 py-0.5 font-mono text-[10.5px] font-semibold text-primary">
                    {p.gateway}
                  </span>
                )}
                <span className="shrink-0 text-[10.5px] text-text-light">
                  {p.bundled ? `${p.fields.length} nilai` : "satu nilai"}
                </span>
                <span
                  className={cn(
                    "shrink-0 text-[10.5px] tabular-nums",
                    u?.basi ? "font-semibold text-amber" : "text-text-light"
                  )}
                >
                  {u?.teks ?? "—"}
                </span>
              </button>

              {terbuka && (
                <table className="w-full text-[11.5px]">
                  <tbody>
                    {p.fields.map((f) => {
                      // Persis teks yang tersalin — supaya yang dilihat sama
                      // dengan yang ditempel, tanpa kejutan.
                      const penuh = p.gateway ? `${p.gateway}.${f.name}` : f.name;
                      return (
                      <tr key={f.name} className="border-t border-border-soft">
                        <td className="w-8 py-1 pl-3">
                          {/* Menyalin NAMANYA, bukan nilainya — itu yang
                              ditempel ke kolom Perangkat. */}
                          <button
                            onClick={() => void salin(penuh)}
                            className="cursor-pointer p-0.5 text-text-light hover:text-text"
                            title={`Salin "${penuh}" — tempel ke kolom Perangkat`}
                          >
                            {disalin === penuh ? (
                              <Check className="size-3.5 text-green" />
                            ) : (
                              <Copy className="size-3.5" />
                            )}
                          </button>
                        </td>
                        <td className="py-1 pr-2 font-mono text-text">
                          {f.name ? (
                            <>
                              {p.gateway && (
                                <span className="text-text-light">{p.gateway}.</span>
                              )}
                              {f.name}
                            </>
                          ) : (
                            <span className="text-text-light">(nilai polos)</span>
                          )}
                        </td>
                        <td className="py-1 pr-3 text-right font-mono tabular-nums text-text-muted">
                          {angka(f.value)}
                        </td>
                        <td className="w-1/2 py-1 pr-3 text-[11px]">
                          {f.used_by.length > 0 ? (
                            <span className="text-text-muted">
                              <span className="text-green">✓</span>{" "}
                              {f.used_by.join(", ")}
                            </span>
                          ) : (
                            <span className="text-text-light">belum dipakai</span>
                          )}
                        </td>
                      </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          );
        })}

        {items !== null && items.some((p) => p.gateway) && (
          <p className="rounded-[var(--r)] border border-border-soft bg-bg-sidebar px-3 py-2.5 text-[11px] text-text-muted">
            Tombol salin sudah menyertakan nama gateway-nya, jadi yang tertempel
            di kolom{" "}
            <span className="font-semibold text-text">Perangkat</span> langsung
            berbentuk{" "}
            <span className="font-mono text-text">lombok1.waterlevel1</span>.
            Bentuk itu benar untuk kedua macam topik, jadi tidak ada yang perlu
            ditebak — dan kalau satu topik memuat beberapa alat, awalan itulah
            yang mencegah sensornya tertukar.
          </p>
        )}
      </div>
    </Drawer>
  );
}
