import { defineConfig } from 'vite';
import solid from 'vite-plugin-solid';

export default defineConfig({
  plugins: [solid()],
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
    rollupOptions: { external: [/^https:\/\//] },
  },
});
