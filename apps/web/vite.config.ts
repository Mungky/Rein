import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vitest/config';

const api = 'http://localhost:3000';

export default defineConfig({
  plugins: [sveltekit()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': { target: api, changeOrigin: false },
      '/auth/google': { target: api, changeOrigin: false },
      '/files': { target: api, changeOrigin: false },
      '/healthz': { target: api, changeOrigin: false },
    },
  },
  build: {
    target: 'es2022',
    cssCodeSplit: true,
  },
  test: {
    include: ['src/**/*.test.ts'],
  },
});
