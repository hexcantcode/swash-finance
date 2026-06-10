import adapter from '@sveltejs/adapter-static';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
const config = {
  preprocess: vitePreprocess(),
  kit: {
    // SPA build for the Capacitor webview (and static PWA host): no SSR
    // (see src/routes/+layout.ts), one fallback page so dynamic routes like
    // /trader/[address] resolve client-side. Capacitor needs the SPA shell at
    // index.html (its webview entry point). The client only ever talks to the
    // BFF (/api/*) via PUBLIC_API_BASE — see src/lib/api/client.ts.
    adapter: adapter({ fallback: 'index.html' }),
  },
};

export default config;
