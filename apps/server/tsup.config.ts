import { defineConfig } from 'tsup';

/** Bundle server ke dist/index.js; paket workspace (@rein/*) ikut di-bundle, dependensi npm tidak. */
export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  platform: 'node',
  target: 'node22',
  outDir: 'dist',
  clean: true,
  sourcemap: true,
  splitting: false,
  noExternal: [/^@rein\//],
});
