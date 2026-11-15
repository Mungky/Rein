#!/usr/bin/env node
/**
 * Cek performance budget PRD §9.1 dari hasil `pnpm build`:
 *   NFR-001  JS awal route Beranda (gzip) ≤ 100 KB (batas keras 130 KB)
 *   NFR-002  CSS awal (gzip)               ≤ 20 KB
 *   NFR-008  Font Inter woff2              ≤ 60 KB
 * "Awal" = entry SvelteKit (start + app) + node layout root, layout (app), page Beranda,
 * beserta seluruh import statisnya.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const kit = path.join(root, 'apps/web/.svelte-kit');
const clientDir = path.join(kit, 'output/client');
const manifestPath = path.join(clientDir, '.vite/manifest.json');
const nodesDir = path.join(kit, 'generated/client-optimized/nodes');

const BUDGET = { js: 100 * 1024, jsHard: 130 * 1024, css: 20 * 1024, font: 60 * 1024 };

if (!existsSync(manifestPath)) {
  console.error('Manifest Vite tidak ditemukan. Jalankan `pnpm build` dulu.');
  process.exit(1);
}
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));

/** Node SvelteKit yang dimuat untuk route Beranda (`/`). */
const wanted = [
  /routes\/\+layout\.(svelte|ts)/,
  /routes\/\(app\)\/\+layout\.(svelte|ts)/,
  /routes\/\(app\)\/\+page\.(svelte|ts)/,
];
const nodeKeys = [];
for (const f of readdirSync(nodesDir)) {
  const src = readFileSync(path.join(nodesDir, f), 'utf8');
  if (wanted.some((re) => re.test(src))) {
    const key = Object.keys(manifest).find((k) => k.endsWith(`client-optimized/nodes/${f}`));
    if (key) nodeKeys.push(key);
  }
}
const entryKeys = Object.keys(manifest).filter((k) => manifest[k].isEntry);
if (nodeKeys.length < 3) {
  console.error(`Node route Beranda tidak lengkap (ditemukan ${nodeKeys.length}/3).`);
  process.exit(1);
}

const js = new Set();
const css = new Set();
function walk(key) {
  const chunk = manifest[key];
  if (!chunk || js.has(chunk.file)) return;
  js.add(chunk.file);
  for (const c of chunk.css ?? []) css.add(c);
  for (const imp of chunk.imports ?? []) walk(imp);
}
[...entryKeys, ...nodeKeys].forEach(walk);

const gz = (file) => gzipSync(readFileSync(path.join(clientDir, file)), { level: 9 }).length;
const sum = (files) => [...files].reduce((t, f) => t + gz(f), 0);
const jsBytes = sum(js);
const cssBytes = sum(css);

const fonts = [];
(function findFonts(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) findFonts(p);
    else if (e.name.endsWith('.woff2')) fonts.push(p);
  }
})(clientDir);
const fontBytes = Math.max(0, ...fonts.map((f) => readFileSync(f).length));

const kb = (n) => `${(n / 1024).toFixed(1)} KB`;
const rows = [
  ['JS awal (gzip)', jsBytes, BUDGET.js, `${js.size} chunk`],
  ['CSS awal (gzip)', cssBytes, BUDGET.css, `${css.size} file`],
  ['Font woff2 terbesar', fontBytes, BUDGET.font, `${fonts.length} file`],
];
console.log('\nPerformance budget (PRD §9.1)\n');
for (const [name, val, max, note] of rows) {
  const ok = val <= max;
  console.log(
    `${ok ? '✓' : '✗'} ${name.padEnd(22)} ${kb(val).padStart(10)} / ${kb(max)}  (${note})`,
  );
}
if (jsBytes > BUDGET.js || cssBytes > BUDGET.css || fontBytes > BUDGET.font) {
  console.error('\nBudget terlampaui.');
  process.exit(1);
}
console.log('\nSemua budget terpenuhi.');
