import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

/**
 * No PWA and no base path: the Capacitor Android shell loads index.html
 * straight out of the bundle, so relative asset URLs are all that is needed.
 */
export default defineConfig({
  plugins: [react()],
  server: {
    // Reachable from the phone/emulator during development.
    host: '0.0.0.0',
    port: 5173,
    // dist/ is copied into android/ by cap sync; watching it reload-loops.
    watch: { ignored: ['**/android/**', '**/dist/**'] },
  },
  test: {
    // Node by default; UI tests opt into jsdom with the per-file pragma.
    environment: 'node',
    globals: true,
    include: ['src/test/**/*.test.{ts,tsx}'],
  },
});
