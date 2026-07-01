import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

// Dev API target. Defaults to the local BFF on :5174; set API_PROXY_TARGET to
// point the local mobile UI at a remote deployment (e.g. the Railway api).
const apiTarget = process.env.API_PROXY_TARGET ?? 'http://localhost:5174';

export default defineConfig({
  plugins: [tailwindcss(), sveltekit()],
  server: {
    fs: {
      // Allow Vite to serve files from outside apps/mobile (workspace packages).
      allow: ['..'],
    },
    // In dev, mobile is a pure client that hits apps/web's API endpoints.
    // Proxying /api to web (port 5173) lets mobile code write `fetch('/api/…')`
    // unchanged across dev, prod-web-served-mobile, and Capacitor (where
    // PUBLIC_API_BASE is injected at build time).
    proxy: {
      // Mobile is a pure client — every server-owned endpoint goes through
      // apps/web. The `/coins/[coin].svg` proxy is web's HL-CDN passthrough
      // (see `coinIconUrl`), so it needs the same forwarding as `/api`.
      '/api': {
        target: apiTarget,
        changeOrigin: true,
      },
      '/coins': {
        target: apiTarget,
        changeOrigin: true,
      },
    },
  },
});
