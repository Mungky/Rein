/**
 * Judul topbar / app bar mobile per halaman. Halaman dinamis (detail project, WO) mengisi
 * lewat `setChrome`; layout (app) mereset saat navigasi.
 */
export interface Crumb {
  label: string;
  href?: string;
}

export const chrome = $state<{ title: string | null; crumbs: Crumb[]; back: string | null }>({
  title: null,
  crumbs: [],
  back: null,
});

export function setChrome(c: { title: string; crumbs?: Crumb[]; back?: string | null }): void {
  chrome.title = c.title;
  chrome.crumbs = c.crumbs ?? [];
  chrome.back = c.back ?? null;
}

export function resetChrome(): void {
  chrome.title = null;
  chrome.crumbs = [];
  chrome.back = null;
}
