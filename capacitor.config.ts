import type { CapacitorConfig } from '@capacitor/cli';

/**
 * Capacitor shell. `npm run cap:sync` builds the web app and copies `dist/`
 * into the Android project. No signing credentials live here — a release
 * keystore stays outside the repo, same as in KainLog.
 */
const config: CapacitorConfig = {
  appId: 'ph.cedric.fitnotes',
  appName: 'FitNotes',
  webDir: 'dist',
  server: {
    // The WebView origin. Changing appId or scheme after install gives a new
    // origin, and IndexedDB data from the old one becomes unreachable.
    androidScheme: 'https',
  },
  android: {
    allowMixedContent: false,
  },
};

export default config;
