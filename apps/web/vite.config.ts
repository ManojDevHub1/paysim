import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8787',
        changeOrigin: true,
      },
      '/health': {
        target: 'http://127.0.0.1:8787',
        changeOrigin: true,
      },
      '/control': {
        target: 'http://127.0.0.1:8787',
        changeOrigin: true,
      },
      '/checkout': {
        target: 'http://127.0.0.1:8787',
        changeOrigin: true,
      },
      '/compat': {
        target: 'http://127.0.0.1:8787',
        changeOrigin: true,
      },
    },
  },
  resolve: {
    alias: {
      '@paysim/contracts': path.resolve(__dirname, '../../packages/contracts/src/index.ts'),
      '@paysim/shared': path.resolve(__dirname, '../../packages/shared/src/index.ts'),
    },
  },
});
