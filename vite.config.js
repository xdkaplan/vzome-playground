import { defineConfig } from 'vite';
import solid from 'vite-plugin-solid';

export default defineConfig({
  plugins: [solid()],
  // Ensure a single solid-js instance so SUID components track app signals
  // (e.g. reactive `disabled` on buttons). Without this, Vite can bundle a
  // separate solid-js for SUID's deep imports and reactivity breaks.
  resolve: { dedupe: ['solid-js', 'solid-js/web'] },
});
