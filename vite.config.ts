import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { nodePolyfills } from 'vite-plugin-node-polyfills';
import path from 'path';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    react(),
    // Polyfill Node globals (Buffer, process, global, etc.) for
    // dependencies that reference them in the browser.
    nodePolyfills({
      globals: { Buffer: true, global: true, process: true },
      protocolImports: true,
    }),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      'node:crypto': path.resolve(__dirname, './src/node-crypto-shim.ts'),
    },
  },
  base: './',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      // The wallet window, and the live payments worker's page (electron/liveWorker.ts).
      input: {
        main: path.resolve(__dirname, 'index.html'),
        liveWorker: path.resolve(__dirname, 'live-worker.html'),
      },
    },
    // Some CommonJS dependencies mix require() with ES module syntax.
    commonjsOptions: {
      transformMixedEsModules: true,
    },
  },
  server: {
    port: 5173,
  },
});
