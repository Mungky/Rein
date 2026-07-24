"use client";

/** Palet Komponen — gaya Node-RED Dashboard: daftar komponen ber-preview di
 *  sisi kiri mode Atur Layout. Dua cara memasang:
 *   • SERET kartu ke titik yang diinginkan di kanvas (drop = posisi persis),
 *   • klik tombol "Pasang" (jatuh kaskade seperti biasa).
 *  Komponen data dipasang "kosong" lalu inspector terbuka otomatis untuk
 *  memilih sensornya — persis alur drop-node-lalu-konfigurasi di Node-RED. */

import { useMemo, useRef, useState } from "react";
import {
  Bell,
  ChevronDown,
  Image as ImageIcon,
  Plus,
  Search,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { stageTransform } from "./grid/canvas-stage";
import { channelScreen } from "./screen-box";
import { channelSourceMeta } from "./channel-form";
import { importImageAsDataUri, loadImage } from "./image-import";
import { useScadaStore } from "./store";
import type { CanvasSize, Channel, Panel } from "./types";
import { DEFAULT_CANVAS } from "./types";

/* ── component specs ── */

interface CompSpec {
  key: string;
  label: string;
  desc: string;
  /** Default size in canvas px. */
  w: number;
  h: number;
  /** Open the inspector right after placing (data comps & placeholder image). */
  needsConfig: boolean;
  make: () => Panel;
  preview: React.ReactNode;
}

const pv = "h-14 w-full"; // preview canvas size

function newId() {
  return crypto.randomUUID();
}

const DATA_COMPONENTS: CompSpec[] = [
  {
    key: "gauge-arc",
    label: "Gauge Jarum",
    desc: "Skala min–maks + zona warna",
    w: 380,
    h: 320,
    needsConfig: true,
    make: () => ({
      id: newId(),
      type: "gauge",
      title: "Gauge",
      config: {
        tag_id: null,
        style: "arc",
        min: 0,
        max: 100,
      },
    }),
    // Semua busur WAJIB satu lingkaran: pusat (50, 38), r 28, mulai 150°,
    // sapuan 240° — sama seperti ArcGauge asli. Titik f = (50 + 28cos(150 +
    // 240f), 38 + 28sin(150 + 240f)); zona hijau f 0–0,25 dan merah f 0,75–1.
    preview: (
      <svg viewBox="0 0 100 56" className={pv}>
        <path d="M 25.75 52 A 28 28 0 1 1 74.25 52" fill="none" stroke="var(--rein-border)" strokeWidth={7} strokeLinecap="round" />
        <path d="M 25.75 52 A 28 28 0 0 1 25.75 24" fill="none" stroke="var(--rein-green)" strokeWidth={7} />
        <path d="M 74.25 24 A 28 28 0 0 1 74.25 52" fill="none" stroke="var(--rein-red)" strokeWidth={7} />
        <line x1={50} y1={38} x2={38.24} y2={21.82} stroke="var(--rein-text)" strokeWidth={3} strokeLinecap="round" />
        <circle cx={50} cy={38} r={3} fill="var(--rein-text)" />
      </svg>
    ),
  },
  {
    key: "gauge-donut",
    label: "Gauge Donat",
    desc: "Cincin terisi sebanding nilai",
    w: 340,
    h: 320,
    needsConfig: true,
    make: () => ({
      id: newId(),
      type: "gauge",
      title: "Gauge",
      config: {
        tag_id: null,
        style: "donut",
        min: 0,
        max: 100,
      },
    }),
    preview: (
      <svg viewBox="0 0 100 56" className={pv}>
        <circle cx={50} cy={28} r={22} fill="none" stroke="var(--rein-border)" strokeWidth={7} />
        <circle
          cx={50}
          cy={28}
          r={22}
          fill="none"
          stroke="var(--rein-green)"
          strokeWidth={7}
          strokeLinecap="round"
          strokeDasharray="97 138"
          transform="rotate(-90 50 28)"
        />
        <text x={50} y={32} textAnchor="middle" fontSize={13} fontWeight={700} fill="var(--rein-text)">
          70
        </text>
      </svg>
    ),
  },
  {
    key: "gauge-stat",
    label: "Angka Status",
    desc: "Angka besar + Normal/Waspada/Kritis",
    w: 380,
    h: 260,
    needsConfig: true,
    make: () => ({
      id: newId(),
      type: "gauge",
      title: "Angka",
      config: { tag_id: null, style: "stat" },
    }),
    preview: (
      <svg viewBox="0 0 100 56" className={pv}>
        <text x={50} y={30} textAnchor="middle" fontSize={22} fontWeight={700} fill="var(--rein-text)">
          27,4
        </text>
        <rect x={30} y={38} width={40} height={11} rx={5.5} fill="none" stroke="var(--rein-green)" />
        <text x={50} y={46.5} textAnchor="middle" fontSize={7} fill="var(--rein-green)">
          Normal
        </text>
      </svg>
    ),
  },
  {
    key: "level",
    label: "Level / Tangki",
    desc: "Isi naik-turun mengikuti sensor",
    w: 280,
    h: 380,
    needsConfig: true,
    make: () => ({
      id: newId(),
      type: "level",
      title: "Level",
      config: {
        tag_id: null,
        min: 0,
        max: 100,
      },
    }),
    preview: (
      <svg viewBox="0 0 100 56" className={pv}>
        <rect x={38} y={6} width={24} height={44} rx={5} fill="none" stroke="var(--rein-border)" strokeWidth={2.5} />
        <rect x={40.5} y={26} width={19} height={21.5} rx={3} fill="var(--rnet-chart-1)" opacity={0.85} />
      </svg>
    ),
  },
  {
    key: "led",
    label: "LED Indikator",
    desc: "Lampu on/off dari satu ambang",
    w: 280,
    h: 260,
    needsConfig: true,
    make: () => ({
      id: newId(),
      type: "led",
      title: "LED",
      config: { tag_id: null, threshold: 0, direction: "above" },
    }),
    preview: (
      <svg viewBox="0 0 100 56" className={pv}>
        <circle cx={50} cy={24} r={13} fill="var(--rein-green)" opacity={0.9} />
        <circle cx={50} cy={24} r={17} fill="none" stroke="var(--rein-green)" opacity={0.35} strokeWidth={3} />
        <text x={50} y={50} textAnchor="middle" fontSize={8} fontWeight={700} fill="var(--rein-text)">
          AKTIF
        </text>
      </svg>
    ),
  },
  {
    key: "chart",
    label: "Grafik Tren",
    desc: "1–4 garis riwayat sensor",
    w: 760,
    h: 420,
    needsConfig: true,
    make: () => ({
      id: newId(),
      type: "chart",
      title: "Grafik",
      config: { tag_ids: [], range: "24h", show_minmax: false },
    }),
    preview: (
      <svg viewBox="0 0 100 56" className={pv}>
        {[14, 28, 42].map((y) => (
          <line key={y} x1={8} y1={y} x2={92} y2={y} stroke="var(--rein-border-soft)" />
        ))}
        <polyline
          points="8,40 24,30 40,34 56,18 72,24 92,12"
          fill="none"
          stroke="var(--rnet-chart-1)"
          strokeWidth={2.5}
        />
        <polyline
          points="8,46 24,44 40,38 56,40 72,32 92,34"
          fill="none"
          stroke="var(--rnet-chart-3)"
          strokeWidth={2.5}
        />
      </svg>
    ),
  },
  {
    key: "bar",
    label: "Bar Perbandingan",
    desc: "Bandingkan 2–8 sensor",
    w: 700,
    h: 420,
    needsConfig: true,
    make: () => ({
      id: newId(),
      type: "bar",
      title: "Perbandingan",
      config: { tag_ids: [], range: "24h", metric: "avg" },
    }),
    preview: (
      <svg viewBox="0 0 100 56" className={pv}>
        <rect x={12} y={10} width={56} height={9} rx={2.5} fill="var(--rnet-chart-1)" />
        <rect x={12} y={24} width={42} height={9} rx={2.5} fill="var(--rnet-chart-1)" opacity={0.75} />
        <rect x={12} y={38} width={70} height={9} rx={2.5} fill="var(--rnet-chart-1)" opacity={0.55} />
      </svg>
    ),
  },
  {
    key: "table",
    label: "Tabel Ringkasan",
    desc: "Terkini/min/maks per sensor",
    w: 700,
    h: 420,
    needsConfig: true,
    make: () => ({
      id: newId(),
      type: "table",
      title: "Ringkasan",
      config: { tag_ids: [], range: "24h" },
    }),
    preview: (
      <svg viewBox="0 0 100 56" className={pv}>
        <rect x={10} y={8} width={80} height={9} rx={2} fill="var(--rein-border)" />
        {[22, 33, 44].map((y) => (
          <g key={y}>
            <rect x={10} y={y} width={34} height={6} rx={2} fill="var(--rein-border-soft)" />
            <rect x={56} y={y} width={34} height={6} rx={2} fill="var(--rein-border-soft)" />
          </g>
        ))}
      </svg>
    ),
  },
  {
    key: "alarm",
    label: "Alarm",
    desc: "Status alarm sensor terpantau",
    w: 700,
    h: 420,
    needsConfig: true,
    make: () => ({
      id: newId(),
      type: "alarm",
      title: "Alarm",
      config: { tag_ids: [], range: "24h" },
    }),
    preview: (
      <div className={cn(pv, "flex items-center justify-center gap-2")}>
        <Bell className="size-6 text-amber" />
        <span className="h-2 w-16 rounded bg-border-soft" />
      </div>
    ),
  },
];

const DECOR_COMPONENTS: CompSpec[] = [
  {
    key: "text",
    label: "Teks",
    desc: "Label/judul bebas di kanvas",
    w: 420,
    h: 90,
    needsConfig: true,
    make: () => ({
      id: newId(),
      type: "text",
      title: "",
      config: { content: "Teks baru", size: 36, color: null, align: "center", bold: true },
    }),
    preview: (
      <div className={cn(pv, "flex items-center justify-center")}>
        <span className="text-[22px] font-bold text-text">Aa</span>
      </div>
    ),
  },
  {
    key: "rect",
    label: "Kotak",
    desc: "Latar/garis pembatas area",
    w: 320,
    h: 200,
    needsConfig: false,
    make: () => ({
      id: newId(),
      type: "shape",
      title: "",
      config: { shape: "rect", fill: "#2a78d6", stroke: null, stroke_w: 2, radius: 8 },
    }),
    preview: (
      <div className={cn(pv, "flex items-center justify-center")}>
        <div className="h-10 w-16 rounded-[6px] bg-[var(--rnet-chart-1)] opacity-80" />
      </div>
    ),
  },
  {
    key: "circle",
    label: "Lingkaran",
    desc: "Penanda titik/mesin",
    w: 220,
    h: 220,
    needsConfig: false,
    make: () => ({
      id: newId(),
      type: "shape",
      title: "",
      config: { shape: "circle", fill: "#2a78d6", stroke: null, stroke_w: 2, radius: 8 },
    }),
    preview: (
      <div className={cn(pv, "flex items-center justify-center")}>
        <div className="size-11 rounded-full bg-[var(--rnet-chart-1)] opacity-80" />
      </div>
    ),
  },
  {
    key: "line",
    label: "Garis",
    desc: "Garis pipa/pemisah mendatar",
    w: 640,
    h: 40,
    needsConfig: false,
    make: () => ({
      id: newId(),
      type: "shape",
      title: "",
      config: { shape: "line", fill: null, stroke: "#64748b", stroke_w: 4, radius: 0 },
    }),
    preview: (
      <div className={cn(pv, "flex items-center justify-center")}>
        <div className="h-[3px] w-20 rounded bg-text-light" />
      </div>
    ),
  },
  {
    key: "image",
    label: "Gambar / Logo",
    desc: "Impor PNG/JPG — pemanis HMI",
    w: 400,
    h: 300,
    needsConfig: true,
    make: () => ({
      id: newId(),
      type: "image",
      title: "",
      config: { src: "", fit: "contain", opacity: 1, radius: 0 },
    }),
    preview: (
      <div className={cn(pv, "flex items-center justify-center")}>
        <ImageIcon className="size-8 text-text-light" />
      </div>
    ),
  },
];

/* ── palette ── */

interface DragGhost {
  label: string;
  x: number;
  y: number;
}

export function ComponentPalette({
  stageBoxRef,
  onPlaced,
}: {
  /** The div that wraps CanvasStage — drop target for drag placement. */
  stageBoxRef: React.RefObject<HTMLDivElement | null>;
  /** Called after a panel lands; openInspector = true for data/imported comps. */
  onPlaced: (panelId: string, openInspector: boolean) => void;
}) {
  const store = useScadaStore();
  const canvas: CanvasSize = store.draftCanvas ?? DEFAULT_CANVAS;
  const [query, setQuery] = useState("");
  const [ghost, setGhost] = useState<DragGhost | null>(null);
  const [open, setOpen] = useState<Record<string, boolean>>({
    layar: true,
    data: true,
    dekor: true,
  });
  const imageFileRef = useRef<HTMLInputElement>(null);

  const channels = useMemo(
    () =>
      [...store.channels]
        .filter((c) => c.enabled)
        .sort((a, b) => a.number - b.number),
    [store.channels]
  );

  const q = query.trim().toLowerCase();
  const matches = (s: string) => !q || s.toLowerCase().includes(q);
  const dataComps = DATA_COMPONENTS.filter((c) => matches(`${c.label} ${c.desc}`));
  const decorComps = DECOR_COMPONENTS.filter((c) => matches(`${c.label} ${c.desc}`));
  const chans = channels.filter(
    (c) =>
      !q ||
      String(c.number).includes(q) ||
      c.name.toLowerCase().includes(q) ||
      channelSourceMeta(c, store.streams).label.toLowerCase().includes(q)
  );

  /* placement helpers */

  /** Cascade rect (tombol "Pasang") — komponen baru tidak saling menutupi. */
  function cascadeRect(w: number, h: number) {
    const n = (store.draftPanels ?? []).filter((p) => p.rect).length;
    const off = Math.min(32 * n, Math.max(0, canvas.h - h), Math.max(0, canvas.w - w));
    return {
      x: Math.max(0, Math.min(off, canvas.w - w)),
      y: Math.max(0, Math.min(off, canvas.h - h)),
      w: Math.min(w, canvas.w),
      h: Math.min(h, canvas.h),
    };
  }

  /** Pointer (screen px) → rect centered at that canvas point; null = luar kanvas. */
  function dropRect(clientX: number, clientY: number, w: number, h: number) {
    const box = stageBoxRef.current;
    if (!box) return null;
    const b = box.getBoundingClientRect();
    if (clientX < b.left || clientX > b.right || clientY < b.top || clientY > b.bottom)
      return null;
    const { scale, offX, offY } = stageTransform(b.width, b.height, canvas);
    if (scale <= 0) return null;
    const cx = (clientX - b.left - offX) / scale;
    const cy = (clientY - b.top - offY) / scale;
    const cw = Math.min(w, canvas.w);
    const ch = Math.min(h, canvas.h);
    return {
      x: Math.round(Math.max(0, Math.min(cx - cw / 2, canvas.w - cw))),
      y: Math.round(Math.max(0, Math.min(cy - ch / 2, canvas.h - ch))),
      w: Math.round(cw),
      h: Math.round(ch),
    };
  }

  function place(panel: Panel, rect: NonNullable<Panel["rect"]>, openInspector: boolean) {
    store.addPanel({ ...panel, rect });
    onPlaced(panel.id, openInspector);
    if (!openInspector)
      toast.success("Komponen ditambahkan — geser & atur ukurannya");
  }

  /** Drag kartu: >6 px = seret (ghost mengikuti kursor); lepas di kanvas =
   *  jatuh persis di titik itu; klik biasa = sama dengan tombol Pasang. */
  function startCardDrag(
    e: React.PointerEvent,
    label: string,
    w: number,
    h: number,
    makePanel: () => Panel,
    openInspector: boolean
  ) {
    if (e.button !== 0) return;
    const sx = e.clientX;
    const sy = e.clientY;
    let dragging = false;
    const onMove = (ev: PointerEvent) => {
      if (!dragging && Math.hypot(ev.clientX - sx, ev.clientY - sy) > 6) dragging = true;
      if (dragging) setGhost({ label, x: ev.clientX, y: ev.clientY });
    };
    const onUp = (ev: PointerEvent) => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      setGhost(null);
      const panel = makePanel();
      if (dragging) {
        const rect = dropRect(ev.clientX, ev.clientY, w, h);
        if (rect) place(panel, rect, openInspector);
      } else {
        place(panel, cascadeRect(w, h), openInspector);
      }
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  /* channels — ukuran mengikuti aspek layar channel (aspect-locked) */

  function channelSize(channel: Channel, factor: number) {
    const screen = channelScreen(channel);
    const fit = Math.min(canvas.w / screen.w, canvas.h / screen.h);
    const n = (store.draftPanels ?? []).filter((p) => p.rect).length;
    const scale = n === 0 && factor === 0 ? fit : fit / (factor || 2);
    return { w: Math.round(screen.w * scale), h: Math.round(screen.h * scale) };
  }

  function makeChannelPanel(channel: Channel): Panel {
    return {
      id: newId(),
      type: "channel",
      title: `CH ${channel.number} · ${channel.name}`,
      config: { channel_id: channel.id },
    };
  }

  /* image import langsung (tombol Pasang pada kartu Gambar) */

  async function importAndPlaceImage(file: File | undefined) {
    if (!file) return;
    try {
      const src = await importImageAsDataUri(file);
      const img = await loadImage(src);
      // Rect awal mengikuti aspek gambar, maks 1/3 kanvas
      const maxW = canvas.w / 3;
      const s = Math.min(1, maxW / img.naturalWidth, canvas.h / 3 / img.naturalHeight);
      const panel: Panel = {
        id: newId(),
        type: "image",
        title: "",
        config: { src, fit: "contain", opacity: 1, radius: 0 },
      };
      place(
        panel,
        cascadeRect(
          Math.max(64, Math.round(img.naturalWidth * s)),
          Math.max(64, Math.round(img.naturalHeight * s))
        ),
        false
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Gagal mengimpor gambar");
    } finally {
      if (imageFileRef.current) imageFileRef.current.value = "";
    }
  }

  const sectionProps = (id: string) => ({
    isOpen: open[id] !== false,
    onToggle: () => setOpen((o) => ({ ...o, [id]: o[id] === false })),
  });

  return (
    <div className="flex h-full w-[280px] shrink-0 flex-col border-r border-border-soft bg-bg">
      {/* Search */}
      <div className="relative border-b border-border-soft p-2.5">
        <Search className="pointer-events-none absolute left-5 top-1/2 size-3.5 -translate-y-1/2 text-text-light" />
        <input
          className="field-input pl-8"
          placeholder="Cari komponen / channel…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2.5 py-2">
        {/* Layar (channels) */}
        <Section label="Layar (Channel)" count={chans.length} {...sectionProps("layar")}>
          {channels.length === 0 ? (
            <p className="rounded-[var(--r)] border border-border-soft bg-bg-sidebar px-2.5 py-2 text-[11.5px] text-text-muted">
              Belum ada channel — buat di tab{" "}
              <span className="font-semibold">Channel</span> dulu.
            </p>
          ) : (
            chans.map((c) => {
              const source = channelSourceMeta(c, store.streams);
              const KindIcon = source.icon;
              const size = channelSize(c, 2);
              return (
                <div
                  key={c.id}
                  className="group flex cursor-grab items-center gap-2 rounded-[var(--r)] border border-border-soft bg-bg px-2 py-1.5 select-none hover:border-primary/50 hover:bg-primary/5 active:cursor-grabbing"
                  onPointerDown={(e) =>
                    startCardDrag(
                      e,
                      `CH ${c.number} · ${c.name}`,
                      size.w,
                      size.h,
                      () => makeChannelPanel(c),
                      false
                    )
                  }
                >
                  <span className="flex h-6 min-w-10 shrink-0 items-center justify-center rounded-[var(--r-sm)] bg-primary/10 px-1 text-[11px] font-bold tabular-nums text-primary">
                    CH {c.number}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-[12px] font-semibold text-text">
                    {c.name}
                  </span>
                  <span title={source.label} className="flex shrink-0 items-center">
                    <KindIcon className="size-3.5 text-text-light" />
                  </span>
                </div>
              );
            })
          )}
        </Section>

        {/* Data sensor */}
        <Section label="Data Sensor" count={dataComps.length} {...sectionProps("data")}>
          {dataComps.map((c) => (
            <ComponentCard
              key={c.key}
              spec={c}
              onPointerDown={(e) =>
                startCardDrag(e, c.label, c.w, c.h, c.make, c.needsConfig)
              }
              onPlaceClick={() => place(c.make(), cascadeRect(c.w, c.h), c.needsConfig)}
            />
          ))}
        </Section>

        {/* Dekorasi */}
        <Section label="Dekorasi" count={decorComps.length} {...sectionProps("dekor")}>
          {decorComps.map((c) => (
            <ComponentCard
              key={c.key}
              spec={c}
              onPointerDown={(e) =>
                startCardDrag(e, c.label, c.w, c.h, c.make, c.needsConfig)
              }
              onPlaceClick={() => {
                // Kartu Gambar: tombol Pasang langsung buka pemilih file —
                // "impor langsung"; seret tetap memasang placeholder + inspector.
                if (c.key === "image") imageFileRef.current?.click();
                else place(c.make(), cascadeRect(c.w, c.h), c.needsConfig);
              }}
            />
          ))}
        </Section>
      </div>

      <p className="border-t border-border-soft px-3 py-2 text-[10.5px] leading-snug text-text-light">
        Seret kartu ke kanvas, atau klik <span className="font-semibold">+</span>.
        Klik dua kali komponen terpasang untuk mengaturnya.
      </p>

      {/* Hidden input untuk impor gambar langsung */}
      <input
        ref={imageFileRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        className="hidden"
        onChange={(e) => void importAndPlaceImage(e.target.files?.[0])}
      />

      {/* Drag ghost */}
      {ghost && (
        <div
          className="pointer-events-none fixed z-[100] -translate-x-1/2 -translate-y-1/2 rounded-[var(--r)] border border-primary bg-primary/10 px-3 py-1.5 text-[12px] font-semibold text-primary shadow-[var(--shadow-lg)] backdrop-blur-sm"
          style={{ left: ghost.x, top: ghost.y }}
        >
          {ghost.label}
        </div>
      )}
    </div>
  );
}

function Section({
  label,
  count,
  isOpen,
  onToggle,
  children,
}: {
  label: string;
  count: number;
  isOpen: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <div>
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full cursor-pointer items-center gap-1.5 px-1 py-1.5 text-[11px] font-bold uppercase tracking-wide text-text-muted hover:text-text"
      >
        <ChevronDown
          className={cn("size-3.5 transition-transform", !isOpen && "-rotate-90")}
        />
        {label}
        <span className="font-normal text-text-light">({count})</span>
      </button>
      {isOpen && <div className="flex flex-col gap-1.5 pb-2">{children}</div>}
    </div>
  );
}

function ComponentCard({
  spec,
  onPointerDown,
  onPlaceClick,
}: {
  spec: CompSpec;
  onPointerDown: (e: React.PointerEvent) => void;
  onPlaceClick: () => void;
}) {
  return (
    <div
      className="group cursor-grab select-none rounded-[var(--r)] border border-border-soft bg-bg p-2 hover:border-primary/50 hover:bg-primary/5 active:cursor-grabbing"
      onPointerDown={onPointerDown}
    >
      <div className="pointer-events-none rounded-[var(--r-sm)] bg-bg-sidebar">
        {spec.preview}
      </div>
      <div className="mt-1.5 flex items-center gap-1.5">
        <div className="min-w-0 flex-1">
          <p className="truncate text-[12px] font-semibold text-text">{spec.label}</p>
          <p className="truncate text-[10.5px] text-text-light">{spec.desc}</p>
        </div>
        <button
          type="button"
          title={`Pasang ${spec.label}`}
          className="flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-full bg-primary/10 text-primary opacity-70 hover:bg-primary hover:text-white group-hover:opacity-100"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={onPlaceClick}
        >
          <Plus className="size-3.5" />
        </button>
      </div>
    </div>
  );
}
