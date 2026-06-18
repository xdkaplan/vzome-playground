import { defineConfig } from 'vite';
import solid from 'vite-plugin-solid';
import { execSync } from 'node:child_process';

// Short commit hash, baked in at build time for the logo's version tooltip.
const commit = (() => {
  try { return execSync('git rev-parse --short HEAD').toString().trim(); }
  catch { return 'dev'; }
})();

export default defineConfig({
  plugins: [solid()],
  define: { __COMMIT__: JSON.stringify(commit) },
  // Ensure a single solid-js instance so SUID components track app signals
  // (e.g. reactive `disabled` on buttons). Without this, Vite can bundle a
  // separate solid-js for SUID's deep imports and reactivity breaks.
  resolve: { dedupe: ['solid-js', 'solid-js/web'] },
  // The vZome engine is loaded at runtime from an external ES module URL
  // (engine.js: `import ... from 'https://www.vzome.com/...'`). Keep https URLs
  // external and emit the worker as an ES module so that import survives the
  // production bundle — the default IIFE worker format can't hold ES imports,
  // which is what caused "vzomeLegacy_js is not defined" on the deployed build.
  worker: {
    format: 'es',
    rollupOptions: { external: [/^https:\/\//] },
  },
  build: {
    rollupOptions: {
      external: [/^https:\/\//],
      // Split vendors into cacheable chunks; with the lazy routes, /gallery only
      // fetches what it needs (solid + grid) and never suid/codemirror.
      output: {
        manualChunks(id) {
          if (id.includes('node_modules')) {
            if (id.includes('@suid')) return 'suid';
            if (id.includes('codemirror') || id.includes('@codemirror') || id.includes('@lezer')) return 'codemirror';
            if (id.includes('solid-js') || id.includes('@solid')) return 'solid';
            return 'vendor';
          }
        },
      },
    },
  },
});
