import { initTheme } from '$lib/theme.svelte';

// SPA murni (adapter-static fallback). Server Hono menyajikan index.html untuk semua route.
export const ssr = false;
export const prerender = false;
export const trailingSlash = 'never';

export function load() {
  initTheme();
}
