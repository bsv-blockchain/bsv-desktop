import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { nodePolyfills } from 'vite-plugin-node-polyfills';
import path from 'path';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    react(),
    // Polyfill Node globals (Buffer, process, global, etc.) for the
    // browser. Needed by legacy bsv@1.5.6 (which stas-js depends on) —
    // it references Node primitives throughout its module bodies.
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
    // Force Rollup's CommonJS plugin to run on the vendored dxs SDK
    // dist files. Without this, prod builds fail with
    // *"ScriptType is not exported by …/bsv.js"* etc. — Rollup sees the
    // CJS source raw and can't extract named exports. The
    // `transformMixedEsModules: true` flag handles the SDK's runtime
    // `__exportStar(require("./submodule"), exports)` pattern for the
    // ./script subtree (where LockingScriptReader lives). Vite dev is
    // unaffected (esbuild pre-bundles via optimizeDeps).
    commonjsOptions: {
      include: [/dxs-bsv-token-sdk/, /node_modules/],
      transformMixedEsModules: true,
    },
  },
  server: {
    port: 5173,
  },
  // dxs-bsv-token-sdk is a CJS package installed via `file:` (sibling dir).
  // Vite's auto-discovery does not reliably pre-bundle file:-linked subpaths,
  // and serving raw CJS to the browser breaks named-export imports
  // (e.g. `import { LockingScriptReader } from 'dxs-bsv-token-sdk/bsv'`).
  // Listing the subpaths here forces esbuild pre-bundling, which converts the
  // CJS exports into ESM named exports.
  optimizeDeps: {
    include: [
      'dxs-bsv-token-sdk/bsv',
      'dxs-bsv-token-sdk/dstas',
      // SDK leaf-module paths — same ones the wallet imports directly to
      // bypass Rollup's `__exportStar` blindness on prod builds. Without
      // these here, Vite dev serves the raw CJS files to the browser and
      // they explode with "exports is not defined". The leaf paths are
      // whitelisted in the SDK's package.json `exports` field.
      'dxs-bsv-token-sdk/script/read/locking-script-reader',
      'dxs-bsv-token-sdk/script/build/dstas-locking-builder',
      'dxs-bsv-token-sdk/script/eval/script-evaluator',
      // stas-js + its bsv-js peer for the BRC-100 STAS transfer path.
      // Explicit file paths — stas-js's package.json points `module` at
      // `dist/index` but ships no `dist/` folder, so plain `stas-js`
      // resolution fails. Bypass via the file paths directly.
      'stas-js/index.js',
      'stas-js/lib/stas.js',
      'bsv',
    ],
  },
});
