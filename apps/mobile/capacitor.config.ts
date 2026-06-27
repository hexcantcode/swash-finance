import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'finance.swash.app',
  appName: 'Swash',
  // adapter-static writes the SPA here; `cap sync` copies it into the native
  // project. The native build points PUBLIC_API_BASE at the deployed BFF.
  webDir: 'build',
};

export default config;
