# Mobile architecture — PWA now, native-clean later

**Date:** 2026-06-10
**Status:** Approved (design)
**Decision driver:** Ship as a PWA first; keep the native (Capacitor) transformation
as open and clean as possible. No desktop version.

---

## TL;DR

Swash already has the right *shape*. The only real change is removing
duplication, formalizing the API tier as a Backend-for-Frontend (BFF), and
holding one invariant so the PWA→native flip is a build-config change, not a
rewrite.

- **`apps/web` → `apps/api`**: delete the dead desktop UI, keep `/api/*` +
  `$lib/server` + `/coins` proxy. This is the BFF — the single backend the
  client talks to.
- **`apps/mobile`**: stays a pure `/api` client. PWA now; Capacitor later.
- **`apps/worker`, Neon DB, `packages/*`**: untouched — already correct.
- **Invariant:** the client app only ever speaks `/api` over HTTP. No
  `$lib/server` imports in the client, no client→HL connections, no DB reads
  in page loaders.

---

## Why this shape (and why not "merge into one app")

We considered collapsing the API *into* the mobile app and having page loaders
import the DB queries directly. **That is wrong for this target and was
discarded.** A Capacitor build is a static bundle with no server on the device
— there is nowhere for `$lib/server` or a `+page.server.ts` loader to run. The
API must be a separately-hosted backend the app calls over HTTPS. The existing
stub comments in `apps/mobile/src/routes/**/+page.server.ts` ("will be deleted
when we switch to adapter-static") already encode this intent.

"Single source of truth" is therefore achieved by **deleting the duplicate
desktop UI**, not by fusing client and server. The result is the
industry-standard split: one BFF backend + one client.

## Current architecture (already mostly right)

```
  HL REST + WS ──► apps/worker ──► Neon DB ──► apps/web /api/* ──HTTP /api──► apps/mobile
   (writes)        6 PM2 procs     packages/db   + $lib/server     (proxy/        pure client
                   sole writer     canonical     (also live HL      PUBLIC_API_BASE)
                   owns HL WS       state         passthrough)
```

- **Ingest (`apps/worker`)** — sole writer. `ws-live` (per-user fills),
  `trades-coin-live` (per-coin firehose backup), `leader-cache-poll` (equity),
  `hip3-poll-live`, `worker-cron` (score/leaderboard/refresh). Owns all HL
  WebSocket connections.
- **State (Neon Postgres, `packages/db`)** — canonical metric store.
- **Serving (`apps/web`)** — `/api/*` endpoints + `$lib/server/queries`, reads
  the DB and does some live HL passthrough (e.g. `/api/assets`). *Also* carries
  a dead desktop UI (`/`, `/assets`, `/traders`, `/feed`, …).
- **Client (`apps/mobile`)** — pure client; every page fetches `web`'s `/api/*`
  via the Vite proxy (dev) or `PUBLIC_API_BASE` (Capacitor). `+page.server.ts`
  files are intentional stubs.

## Target architecture

```
  HL REST + WS ─► apps/worker ─► Neon DB ─► apps/api (BFF) ─┬─ REST /api/*  ──► apps/mobile
   (unchanged)    sole writer    canonical   reads DB +     │  (req/response)     PWA now →
                  owns HL WS      state       HL passthrough └─ SSE /api/stream ─► Capacitor later
                                              CORS-ready,        (live updates,
                                              secrets stay here   when wanted)
```

- **`apps/api`** (today's `apps/web`, desktop UI removed): the BFF. REST for
  now; add a single SSE stream when live updates are wanted. CORS-ready from day
  one so the cross-origin native client works without a late surprise.
- **`apps/mobile`**: pure `/api` client. PWA now (`adapter-node` or static,
  same-origin); Capacitor later (`adapter-static` + App Manifest + Service
  Worker + platform detection). Always resolves the API base via
  `$lib/api/client.ts` + `PUBLIC_API_BASE`.
- **`apps/worker`, DB, `packages/*`**: unchanged.

## The load-bearing invariant

> **The client app only ever speaks `/api` over HTTP.**

Concretely: no `$lib/server` imports in the client, no `+page.server.ts` doing
DB work (keep them stubs / client fetches), no client→HL connection, never a
relative `/api` path that assumes same-origin (always go through `client.ts`).

Hold this and PWA↔native differ in exactly one place:

| | PWA (now) | Native (later) |
|---|---|---|
| Client adapter | `adapter-node` (or static, same-origin) | `adapter-static` |
| Talks to API via | `/api` (same-origin) | `PUBLIC_API_BASE` (cross-origin) |
| Wrapper | browser | Capacitor shell |

## Industry-standard decisions baked in

1. **BFF pattern** — a backend dedicated to the client, aggregating upstream
   sources into lightweight client-shaped payloads, keeping secrets server-side.
   `apps/api` is exactly this.

2. **Real-time = SSE, not WebSocket; and never client→HL.** The standard
   trading pattern is: backend owns the exchange feed → fan-out → push to
   clients. The worker already owns HL's WS (the hard half). WebSocket is the
   standard only when the *client pushes back* with low latency (placing
   orders). Swash is **read-only analytics — data flows server→client only** —
   which is the case where **SSE** wins: plain HTTP, auto-reconnect, no
   sticky-session/CORS-preflight pain, and it passes cleanly through a Capacitor
   WebView. When live tickers/positions are wanted, add **one SSE endpoint on
   the BFF** fed by the worker/DB. Do not open a client WS; never a client→HL
   connection.

3. **Auth (when added): short-lived tokens in Keychain/Keystore, sent via
   `Authorization` header, OAuth2 + PKCE — never cookie sessions.** Cookies
   break in native webviews; header tokens behave identically in browser and
   native. The BFF holds any upstream secrets so they never ship in the bundle.

4. **App Store guideline 4.2 ("more than a repackaged website")** is a real
   gate for a Capacitor trading app. Clear it with genuine native capabilities —
   **push notifications (price/position alerts), biometric unlock, haptics,
   native share.** Plan one or two into the native phase; Capacitor plugins make
   them cheap.

5. **Capacitor is the right engine here.** WebView performance is excellent for
   content/dashboard apps. The one place React Native would win is *very* heavy
   real-time charting; Swash uses `lightweight-charts` (canvas, built for this),
   so Capacitor is fine. Revisit only if on-device charts feel janky — YAGNI for
   now.

## Migration path (sequenced, each step verifiable)

Not all of this is in scope for the first cut — listed in dependency order.

1. **Rename/strip the backend.** `apps/web` → `apps/api`; delete the desktop UI
   routes (`/`, `/assets`, `/traders`, `/trader`, `/feed`, `/about`,
   `/methodology`, `/analytics`, `/avatar-preview`, `/traders`), keep `/api/*`,
   `/coins/[coin].svg`, `$lib/server`. Update root `package.json` dev script,
   `ecosystem.config.cjs`, and the CLAUDE.md note that points queries at
   `apps/web/...`. **Verify:** `pnpm check`/`build` pass; mobile still gets 200s
   from every endpoint same-origin.
2. **CORS-ready the BFF.** Add permissive-enough CORS on `/api` so the
   cross-origin native client works later without surprise. **Verify:**
   preflight + cross-origin GET succeed from a different origin.
3. **(When live updates wanted) Add one SSE endpoint** on the BFF, fed by the
   worker/DB. Client subscribes via `EventSource` through `client.ts`. **Verify:**
   stream pushes an update on a DB change; auto-reconnects on drop.
4. **(Native phase) Capacitor-ize `apps/mobile`.** Switch to `adapter-static`,
   delete the `+page.server.ts` stubs, add App Manifest + Service Worker
   (Workbox), `@capacitor/core` + platform detection, set `PUBLIC_API_BASE` to
   the deployed `apps/api`. Add ≥1 native capability for guideline 4.2.
   **Verify:** static build runs in the Capacitor shell against the hosted API;
   native feature works on device.

## Open questions for implementation time

- PWA deploy shape: same-origin one-host (simplest) vs. cross-origin-from-day-one
  (pre-tests the exact native code path). Same-origin is fine if `client.ts` is
  always used and CORS is baked in.
- Whether to rename `apps/web` → `apps/api` now or defer until the desktop UI is
  actually stripped.
- Scope of the first cut: strictly REST, or include the SSE stream.

## Sources

- BFF for mobile: <https://dev.to/bulsyusuf/how-to-use-the-backend-for-frontend-pattern-in-your-mobile-app-architecture-1fhi>
- API Gateway vs BFF: <https://www.geeksforgeeks.org/system-design/api-gateway-vs-backend-for-frontend-bff/>
- BFF auth/secrets: <https://blog.gitguardian.com/stop-leaking-api-keys-the-backend-for-frontend-bff-pattern-explained/>
- WebSocket vs SSE vs polling: <https://lukasniessen.com/blog/31-polling-sse-websockets/>
- WebSocket architecture best practices: <https://ably.com/topic/websocket-architecture-best-practices>
- Capacitor PWA docs: <https://capacitorjs.com/docs/web/progressive-web-apps>
- Capacitor vs React Native (2025): <https://nextnative.dev/blog/capacitor-vs-react-native>
