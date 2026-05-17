<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { page } from '$app/stores';
  import TVChart from '$lib/components/TVChart.svelte';
  import { coinIconUrl, coinNeedsWhiteBg } from '$lib/utils/coin';
  import {
    effigyUrl,
    formatPnl,
    formatRelativeTime,
    pnlSignClass,
    truncateAddress,
  } from '$lib/utils/format';
  import {
    RANGE_KEYS,
    type CandlePoint,
    type OpenPosition,
    type RangeKey,
    type TopTrader,
    type TraderOpen,
  } from '$lib/utils/asset-ranges';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();

  let candles = $state<CandlePoint[]>(data.candles);
  let asset = $state(data.asset);
  let topTraders = $state<TopTrader[]>(data.topTraders);
  let traderOpens = $state<TraderOpen[]>(data.traderOpens);
  let openPositions = $state<OpenPosition[]>(data.openPositions);
  let latestOpens = $state<TraderOpen[]>(data.latestOpens);
  // When the URL changes (range tab → goto → loader re-runs), sync the local
  // state from the new server data. The 12s poll mutates `candles` directly
  // between loader runs.
  $effect(() => {
    candles = data.candles;
    asset = data.asset;
    topTraders = data.topTraders;
    traderOpens = data.traderOpens;
    openPositions = data.openPositions;
    latestOpens = data.latestOpens;
  });
  // Range is driven by the URL search param so it survives reloads + back/fwd.
  const range = $derived<RangeKey>(data.range);

  // Biggest 5 currently-open positions on this coin (long OR short) by
  // absolute notional. Derived from the loader's `openPositions` (capped at
  // 25 in `getOpenPositionsOnAsset`, well above the ~13-holders ceiling we
  // see per coin), so this is just a re-sort of data already on the page —
  // no extra round-trip, one source of truth.
  const topBySize = $derived(
    [...openPositions].sort((a, b) => b.notionalUsd - a.notionalUsd).slice(0, 5),
  );

  // 12s poll for fresh candles within the current range (doesn't re-run the
  // top-traders aggregation — that only updates on a range / page reload).
  async function pullCandles(r: RangeKey) {
    try {
      const u = new URL(`/api/assets/${asset.coin}/candles`, $page.url.origin);
      u.searchParams.set('range', r);
      const res = await fetch(u);
      if (!res.ok) return;
      const j = (await res.json()) as { ok: boolean; candles: CandlePoint[] };
      if (j.ok) candles = j.candles;
    } catch {
      /* ignore transient poll failures */
    }
  }

  function setRange(r: RangeKey) {
    if (r === range) return;
    const u = new URL($page.url);
    u.searchParams.set('range', r);
    // `replaceState` so the back button doesn't accumulate range flips.
    goto(u, { keepFocus: true, replaceState: true, noScroll: true });
  }

  onMount(() => {
    const id = setInterval(() => pullCandles(range), 12_000);
    return () => clearInterval(id);
  });

  // ── Live price via HL WS `allMids` ──────────────────────────────────
  // Subscribe browser-side; on every tick update `livePrice`, flash the
  // header price, and recompute each open-position's unrealized PnL from
  // the new mark. Per-row flash is driven by a Svelte-reactive map keyed
  // by trader address — animations re-trigger on each tick via the
  // `data-flash-id` attribute below.
  let livePrice = $state<number | null>(null);
  let priceFlash = $state<'up' | 'down' | null>(null);

  /** Resolve "mids[coin]" for the page's coin. HIP-3 coins look like
   *  `dex:SYMBOL`; HL's WS returns mids keyed by the fully-qualified name
   *  on the `dex.SYMBOL` form for those dexes. Try the raw coin first. */
  function readMid(mids: Record<string, string>, coin: string): number | null {
    const direct = mids[coin];
    if (typeof direct === 'string') {
      const n = Number.parseFloat(direct);
      if (Number.isFinite(n)) return n;
    }
    return null;
  }

  onMount(() => {
    let priceFlashTimer: ReturnType<typeof setTimeout> | null = null;
    let ws: WebSocket | null = null;
    let prevLive: number | null = null;

    function connect() {
      ws = new WebSocket('wss://api.hyperliquid.xyz/ws');
      ws.onopen = () => {
        ws?.send(JSON.stringify({ method: 'subscribe', subscription: { type: 'allMids' } }));
      };
      ws.onmessage = (ev) => {
        let msg: unknown;
        try {
          msg = JSON.parse(typeof ev.data === 'string' ? ev.data : '');
        } catch {
          return;
        }
        if (
          typeof msg !== 'object' ||
          msg === null ||
          (msg as { channel?: unknown }).channel !== 'allMids'
        ) {
          return;
        }
        const data = (msg as { data?: { mids?: Record<string, string> } }).data;
        if (!data?.mids) return;
        const px = readMid(data.mids, asset.coin);
        if (px === null) return;

        // ── Header price flash ────────────────────────────────────────
        // Per-row flash on the open-positions table is deliberately *not*
        // wired here — at the user's call those rows stay idle so the
        // section reads like a stable "who's holding what" snapshot. The
        // PnL cells still re-render live via `livePositionPnl` below.
        if (prevLive !== null && px !== prevLive) {
          priceFlash = px > prevLive ? 'up' : 'down';
          if (priceFlashTimer) clearTimeout(priceFlashTimer);
          priceFlashTimer = setTimeout(() => (priceFlash = null), 700);
        }
        prevLive = px;
        livePrice = px;
      };
      ws.onclose = () => {
        // Lazy reconnect — `setTimeout` so we don't tightloop on a refused conn.
        setTimeout(() => {
          if (ws && ws.readyState === WebSocket.CLOSED) connect();
        }, 2_000);
      };
      ws.onerror = () => {
        try { ws?.close(); } catch { /* ignore */ }
      };
    }
    connect();

    return () => {
      if (priceFlashTimer) clearTimeout(priceFlashTimer);
      try {
        if (ws) {
          // Replace onclose so it doesn't fire a reconnect.
          ws.onclose = null;
          ws.close();
        }
      } catch {
        /* ignore */
      }
    };
  });

  /** Live-recomputed unrealized PnL for each open position, keyed by row. */
  const livePositionPnl = $derived.by(() => {
    if (livePrice === null) return new Map<string, number>();
    const m = new Map<string, number>();
    for (const p of openPositions) {
      const signedSz = p.side === 'long' ? p.szBase : -p.szBase;
      m.set(p.address, signedSz * (livePrice - p.entryPxUsd));
    }
    return m;
  });

  // ── Formatting helpers (mirror the assets index page) ────────────────
  function fmtPrice(v: number | null): string {
    if (v === null || !Number.isFinite(v)) return '—';
    if (v === 0) return '$0';
    const abs = Math.abs(v);
    if (abs >= 1000) return '$' + v.toLocaleString('en-US', { maximumFractionDigits: 0 });
    if (abs >= 1) return '$' + v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    if (abs >= 0.01) return '$' + v.toFixed(4);
    return '$' + v.toFixed(8).replace(/0+$/, '');
  }
  function fmtBigUsd(v: number | null): string {
    if (v === null || !Number.isFinite(v)) return '—';
    const abs = Math.abs(v);
    if (abs >= 1e9) return '$' + (v / 1e9).toFixed(2) + 'B';
    if (abs >= 1e6) return '$' + (v / 1e6).toFixed(2) + 'M';
    if (abs >= 1e3) return '$' + (v / 1e3).toFixed(1) + 'K';
    return '$' + v.toFixed(0);
  }
  /** Trader-card ROI: decimal in → "+12.5%" / "−5.2%" / "—". */
  function formatRoi(value: number | null): string {
    if (value === null || value === undefined || !Number.isFinite(value)) return '—';
    const pct = value * 100;
    if (Math.abs(pct) >= 1000) return `${(pct / 100).toFixed(1)}x`;
    if (Math.abs(pct) >= 100) return `${pct.toFixed(0)}%`;
    return `${pct.toFixed(1)}%`;
  }
  function fmtPct(v: number | null, frac = 2): string {
    if (v === null || !Number.isFinite(v)) return '—';
    const p = v * 100;
    const sign = p > 0 ? '+' : '';
    return `${sign}${p.toFixed(frac)}%`;
  }

  function hideBrokenAvatar(e: Event) {
    const img = e.currentTarget as HTMLImageElement;
    img.style.visibility = 'hidden';
  }

  /** Long/short split across the currently-open positions on this coin.
   *  Derived from `openPositions` — no extra query. */
  const sentiment = $derived.by(() => {
    let longNotional = 0;
    let shortNotional = 0;
    let longTraders = 0;
    let shortTraders = 0;
    for (const p of openPositions) {
      if (p.side === 'long') {
        longNotional += p.notionalUsd;
        longTraders += 1;
      } else {
        shortNotional += p.notionalUsd;
        shortTraders += 1;
      }
    }
    const totalNotional = longNotional + shortNotional;
    const totalTraders = longTraders + shortTraders;
    return {
      longNotional,
      shortNotional,
      longTraders,
      shortTraders,
      longNotionalPct: totalNotional > 0 ? (longNotional / totalNotional) * 100 : 0,
      shortNotionalPct: totalNotional > 0 ? (shortNotional / totalNotional) * 100 : 0,
      longTraderPct: totalTraders > 0 ? (longTraders / totalTraders) * 100 : 0,
      shortTraderPct: totalTraders > 0 ? (shortTraders / totalTraders) * 100 : 0,
    };
  });

  function fmtPctInt(v: number): string {
    return Math.round(v) + '%';
  }
  function fmtEntry(v: number): string {
    if (!Number.isFinite(v) || v === 0) return '—';
    return '$' + v.toLocaleString('en-US', { maximumFractionDigits: v >= 1 ? 2 : 6 });
  }
  function fmtRoe(roe: number): string {
    const pct = roe * 100;
    if (Math.abs(pct) >= 100) return pct.toFixed(0) + '%';
    return pct.toFixed(1) + '%';
  }
</script>

<svelte:head>
  <title>{asset.dex ? `${asset.symbol} · ${asset.dex}` : asset.symbol} — Swash</title>
</svelte:head>

<main id="main-content" class="stripe-content">
  <section class="k-trader-section" style="margin-top: var(--space-4);">
    <header class="k-asset-header">
      <a class="k-asset-back" href="/assets" aria-label="Back to all assets">← Assets</a>
      <div class="k-asset-id">
        <img
          src={coinIconUrl(asset.coin)}
          alt=""
          loading="lazy"
          onerror={hideBrokenAvatar}
          class="k-asset-icon"
          class:is-white-bg={coinNeedsWhiteBg(asset.coin)}
        />
        <h1 class="k-asset-symbol">{asset.symbol}</h1>
        {#if asset.maxLeverage}
          <span class="k-asset-leverage">{asset.maxLeverage}×</span>
        {/if}
      </div>
      <div class="k-asset-quote">
        <span
          class="k-asset-price"
          class:k-price-flash-up={priceFlash === 'up'}
          class:k-price-flash-down={priceFlash === 'down'}
        >{fmtPrice(livePrice ?? asset.price)}</span>
        <span class="k-asset-change {pnlSignClass(asset.change24h)}">
          {fmtPct(asset.change24h)}
          <span class="k-asset-change-label">· 24h</span>
        </span>
      </div>
      <dl class="k-asset-meta">
        <div><dt>24h volume</dt><dd>{fmtBigUsd(asset.volume24h)}</dd></div>
        <div><dt>Open interest</dt><dd>{fmtBigUsd(asset.openInterestUsd)}</dd></div>
        <div><dt>Funding · 1h</dt><dd>{fmtPct(asset.funding, 4)}</dd></div>
      </dl>
    </header>
  </section>

  <section class="k-trader-section">
    <div class="k-section-head k-chart-head">
      <h2 class="k-section-title">Price</h2>
      <div class="k-range-tabs" role="tablist" aria-label="Chart range">
        {#each RANGE_KEYS as r (r)}
          <button
            type="button"
            role="tab"
            aria-selected={range === r}
            class="k-range-tab"
            class:is-active={range === r}
            onclick={() => setRange(r)}
          >
            {r}
          </button>
        {/each}
      </div>
    </div>
    <div class="k-chart">
      {#if candles.length < 2}
        <div class="k-chart-empty">No candle data for this range.</div>
      {:else}
        <TVChart {candles} markers={traderOpens} />
      {/if}
    </div>
  </section>

  <section class="k-trader-section">
    <div class="k-section-head">
      <h2 class="k-section-title">Best traders on {asset.symbol}</h2>
    </div>
    {#if topTraders.length === 0}
      <p class="k-empty">No tracked fills on {asset.symbol} yet.</p>
    {:else}
      <div class="k-card-scroll" aria-label="Top 5 traders by realized PnL on {asset.symbol}">
        {#each topTraders as t (t.address)}
          <a class="k-roi-card k-asset-trader-card" href="/trader/{t.address}">
            <div class="k-asset-trader-card-top">
              <img
                src={effigyUrl(t.address)}
                alt=""
                loading="lazy"
                onerror={hideBrokenAvatar}
                class="stripe-avatar stripe-avatar-ring k-roi-card-avatar"
              />
              <span class="k-roi-card-addr">{truncateAddress(t.address)}</span>
            </div>
            <div class="k-asset-trader-card-stats">
              <span class="k-asset-trader-card-pnl {pnlSignClass(t.totalPnlUsd)}">
                {formatPnl(t.totalPnlUsd)}
              </span>
              <span class="k-asset-trader-card-roi {pnlSignClass(t.roi)}">
                {formatRoi(t.roi)}
              </span>
            </div>
          </a>
        {/each}
      </div>
    {/if}
  </section>

  <section class="k-trader-section">
    <div class="k-section-head">
      <h2 class="k-section-title">Biggest positions on {asset.symbol}</h2>
    </div>
    {#if topBySize.length === 0}
      <p class="k-empty">None of the tracked traders currently hold {asset.symbol}.</p>
    {:else}
      <div
        class="k-card-scroll"
        aria-label="Top 5 currently-open positions on {asset.symbol} by notional size"
      >
        {#each topBySize as p (p.address + ':' + p.entryPxUsd)}
          <a class="k-roi-card k-asset-trader-card" href="/trader/{p.address}">
            <div class="k-asset-trader-card-top">
              <img
                src={effigyUrl(p.address)}
                alt=""
                loading="lazy"
                onerror={hideBrokenAvatar}
                class="stripe-avatar stripe-avatar-ring k-roi-card-avatar"
              />
              <span class="k-roi-card-addr">{truncateAddress(p.address)}</span>
            </div>
            <div class="k-asset-trader-card-stats">
              <span
                class="k-asset-trader-card-pnl {p.side === 'long'
                  ? 'k-pnl-positive'
                  : 'k-pnl-negative'}"
                title="{p.side === 'long' ? 'Long' : 'Short'} {formatPnl(p.notionalUsd)}"
              >
                <span class="k-side-arrow k-side-{p.side}" aria-hidden="true"
                  >{p.side === 'long' ? '↑' : '↓'}</span
                >
                {formatPnl(p.notionalUsd)}
              </span>
              <span class="k-asset-trader-card-roi" aria-label="leverage">
                {p.leverage > 0 ? `${p.leverage}×` : '—'}
              </span>
            </div>
          </a>
        {/each}
      </div>
    {/if}
  </section>

  <section class="k-trader-section">
    <div class="k-section-head">
      <h2 class="k-section-title">Consensus</h2>
    </div>
    {#if openPositions.length === 0 && latestOpens.length === 0}
      <p class="k-empty">No tracked-trader activity on {asset.symbol} yet.</p>
    {:else}
      {#if openPositions.length > 0}
        <div class="k-sentiment-stack">
        <div class="k-sentiment-bar">
          <div class="k-sentiment-label">Size</div>
          <div
            class="k-sentiment-track"
            role="img"
            aria-label="{fmtPctInt(sentiment.longNotionalPct)} long, {fmtPctInt(sentiment.shortNotionalPct)} short by notional"
          >
            <span class="k-sentiment-fill k-sentiment-long" style:width="{sentiment.longNotionalPct}%"></span>
            <span class="k-sentiment-fill k-sentiment-short" style:width="{sentiment.shortNotionalPct}%"></span>
          </div>
          <div class="k-sentiment-foot">
            <span class="k-sentiment-foot-left">
              <span class="k-pnl-positive">{formatPnl(sentiment.longNotional)}</span>
              <span class="k-sentiment-foot-sub">{fmtPctInt(sentiment.longNotionalPct)} LONG</span>
            </span>
            <span class="k-sentiment-foot-right">
              <span class="k-sentiment-foot-sub">{fmtPctInt(sentiment.shortNotionalPct)} SHORT</span>
              <span class="k-pnl-negative">{formatPnl(sentiment.shortNotional)}</span>
            </span>
          </div>
        </div>
        <div class="k-sentiment-bar">
          <div class="k-sentiment-label">Traders</div>
          <div
            class="k-sentiment-track"
            role="img"
            aria-label="{sentiment.longTraders} long, {sentiment.shortTraders} short"
          >
            <span class="k-sentiment-fill k-sentiment-long" style:width="{sentiment.longTraderPct}%"></span>
            <span class="k-sentiment-fill k-sentiment-short" style:width="{sentiment.shortTraderPct}%"></span>
          </div>
          <div class="k-sentiment-foot">
            <span class="k-sentiment-foot-left">
              <span class="k-pnl-positive">{sentiment.longTraders}</span>
              <span class="k-sentiment-foot-sub">{fmtPctInt(sentiment.longTraderPct)} LONG</span>
            </span>
            <span class="k-sentiment-foot-right">
              <span class="k-sentiment-foot-sub">{fmtPctInt(sentiment.shortTraderPct)} SHORT</span>
              <span class="k-pnl-negative">{sentiment.shortTraders}</span>
            </span>
          </div>
        </div>
      </div>
      {/if}

      <div class="k-winners-losers">
        <div class="k-mini-table">
          <div class="k-mini-table-head">Open positions · {openPositions.length}</div>
          {#if openPositions.length === 0}
            <div class="k-mini-table-empty">
              None of the tracked traders currently hold {asset.symbol}.
            </div>
          {:else}
            {#each openPositions as p (p.address + ':' + p.entryPxUsd)}
              {@const livePnl = livePositionPnl.get(p.address) ?? p.unrealizedPnlUsd}
              <a class="k-mini-table-row" href="/trader/{p.address}">
                <img
                  src={effigyUrl(p.address)}
                  alt=""
                  loading="lazy"
                  onerror={hideBrokenAvatar}
                  class="k-coin-icon"
                />
                <span class="k-coin-sym k-mini-table-addr">{truncateAddress(p.address)}</span>
                <span class="k-mini-table-price">
                  <span class="k-side-arrow k-side-{p.side}" aria-label={p.side}
                    >{p.side === 'long' ? '↑' : '↓'}</span
                  >
                  {formatPnl(p.notionalUsd)}
                </span>
                <span class="k-mini-table-chg {pnlSignClass(livePnl)}">
                  {formatPnl(livePnl)}
                </span>
              </a>
            {/each}
          {/if}
        </div>

        <div class="k-mini-table">
          <div class="k-mini-table-head">Latest opens · {latestOpens.length}</div>
          {#if latestOpens.length === 0}
            <div class="k-mini-table-empty">No recent opens on {asset.symbol}.</div>
          {:else}
            {#each latestOpens as o (o.address + ':' + o.blockTimeMs)}
              <a class="k-mini-table-row" href="/trader/{o.address}">
                <img
                  src={effigyUrl(o.address)}
                  alt=""
                  loading="lazy"
                  onerror={hideBrokenAvatar}
                  class="k-coin-icon"
                />
                <span class="k-coin-sym k-mini-table-addr">{truncateAddress(o.address)}</span>
                <span class="k-mini-table-price">
                  <span
                    class="k-side-arrow k-side-{o.side === 'B' ? 'long' : 'short'}"
                    aria-label={o.side === 'B' ? 'opened long' : 'opened short'}
                    >{o.side === 'B' ? '↑' : '↓'}</span
                  >
                  {fmtEntry(o.pxUsd)}
                </span>
                <span class="k-mini-table-chg k-mini-table-time">
                  {formatRelativeTime(new Date(o.blockTimeMs))}
                </span>
              </a>
            {/each}
          {/if}
        </div>
      </div>
    {/if}
  </section>
</main>
