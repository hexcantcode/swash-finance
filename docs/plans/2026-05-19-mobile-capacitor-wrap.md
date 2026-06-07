# Mobile / Capacitor wrap plan

Date: 2026-05-19 · Status: design doc, not yet executed

`apps/mobile` is the mobile-targeted SvelteKit app. It is wrapped by
[Capacitor](https://capacitorjs.com/docs) to produce native iOS and Android
binaries — same Svelte code, native shell. This doc captures the seams that
need to be ready before that wrap can happen, and what stays a TODO until
then.

## Architecture

```
apps/web ─ canonical data layer ─┐
  drizzle / queries / scoring     │  HTTP   ┌──── apps/mobile (SvelteKit, SPA) ───── Capacitor shell
  /api/leaders                     ├────────┤                                          (iOS / Android)
  /api/holdings                    │        │  client-only loads
  /api/assets, /api/feed/*         │        │  fetch(API_BASE + '/api/*')
                                   ┘        └──────────────────────────────────────────────────────
```

Single source of truth for every metric stays in `apps/web` — mobile
never touches the database directly. Per `CLAUDE.md`: "One canonical
definition per data point." Mobile is a pure view layer.

## What's already in place (2026-05-19 slice)

- `apps/mobile/src/lib/api/client.ts` — fetch wrapper that prefixes
  `PUBLIC_API_BASE` (empty in dev, set at Capacitor build time).
- `apps/mobile/vite.config.ts` — dev-only proxy `/api → http://localhost:5173`
  so the same `fetch('/api/...')` code works in dev (against local
  `apps/web`) and in production (against deployed `apps/web`).
- `apps/mobile/src/lib/styles/mobile.css` — touch-target tokens (`--touch-min:
  48px`), safe-area passthroughs (`--safe-top/right/bottom/left`), motion
  tokens with `prefers-reduced-motion` override, `.tappable` / `.tappable-row`
  / `.m-skeleton` primitives.
- `apps/mobile/src/routes/traders/+page.svelte` — first vertical slice,
  client-only.

## What changes for the Capacitor wrap

### 1. Adapter swap

Currently `adapter-node`. Capacitor needs a static bundle it can ship as
the WebView's source.

```js
// apps/mobile/svelte.config.js
import adapter from '@sveltejs/adapter-static';
export default {
  kit: {
    adapter: adapter({
      pages: 'build',
      assets: 'build',
      fallback: 'index.html', // SPA fallback for client-side routing
      precompress: false,
      strict: false,           // tolerate dynamic routes (handled at runtime)
    }),
  },
};
```

Implications:

- Every `+page.server.ts` must go. They cannot run in a static bundle.
  - Today: `apps/mobile/src/routes/+page.server.ts` (root redirect),
    `apps/mobile/src/routes/traders/+page.server.ts` (stub).
  - Replacement: a `+layout.ts` with `export const ssr = false; export
    const prerender = false;`, plus any redirects done client-side.
- The `apps/mobile/src/routes/api/*` endpoints currently in the scaffold
  are dead weight — mobile calls `apps/web`'s endpoints, never its own.
  These should be deleted before the wrap.

### 2. `PUBLIC_API_BASE`

The build needs to know where deployed `apps/web` lives. Set in
`apps/mobile/.env.production` or the Capacitor build env:

```bash
PUBLIC_API_BASE=https://swash.finance
```

`src/lib/api/client.ts` already reads this; no code change required.

CORS: `apps/web` must allow the Capacitor origin (`capacitor://localhost`
on iOS, `https://localhost` on Android) — confirm in the response handler
on web's `/api/*` endpoints before first wrap.

### 3. Capacitor install

```bash
cd apps/mobile
pnpm add -D @capacitor/cli
pnpm add @capacitor/core @capacitor/ios @capacitor/android
npx cap init swash com.swash.app --web-dir build
npx cap add ios
npx cap add android
```

`capacitor.config.ts` outline:

```ts
import type { CapacitorConfig } from '@capacitor/cli';
const config: CapacitorConfig = {
  appId: 'com.swash.app',
  appName: 'Swash',
  webDir: 'build',
  server: {
    // For dev with hot reload, point at the running Vite server. Leave
    // unset for production builds — bundle is served from disk.
    // url: 'http://192.168.x.x:5174',
    // cleartext: true,
  },
};
export default config;
```

### 4. Build pipeline

```
pnpm --filter @copytrade/mobile build   # SvelteKit static output → build/
npx cap sync                             # copy web assets into iOS/Android
npx cap open ios                         # opens Xcode for iOS build
npx cap open android                     # opens Android Studio
```

## Native-shell concerns to design before wrap

These don't block the first wrap but are the next surface to design.

| Concern | Approach |
|---|---|
| Safe-area / notch | Already handled — components use `--safe-top` / `--safe-bottom` env() passthroughs. Verify with Capacitor's `StatusBar` plugin. |
| Status bar style | `@capacitor/status-bar` plugin; force dark content in light areas, light in dark. |
| Splash | `@capacitor/splash-screen`; provide assets via `cordova-res` from a single 2048×2048 source. |
| Deep links | `@capacitor/app` URL listener; route to `/trader/[address]` or `/assets/[coin]`. |
| Haptics on tap | `@capacitor/haptics` — fire a light impact on chip taps and row selection. Skill: "feedback <100ms" already met visually; haptics make it native-feeling. |
| Network state | `@capacitor/network` — show an inline banner when offline; current fetches will surface a generic error which is correct but uninformative. |
| Auth / wallet | Out of scope here — the Connect Wallet button is a TODO in `+layout.svelte`. Native wallet links (WalletConnect, native deep-link to MetaMask) belong with that work. |

## What is NOT done in this slice

- Other routes (`/assets`, `/trader/[address]`, `/feed`) — the existing files
  are broken half-clones of `apps/web` and import server-side queries that
  don't exist in mobile. They need the same client-only treatment as
  `/traders`. Until then, only `/` and `/traders` are usable.
- The scaffold's `apps/mobile/src/lib/server/*` and
  `apps/mobile/src/routes/api/*` should be deleted — mobile never serves
  data, it consumes it.
- `pnpm check` reports 18 warnings, all in the broken-clone routes above.

## References

- Mobile design tokens & a11y guidance: applied from the `mobile-app-design`
  skill — 48px touch min, 16px body floor (prevents iOS input zoom), WCAG AA
  contrast on accent/text combos, motion under 320ms.
- Canonical leaderboard query: `apps/web/src/lib/server/queries/leaders.ts`.
  Mobile depends on `/api/leaders` exposing it — see
  `apps/web/src/routes/api/leaders/+server.ts`.
