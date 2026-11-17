import { defineConfig } from 'tsup';

/** Bundle server dan CLI seed; paket workspace (@rein/*) ikut di-bundle, dependensi npm tidak. */
export default defineConfig({
  entry: { index: 'src/index.ts', 'seed-cli': 'src/db/seed-cli.ts' },
  format: ['esm'],
  platform: 'node',
  target: 'node22',
  outDir: 'dist',
  clean: true,
  sourcemap: true,
  splitting: false,
  noExternal: [/^@rein\//],
});
