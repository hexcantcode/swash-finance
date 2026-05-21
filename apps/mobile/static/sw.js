// Tombstone service worker.
//
// No SW is registered by this app — but some browsers retain SWs from prior
// dev sessions / experiments, and a stale registration silently intercepts
// fetches and serves broken responses. The most visible symptom is "page
// loads for a second then goes blank" because the SW returns stale assets
// that don't match the hydrated SvelteKit runtime.
//
// This file ensures: any browser that requests `/sw.js` (i.e. has a stale
// registration) installs THIS one, then immediately unregisters it and
// drops every cache. Self-deleting, idempotent — safe to ship forever.

self.addEventListener('install', () => {
  // Skip waiting so this SW takes over and can unregister itself ASAP.
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      // Drop any caches the previous SW may have created.
      try {
        const keys = await caches.keys();
        await Promise.all(keys.map((k) => caches.delete(k)));
      } catch {
        /* ignore */
      }
      // Unregister this SW so the browser stops intercepting fetches.
      try {
        await self.registration.unregister();
      } catch {
        /* ignore */
      }
      // Force every controlled page to reload without a controlling SW,
      // so the user sees the fixed site on the same load attempt rather
      // than having to refresh themselves.
      const clientList = await self.clients.matchAll({ type: 'window' });
      for (const client of clientList) {
        try {
          client.navigate(client.url);
        } catch {
          /* ignore */
        }
      }
    })(),
  );
});

// Pass every fetch through to the network — never serve from cache.
self.addEventListener('fetch', () => {
  /* intentionally empty — default behavior is network passthrough */
});
