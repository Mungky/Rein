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
import type { WebPanelConfig } from "./types";

interface LiveSlot {
  cfg: WebPanelConfig;
  els: HTMLElement[]; // placeholders, most recent last (maximize overlay wins)
  interact: boolean;
  nonce: number; // bump to force the iframe to reload
}

const slots = new Map<string, LiveSlot>();
const listeners = new Set<() => void>();
let version = 0;

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
  cfg: WebPanelConfig
) {
  const slot = slots.get(channelId);
  if (slot) {
    slot.els.push(el);
    slot.cfg = cfg;
  } else {
    slots.set(channelId, { cfg, els: [el], interact: false, nonce: 0 });
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
}: {
  channelId: string;
  cfg: WebPanelConfig;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const cfgKey = JSON.stringify(cfg);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    registerWebSlot(channelId, el, cfg);
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
          if (!el || !b || b.width < 2 || b.height < 2) {
            item.style.visibility = "hidden";
            item.style.pointerEvents = "none";
            continue;
          }
          item.style.visibility = "visible";
          item.style.pointerEvents = slot.interact ? "auto" : "none";
          item.style.transform = `translate(${b.left - lb.left}px, ${b.top - lb.top}px)`;
          item.style.width = `${b.width}px`;
          item.style.height = `${b.height}px`;
          // Fit the native viewport into the box (contain, centered)
          const inner = innerRefs.current.get(id);
          if (inner) {
            const vw = slot.cfg.view_w ?? 1920;
            const vh = slot.cfg.view_h ?? 1080;
            const s = Math.min(b.width / vw, b.height / vh);
            inner.style.transform = `translate(${(b.width - vw * s) / 2}px, ${(b.height - vh * s) / 2}px) scale(${s})`;
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
      className="pointer-events-none absolute inset-0 z-20 overflow-hidden"
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
              style={{
                width: vw,
                height: vh,
                transformOrigin: "top left",
              }}
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
                sandbox="allow-scripts allow-same-origin allow-forms"
                referrerPolicy="no-referrer"
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}
