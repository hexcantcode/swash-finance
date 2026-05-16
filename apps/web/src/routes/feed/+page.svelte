<script lang="ts">
  import { onMount } from 'svelte';
  import { flip } from 'svelte/animate';
  import { coinDisplayName, coinIconUrl, coinNeedsWhiteBg } from '$lib/utils/coin';
  import {
    effigyUrl,
    formatLeverage,
    formatPnl,
    formatRelativeTime,
    pnlSignClass,
    truncateAddress,
  } from '$lib/utils/format';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();

  // Sentiment cards poll a lightweight endpoint so the long/short bars
  // update without a page reload. The underlying `leader_cache.positions_json`
  // is refreshed by the worker every 60 s (REST `leader-cache-poll`) plus
  // sub-second for the hot subset (ws-live-subscriber), so a 20 s poll
  // surfaces those updates with at most a third of a refresh cycle of lag.
  let categoryBreakdown = $state(data.categoryBreakdown);
  const SENTIMENT_POLL_MS = 20_000;

  // Latest-trades panel polls a separate endpoint at a faster cadence (10 s)
  // because the underlying `fills` table grows on every WS-pushed fill —
  // bursts can land a new trade every few seconds during active hours, so
  // a slower poll would miss the live feel. The `animate:flip` directive on
  // each row makes existing rows slide down when a new trade pushes in
  // rather than the table snapping to its new state.
  let latestFills = $state(data.latestFills);
  const LATEST_TRADES_POLL_MS = 10_000;

  // Top open positions ("Winning Trades" panel) — ranked by unrealized PnL
  // desc across every tracked wallet's `leader_cache.positions_json`. The
  // underlying JSONB updates whenever the worker writes (≤ 60 s for the
  // REST broad-cohort path, sub-second for the WS hot subset), and PnL
  // moves shuffle the ranking continuously. 20 s cadence + animate:flip
  // makes re-ranks visible as smooth row-shuffles rather than a jump cut.
  let topOpenPositions = $state(data.topOpenPositions);
  const TOP_POSITIONS_POLL_MS = 20_000;

  // Position matrix — heaviest of the live panels (touches HL
  // `metaAndAssetCtxs` weight 20 + JSONB unpack of 25 traders'
  // positions_json). 60 s cadence keeps the combined HL draw with
  // leader-cache-poll under HL's 1200 weight/min/IP budget. Underlying
  // JSONB also only refreshes at ≤ 60 s (leader-cache-poll cycle), so
  // faster polling wouldn't surface fresher data.
  let matrix = $state(data.matrix);
  const MATRIX_POLL_MS = 60_000;

  function hideBrokenAvatar(e: Event) {
    const img = e.currentTarget as HTMLImageElement;
    img.style.visibility = 'hidden';
  }

  /** Map cell's pct-of-book → matrix tint opacity. Clamp so a tiny position
   *  still shows up but the strongest cells peg at 1.0. */
  function cellOpacity(pctOfBook: number): number {
    if (!Number.isFinite(pctOfBook) || pctOfBook <= 0) return 0.25;
    return Math.max(0.25, Math.min(1, 0.25 + pctOfBook * 0.75));
  }

  function cellTitle(
    coin: string,
    c: { side: string; notionalUsd: number; pctOfBook: number; unrealizedPnlUsd: number },
  ): string {
    const pct = (c.pctOfBook * 100).toFixed(0);
    return `${coinDisplayName(coin)} · ${c.side} · ${formatPnl(c.notionalUsd)} · ${pct}% of book · uPnL ${formatPnl(c.unrealizedPnlUsd)}`;
  }

  function fmtPctInt(n: number): string {
    if (!Number.isFinite(n)) return '—';
    return Math.round(n) + '%';
  }

  // ── Top-of-page sentiment: server returns one CategoryPositionBreakdown
  // per category (`stocks` = Stock & Commodity + folded Index; `crypto`).
  // Translate notional + trader counts into long/short percentages for the
  // two stacked bars (Size + Traders). 50/50 fallback when nothing's open
  // so the empty track still reads as balanced rather than collapsed.
  //
  // Bias chip on each card blends the two signals — notional (how big the
  // bets are) + trader count (how many people) — so neither a whale nor a
  // mob alone can swing the label.
  type BiasState = 'ex-bull' | 'bull' | 'neutral' | 'bear' | 'ex-bear';
  function classifyBias(blendedLongShare: number): { state: BiasState; label: string } {
    if (blendedLongShare >= 0.75) return { state: 'ex-bull', label: 'Extremely bullish' };
    if (blendedLongShare >= 0.6) return { state: 'bull', label: 'Bullish' };
    if (blendedLongShare > 0.4) return { state: 'neutral', label: 'Neutral' };
    if (blendedLongShare > 0.25) return { state: 'bear', label: 'Bearish' };
    return { state: 'ex-bear', label: 'Extremely bearish' };
  }
  const sentimentCards = $derived(
    categoryBreakdown.map((cb) => {
      const totalNot = cb.long.notionalUsd + cb.short.notionalUsd;
      const totalTr = cb.long.traders + cb.short.traders;
      const longNotPct = totalNot > 0 ? (cb.long.notionalUsd / totalNot) * 100 : 50;
      const shortNotPct = 100 - longNotPct;
      const longTrPct = totalTr > 0 ? (cb.long.traders / totalTr) * 100 : 50;
      const shortTrPct = 100 - longTrPct;
      const hasData = totalNot > 0 || totalTr > 0;
      // Blend = simple average of long-share by notional and by trader count.
      // Empty bucket → 0.5 (neutral).
      const blendedLongShare = hasData ? (longNotPct + longTrPct) / 200 : 0.5;
      const bias = classifyBias(blendedLongShare);
      return {
        category: cb.category,
        label: cb.category === 'stocks' ? 'Stock & Commodity' : 'Crypto',
        long: cb.long,
        short: cb.short,
        longNotPct,
        shortNotPct,
        longTrPct,
        shortTrPct,
        hasData,
        biasState: bias.state,
        biasLabel: bias.label,
      };
    }),
  );

  onMount(() => {
    let cancelled = false;
    const tickSentiment = async () => {
      if (cancelled) return;
      try {
        const r = await fetch('/api/analytics/sentiment');
        if (!r.ok) return;
        const j = (await r.json()) as {
          ok: boolean;
          categoryBreakdown: typeof data.categoryBreakdown;
        };
        if (j?.ok && Array.isArray(j.categoryBreakdown)) {
          categoryBreakdown = j.categoryBreakdown;
        }
      } catch {
        /* ignore transient poll failures; next tick will retry */
      }
    };
    const tickLatestTrades = async () => {
      if (cancelled) return;
      try {
        const r = await fetch('/api/analytics/latest-trades');
        if (!r.ok) return;
        const j = (await r.json()) as {
          ok: boolean;
          latestFills: typeof data.latestFills;
        };
        if (
          j?.ok &&
          j.latestFills &&
          Array.isArray(j.latestFills.stocks) &&
          Array.isArray(j.latestFills.crypto)
        ) {
          latestFills = j.latestFills;
        }
      } catch {
        /* ignore transient poll failures; next tick will retry */
      }
    };
    const tickTopOpenPositions = async () => {
      if (cancelled) return;
      try {
        const r = await fetch('/api/analytics/top-open-positions');
        if (!r.ok) return;
        const j = (await r.json()) as {
          ok: boolean;
          topOpenPositions: typeof data.topOpenPositions;
        };
        if (
          j?.ok &&
          j.topOpenPositions &&
          Array.isArray(j.topOpenPositions.stocks) &&
          Array.isArray(j.topOpenPositions.crypto)
        ) {
          topOpenPositions = j.topOpenPositions;
        }
      } catch {
        /* ignore transient poll failures; next tick will retry */
      }
    };
    const tickMatrix = async () => {
      if (cancelled) return;
      try {
        const r = await fetch('/api/analytics/position-matrix');
        if (!r.ok) return;
        const j = (await r.json()) as { ok: boolean; matrix: typeof data.matrix };
        if (
          j?.ok &&
          j.matrix &&
          Array.isArray(j.matrix.traders) &&
          Array.isArray(j.matrix.coins)
        ) {
          matrix = j.matrix;
        }
      } catch {
        /* ignore transient poll failures; next tick will retry */
      }
    };
    const sentimentId = setInterval(tickSentiment, SENTIMENT_POLL_MS);
    const latestTradesId = setInterval(tickLatestTrades, LATEST_TRADES_POLL_MS);
    const topPositionsId = setInterval(tickTopOpenPositions, TOP_POSITIONS_POLL_MS);
    const matrixId = setInterval(tickMatrix, MATRIX_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(sentimentId);
      clearInterval(latestTradesId);
      clearInterval(topPositionsId);
      clearInterval(matrixId);
    };
  });
</script>

<svelte:head><title>Feed — Swash</title></svelte:head>

<main id="main-content" class="stripe-content">
  <h1 class="sr-only">Feed</h1>
  <!-- 1. Tracked-trader sentiment ──────────────────────────────── -->
  <section class="k-trader-section" style="margin-top: var(--space-4);">
    <div class="k-section-head">
      <h2 class="k-section-title">
        Tracked sentiment
        <span class="k-section-sub">long vs short across every open position</span>
      </h2>
    </div>
    <div class="k-winners-losers">
      {#each sentimentCards as s (s.category)}
        <div class="k-mini-table k-sentiment-card">
          <div class="k-mini-table-head k-sentiment-head">
            <span>{s.label}</span>
            {#if s.hasData}
              <span class="k-sentiment-bias k-sentiment-bias--{s.biasState}">{s.biasLabel}</span>
            {/if}
          </div>
          {#if !s.hasData}
            <div class="k-empty">no open positions in this bucket yet</div>
          {:else}
            <div class="k-sentiment-stack">
              <div class="k-sentiment-bar">
                <div class="k-sentiment-label">Size</div>
                <div
                  class="k-sentiment-track"
                  role="img"
                  aria-label="{fmtPctInt(s.longNotPct)} long, {fmtPctInt(s.shortNotPct)} short by notional"
                >
                  <span class="k-sentiment-fill k-sentiment-long" style:width="{s.longNotPct}%"></span>
                  <span class="k-sentiment-fill k-sentiment-short" style:width="{s.shortNotPct}%"></span>
                </div>
                <div class="k-sentiment-foot">
                  <span class="k-sentiment-foot-left">
                    <span class="k-pnl-positive">{formatPnl(s.long.notionalUsd)}</span>
                    <span class="k-sentiment-foot-sub">{fmtPctInt(s.longNotPct)} LONG</span>
                  </span>
                  <span class="k-sentiment-foot-right">
                    <span class="k-sentiment-foot-sub">{fmtPctInt(s.shortNotPct)} SHORT</span>
                    <span class="k-pnl-negative">{formatPnl(s.short.notionalUsd)}</span>
                  </span>
                </div>
              </div>
              <div class="k-sentiment-bar">
                <div class="k-sentiment-label">Traders</div>
                <div
                  class="k-sentiment-track"
                  role="img"
                  aria-label="{s.long.traders} long, {s.short.traders} short"
                >
                  <span class="k-sentiment-fill k-sentiment-long" style:width="{s.longTrPct}%"></span>
                  <span class="k-sentiment-fill k-sentiment-short" style:width="{s.shortTrPct}%"></span>
                </div>
                <div class="k-sentiment-foot">
                  <span class="k-sentiment-foot-left">
                    <span class="k-pnl-positive">{s.long.traders}</span>
                    <span class="k-sentiment-foot-sub">{fmtPctInt(s.longTrPct)} LONG</span>
                  </span>
                  <span class="k-sentiment-foot-right">
                    <span class="k-sentiment-foot-sub">{fmtPctInt(s.shortTrPct)} SHORT</span>
                    <span class="k-pnl-negative">{s.short.traders}</span>
                  </span>
                </div>
              </div>
            </div>
          {/if}
        </div>
      {/each}
    </div>
  </section>

  <!-- 1b. Most-Held coins (per-category top 5 by holder count) ───── -->
  {#snippet mostHeldPanel(rows: typeof data.mostHeld.stocks)}
    <div class="k-mini-table" role="list">
      <div class="k-mini-table-head k-mini-table-head-row">
        <h3 class="k-mini-table-head-title">Most Held</h3>
        <span class="k-mini-table-head-label k-most-held-direction-head">Long / Short</span>
      </div>
      {#if rows.length === 0}
        <div class="k-empty">no open positions in this bucket</div>
      {:else}
        {#each rows as r (r.coin)}
          <a
            class="k-mini-table-row k-mini-table-row--coin"
            href="/assets/{r.coin}"
            title="{coinDisplayName(r.coin)} · {r.longCount} long, {r.shortCount} short · net {formatPnl(r.netNotionalUsd)}"
          >
            <img
              src={coinIconUrl(r.coin)}
              alt=""
              loading="lazy"
              onerror={hideBrokenAvatar}
              class="k-coin-icon k-most-held-icon"
              class:is-white-bg={coinNeedsWhiteBg(r.coin)}
            />
            <span class="k-most-held-coin">{coinDisplayName(r.coin)}</span>
            <span class="k-most-held-direction">
              <span class="k-most-held-long">
                <span aria-hidden="true">↑</span>
                <span class="sr-only">long</span>
                {r.longCount}
              </span>
              <span class="k-most-held-short">
                <span aria-hidden="true">↓</span>
                <span class="sr-only">short</span>
                {r.shortCount}
              </span>
            </span>
          </a>
        {/each}
      {/if}
    </div>
  {/snippet}

  <section class="k-trader-section">
    <div class="k-categorized-panels">
      <div class="k-category-column">
        <div class="k-category-header">Stocks &amp; Commodities</div>
        {@render mostHeldPanel(data.mostHeld.stocks)}
      </div>
      <div class="k-category-column">
        <div class="k-category-header">Crypto</div>
        {@render mostHeldPanel(data.mostHeld.crypto)}
      </div>
    </div>
  </section>

  <!-- 2. Latest trades + Winning Trades, split by category ──────── -->
  <!-- Stocks/commodities on the left, crypto on the right; each column
       carries both panels stacked vertically. The two snippets below
       render the panel shape once and get reused per-category — keeps
       the markup compact and the four panels visually identical. -->
  {#snippet latestTradesPanel(fills: typeof data.latestFills.stocks)}
    <div class="k-mini-table" role="list">
      <div class="k-mini-table-head k-mini-table-head-row k-mini-table-head-row--split">
        <h3 class="k-mini-table-head-title">Latest trades</h3>
        <span class="k-mini-table-head-label k-mini-table-lev">Leverage</span>
        <span class="k-mini-table-head-label k-mini-table-val">Size</span>
        <span class="k-mini-table-head-label k-mini-table-chg">Time</span>
      </div>
      {#if fills.length === 0}
        <div class="k-empty">no recent trades</div>
      {:else}
        {#each fills as f (f.key)}
          <div class="k-mini-table-row k-mini-table-row--split" role="listitem" animate:flip={{ duration: 400 }}>
            <a
              class="k-mini-table-seg k-mini-table-seg-trader"
              href="/trader/{f.address}"
              title="View trader {truncateAddress(f.address)}"
              aria-label="View trader {truncateAddress(f.address)}"
            >
              <img
                src={effigyUrl(f.address)}
                alt=""
                loading="lazy"
                onerror={hideBrokenAvatar}
                class="k-coin-icon"
              />
            </a>
            <a
              class="k-mini-table-seg k-mini-table-seg-asset k-mini-table-price"
              href="/assets/{f.coin}"
              title="{f.side === 'B' ? 'bought' : 'sold'} {coinDisplayName(f.coin)} · {f.fillCount} fill{f.fillCount === 1 ? '' : 's'} · VWAP ${f.vwapUsd.toLocaleString('en-US', {maximumFractionDigits: f.vwapUsd >= 1 ? 2 : 6})} · total {formatPnl(f.notionalUsd)}"
            >
              <span class="k-trade-content">
                <img
                  src={coinIconUrl(f.coin)}
                  alt=""
                  loading="lazy"
                  onerror={hideBrokenAvatar}
                  class="k-coin-icon"
                  class:is-white-bg={coinNeedsWhiteBg(f.coin)}
                  class:is-long={f.side === 'B'}
                  class:is-short={f.side === 'A'}
                />
                {coinDisplayName(f.coin)}
              </span>
            </a>
            <span class="k-mini-table-lev">
              {#if f.leverage !== null}
                <span class="k-lev-pill k-lev-pill--{f.side === 'B' ? 'long' : 'short'}"
                  >{formatLeverage(f.leverage)}</span>
              {:else}—{/if}
            </span>
            <span class="k-mini-table-val">
              {formatPnl(f.notionalUsd)}
            </span>
            <span class="k-mini-table-chg k-mini-table-time">
              {formatRelativeTime(new Date(f.blockTimeMs))}
            </span>
          </div>
        {/each}
      {/if}
    </div>
  {/snippet}

  {#snippet winningTradesPanel(positions: typeof data.topOpenPositions.stocks)}
    <div class="k-mini-table" role="list">
      <div class="k-mini-table-head k-mini-table-head-row k-mini-table-head-row--split">
        <h3 class="k-mini-table-head-title">Winning Trades</h3>
        <span class="k-mini-table-head-label k-mini-table-lev">Leverage</span>
        <span class="k-mini-table-head-label k-mini-table-val">Value</span>
        <span class="k-mini-table-head-label k-mini-table-chg">Profit</span>
      </div>
      {#if positions.length === 0}
        <div class="k-empty">no open positions</div>
      {:else}
        {#each positions as p (`${p.address}|${p.coin}`)}
          <div
            class="k-mini-table-row k-mini-table-row--split"
            role="listitem"
            animate:flip={{ duration: 400 }}
          >
            <a
              class="k-mini-table-seg k-mini-table-seg-trader"
              href="/trader/{p.address}"
              title="View trader {truncateAddress(p.address)}"
              aria-label="View trader {truncateAddress(p.address)}"
            >
              <img
                src={effigyUrl(p.address)}
                alt=""
                loading="lazy"
                onerror={hideBrokenAvatar}
                class="k-coin-icon"
              />
            </a>
            <a
              class="k-mini-table-seg k-mini-table-seg-asset k-mini-table-price"
              href="/assets/{p.coin}"
              title="{p.side} {coinDisplayName(p.coin)} · {formatPnl(p.notionalUsd)} notional · realized {formatPnl(p.realizedPnlUsd)} · uPnL {formatPnl(p.unrealizedPnlUsd)}"
            >
              <span class="k-trade-content">
                <img
                  src={coinIconUrl(p.coin)}
                  alt=""
                  loading="lazy"
                  onerror={hideBrokenAvatar}
                  class="k-coin-icon"
                  class:is-white-bg={coinNeedsWhiteBg(p.coin)}
                  class:is-long={p.side === 'long'}
                  class:is-short={p.side === 'short'}
                />
                {coinDisplayName(p.coin)}
              </span>
            </a>
            <span class="k-mini-table-lev">
              {#if p.leverage > 0}
                <span class="k-lev-pill k-lev-pill--{p.side}"
                  >{formatLeverage(p.leverage)}</span>
              {:else}—{/if}
            </span>
            <span class="k-mini-table-val">
              {formatPnl(p.notionalUsd)}
            </span>
            <span class="k-mini-table-chg {pnlSignClass(p.realizedPnlUsd + p.unrealizedPnlUsd)}">
              {formatPnl(p.realizedPnlUsd + p.unrealizedPnlUsd)}
            </span>
          </div>
        {/each}
      {/if}
    </div>
  {/snippet}

  <section class="k-trader-section">
    <div class="k-categorized-panels">
      <div class="k-category-column">
        <div class="k-category-header">Stocks &amp; Commodities</div>
        {@render latestTradesPanel(latestFills.stocks)}
        {@render winningTradesPanel(topOpenPositions.stocks)}
      </div>
      <div class="k-category-column">
        <div class="k-category-header">Crypto</div>
        {@render latestTradesPanel(latestFills.crypto)}
        {@render winningTradesPanel(topOpenPositions.crypto)}
      </div>
    </div>
  </section>

  <!-- 2. Position matrix ───────────────────────────────────────── -->
  <section class="k-trader-section">
    <div class="k-section-head">
      <h2 class="k-section-title">
        Position matrix
        <span class="k-section-sub">
          {matrix.coins.length} coins (by 24h volume) × {matrix.traders.length} tracked traders
        </span>
      </h2>
    </div>
    {#if matrix.traders.length === 0 || matrix.coins.length === 0}
      <p class="k-empty">No tracked traders are currently holding overlapping positions.</p>
    {:else}
      <!-- Trader rows down the left (small avatar + truncated address + score
           badge), coin columns across the top (icon only, volume-ranked).
           Cell key: `${address}|${coin}`. -->
      <div class="k-matrix-wrap">
        <table class="k-matrix">
          <thead>
            <tr>
              <th class="k-matrix-rowhead"></th>
              {#each matrix.coins as c (c.coin)}
                <th
                  class="k-matrix-colhead"
                  title="{coinDisplayName(c.coin)} · {c.holders} {c.holders === 1 ? 'holder' : 'holders'} · net {formatPnl(c.netNotionalUsd)}"
                >
                  <a class="k-matrix-coinchip" href="/assets/{c.coin}" aria-label={coinDisplayName(c.coin)}>
                    <img
                      src={coinIconUrl(c.coin)}
                      alt=""
                      loading="lazy"
                      onerror={hideBrokenAvatar}
                      class="k-matrix-icon"
                      class:is-white-bg={coinNeedsWhiteBg(c.coin)}
                    />
                  </a>
                </th>
              {/each}
            </tr>
          </thead>
          <tbody>
            {#each matrix.traders as t (t.address)}
              <tr>
                <th class="k-matrix-rowhead">
                  <a
                    class="k-matrix-traderrow"
                    href="/trader/{t.address}"
                    title="Trader {truncateAddress(t.address)}"
                    aria-label="Trader {truncateAddress(t.address)}"
                  >
                    <img
                      src={effigyUrl(t.address)}
                      alt=""
                      loading="lazy"
                      onerror={hideBrokenAvatar}
                      class="k-matrix-traderavatar"
                    />
                  </a>
                </th>
                {#each matrix.coins as c (c.coin)}
                  {@const cell = matrix.cells[`${t.address}|${c.coin}`]}
                  <td
                    class="k-matrix-cell"
                    class:k-cell-long={cell?.side === 'long'}
                    class:k-cell-short={cell?.side === 'short'}
                    style={cell ? `--k-cell-opacity:${cellOpacity(cell.pctOfBook)}` : ''}
                    title={cell
                      ? `${truncateAddress(t.address)} · ${cellTitle(c.coin, cell)}`
                      : `${truncateAddress(t.address)} · ${coinDisplayName(c.coin)}: no position`}
                  ></td>
                {/each}
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {/if}
  </section>

</main>
