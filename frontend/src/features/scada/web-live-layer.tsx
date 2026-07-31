"use client";

/** Keep-alive web embeds — THE fix for V-Net views duplicating on reload.
 *
 *  Iframes are never unmounted when you flip pages: they live in one
 *  persistent layer (WebLiveLayer) keyed by channel id, and panels just mount
 *  a WebSlot placeholder. Every frame the layer moves each live iframe over
 *  its placeholder; when the placeholder is gone (other page / other tab) the
 *  iframe is hidden but stays ALIVE — so returning to a page shows the HMI
 *  exactly as you left it, no reload, no duplicated views.
 *
 *  Also hosts per-channel "interact" state: iframes are click-through by
 *  default (monitoring wall), a panel's Interact button enables the mouse. */

import { useEffect, useRef, useSyncExternalStore } from "react";
import type { CropRect, WebPanelConfig } from "./types";
import { WEB_SANDBOX } from "./panels/web-panel";

interface LiveSlot {
  cfg: WebPanelConfig;
  // Screen-channel crop (in view_w×view_h px); null = whole page.
  crop: CropRect | null;
  els: HTMLElement[]; // placeholders, most recent last (maximize overlay wins)
  interact: boolean;
  nonce: number; // bump to force the iframe to reload
}

const slots = new Map<string, LiveSlot>();
const listeners = new Set<() => void>();
let version = 0;
// Edit-mode lock: iframes must never swallow drag gestures while arranging.
let layerLocked = false;
// Maximize solo: only this channel's iframe is shown (others would float
// above the maximize backdrop otherwise).
let soloChannelId: string | null = null;

export function setWebLayerLock(v: boolean) {
  layerLocked = v;
}

export function setWebSolo(channelId: string | null) {
  soloChannelId = channelId;
}

function emit() {
  version += 1;
  listeners.forEach((l) => l());
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function registerWebSlot(
  channelId: string,
  el: HTMLElement,
  cfg: WebPanelConfig,
  crop: CropRect | null = null
) {
  const slot = slots.get(channelId);
  if (slot) {
    slot.els.push(el);
    slot.cfg = cfg;
    slot.crop = crop;
  } else {
    slots.set(channelId, { cfg, crop, els: [el], interact: false, nonce: 0 });
  }
  emit();
}

export function unregisterWebSlot(channelId: string, el: HTMLElement) {
  const slot = slots.get(channelId);
  if (!slot) return;
  slot.els = slot.els.filter((e) => e !== el);
  // Keep the slot (iframe stays alive & hidden) even with zero placeholders.
  emit();
}

export function setWebInteract(channelId: string, v: boolean) {
  const slot = slots.get(channelId);
  if (slot) {
    slot.interact = v;
    emit();
  }
}

export function reloadWebSlot(channelId: string) {
  const slot = slots.get(channelId);
  if (slot) {
    slot.nonce += 1;
    emit();
  }
}

export function useWebInteract(channelId: string): boolean {
  return useSyncExternalStore(
    subscribe,
    () => slots.get(channelId)?.interact ?? false,
    () => false
  );
}

function useLayerVersion(): number {
  return useSyncExternalStore(
    subscribe,
    () => version,
    () => 0
  );
}

/** Placeholder a panel renders where a live web channel should appear. */
export function WebSlot({
  channelId,
  cfg,
  crop,
}: {
  channelId: string;
  cfg: WebPanelConfig;
  crop?: CropRect | null;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const cfgKey = JSON.stringify([cfg, crop]);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    registerWebSlot(channelId, el, cfg, crop ?? null);
    return () => unregisterWebSlot(channelId, el);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channelId, cfgKey]);
  return <div ref={ref} className="h-full w-full bg-black" />;
}

/** The persistent iframe host — mount ONCE inside the (relative) wall
 *  container so fullscreen keeps it visible. */
export function WebLiveLayer() {
  useLayerVersion(); // re-render when slots are added/changed
  const layerRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef(new Map<string, HTMLDivElement>());
  const innerRefs = useRef(new Map<string, HTMLDivElement>());

  // Follow placeholders every frame (cheap: a handful of getBoundingClientRect)
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const layer = layerRef.current;
      if (layer) {
        const lb = layer.getBoundingClientRect();
        for (const [id, slot] of slots) {
          const item = itemRefs.current.get(id);
          if (!item) continue;
          const el = [...slot.els].reverse().find((e) => e.isConnected);
          const b = el?.getBoundingClientRect();
          const soloHidden = soloChannelId !== null && id !== soloChannelId;
          if (!el || !b || b.width < 2 || b.height < 2 || soloHidden) {
            item.style.visibility = "hidden";
            item.style.pointerEvents = "none";
            continue;
          }
          item.style.visibility = "visible";
          item.style.pointerEvents =
            slot.interact && !layerLocked ? "auto" : "none";
          item.style.transform = `translate(${Math.round(b.left - lb.left)}px, ${Math.round(b.top - lb.top)}px)`;
          item.style.width = `${Math.round(b.width)}px`;
          item.style.height = `${Math.round(b.height)}px`;
          // Fit the native viewport into the box — CSS `zoom` (not transform):
          // the browser re-rasterizes at the final size, so HMI text stays
          // SHARP at any scale instead of looking like a shrunken photo.
          const inner = innerRefs.current.get(id);
          if (inner) {
            const vw = slot.cfg.view_w ?? 1920;
            const vh = slot.cfg.view_h ?? 1080;
            // Crop region (view px); no crop = whole page. `s` contains that
            // region in the box, and left/top shift it so the region's corner
            // lands in the letterbox (reduces to whole-page when crop is null).
            const rx = slot.crop?.x ?? 0;
            const ry = slot.crop?.y ?? 0;
            const rw = slot.crop && slot.crop.w > 0 ? slot.crop.w : vw;
            const rh = slot.crop && slot.crop.h > 0 ? slot.crop.h : vh;
            const s = Math.min(b.width / rw, b.height / rh);
            inner.style.zoom = String(s);
            // Offsets are in PRE-zoom (layout) px so the centering stays
            // correct: layout size seen by the parent = vw*s × vh*s.
            inner.style.left = `${Math.round((b.width - rw * s) / 2 / s - rx)}px`;
            inner.style.top = `${Math.round((b.height - rh * s) / 2 / s - ry)}px`;
          }
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <div
      ref={layerRef}
      // z-30: above panel cells (z-10) AND the maximize backdrop (z-20);
      // chrome/controls live at z-40+. The wall container is `isolate z-0`,
      // so none of this can ever cover UI outside the wall.
      className="pointer-events-none absolute inset-0 z-30 overflow-hidden"
    >
      {[...slots.entries()].map(([id, slot]) => {
        const vw = slot.cfg.view_w ?? 1920;
        const vh = slot.cfg.view_h ?? 1080;
        const zoom = Math.min(3, Math.max(0.25, slot.cfg.zoom ?? 1));
        const ox = Math.max(0, slot.cfg.offset_x ?? 0);
        const oy = Math.max(0, slot.cfg.offset_y ?? 0);
        return (
          <div
            key={id}
            ref={(el) => {
              if (el) itemRefs.current.set(id, el);
              else itemRefs.current.delete(id);
            }}
            className="absolute left-0 top-0 overflow-hidden bg-black"
            style={{ visibility: "hidden", willChange: "transform" }}
          >
            <div
              ref={(el) => {
                if (el) innerRefs.current.set(id, el);
                else innerRefs.current.delete(id);
              }}
              className="absolute left-0 top-0 overflow-hidden"
              style={{ width: vw, height: vh }}
            >
              <iframe
                key={slot.nonce}
                src={/^https?:\/\//i.test(slot.cfg.url) ? slot.cfg.url : "about:blank"}
                title={slot.cfg.url}
                className="absolute left-0 top-0 border-0"
                style={{
                  width: `calc(${100 / zoom}% + ${ox}px)`,
                  height: `calc(${100 / zoom}% + ${oy}px)`,
                  transform: `scale(${zoom}) translate(-${ox}px, -${oy}px)`,
                  transformOrigin: "top left",
                }}
                // No fullscreen permission: the site's own fullscreen fills its
                // viewport (= this panel), never the whole monitor.
                sandbox={WEB_SANDBOX}
                referrerPolicy="strict-origin-when-cross-origin"
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}
