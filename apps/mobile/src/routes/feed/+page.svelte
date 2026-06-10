<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import {
    getLatestFills,
    subscribeLatestFills,
    getTopOpenPositions,
    getMostHeld,
    mergeFills,
    type LatestFill,
    type CategorizedPositions,
    type TopOpenPosition,
    type CategorizedMostHeld,
    type MostHeldRow,
  } from '$lib/api/feed';
  import { coinDisplayName, coinIconUrl, coinIconBg } from '$lib/utils/coin';
  import {
    shortAddress,
    effigyUrl,
    formatUsd,
    formatPnl,
    formatPct,
    formatLeverage,
    formatRelativeTime,
    pnlSignClass,
  } from '$lib/utils/format';

  type Tab = 'trades' | 'positions' | 'sentiment';

  let tab = $state<Tab>('trades');
  let fills = $state<LatestFill[]>([]);
  let positions = $state<CategorizedPositions | null>(null);
  let mostHeld = $state<CategorizedMostHeld | null>(null);
  let loading = $state(true);
  let errorMsg = $state<string | null>(null);
  let pollTimer: ReturnType<typeof setTimeout> | null = null;
  let stopTrades: (() => void) | null = null;
  let mounted = false;
  let abortCtrl: AbortController | null = null;

  const POLL_MS = 10_000;

  async function load(opts: { silent?: boolean } = {}) {
    abortCtrl?.abort();
    abortCtrl = new AbortController();
    if (!opts.silent) loading = true;
    errorMsg = null;
    try {
      const [latest, top, held] = await Promise.all([
        getLatestFills(),
        getTopOpenPositions(),
        getMostHeld(),
      ]);
      fills = mergeFills(latest);
      positions = top;
      mostHeld = held;
    } catch (err) {
      errorMsg = (err as Error).message || 'Failed to load feed';
    } finally {
      loading = false;
    }
  }

  /** Background poll for the positions/sentiment tabs only — trades are pushed
   *  live over SSE (see onMount). Refreshes just the active tab's dataset; the
   *  other keeps its last snapshot until the user switches back (the initial
   *  load() already primed all three, so switches stay instant). */
  async function refreshActive() {
    try {
      if (tab === 'positions') positions = await getTopOpenPositions();
      else if (tab === 'sentiment') mostHeld = await getMostHeld();
    } catch {
      // Keep the stale snapshot; the next poll retries.
    }
  }

  function scheduleRefresh() {
    pollTimer = setTimeout(async () => {
      if (document.visibilityState === 'visible') {
        await refreshActive();
      }
      scheduleRefresh();
    }, POLL_MS);
  }

  onMount(() => {
    mounted = true;
    void load();
    scheduleRefresh();
    // Trades arrive live over SSE; positions/sentiment still poll above.
    stopTrades = subscribeLatestFills((f) => {
      fills = mergeFills(f);
    });
  });

  onDestroy(() => {
    if (pollTimer) clearTimeout(pollTimer);
    stopTrades?.();
    abortCtrl?.abort();
  });

  const flatPositions = $derived(
    positions
      ? [...positions.stocks, ...positions.crypto, ...positions.index].sort(
          (a, b) => Math.abs(b.unrealizedPnlUsd) - Math.abs(a.unrealizedPnlUsd),
        )
      : [],
  );

  const sentimentSections = $derived(
    mostHeld
      ? ([
          { label: 'Stock & Commodity', rows: mostHeld.stocks },
          { label: 'Crypto', rows: mostHeld.crypto },
        ] as const).filter((s) => s.rows.length > 0)
      : [],
  );

  /** Green-segment width % for a sentiment bar — long notional as a share of
   *  total directional notional. Falls back to 50/50 when both sides are 0. */
  function longPct(r: MostHeldRow): number {
    const total = r.longNotionalUsd + r.shortNotionalUsd;
    return total > 0 ? (r.longNotionalUsd / total) * 100 : 50;
  }

  /** Current mark price implied by the snapshot — position notional divided
   *  by size, the same mark HL used to value the position. Null when size is
   *  missing. */
  function markPx(p: TopOpenPosition): number | null {
    return p.szBase > 0 ? p.notionalUsd / p.szBase : null;
  }

  /** Compact USD price: full number with thousands separators (no cents) at
   *  ≥ $1000, two decimals below, more for sub-dollar coins. Keeps the
   *  three-column price strip readable on narrow phones. '—' when absent. */
  function fmtPrice(v: number | null): string {
    if (v === null || !Number.isFinite(v)) return '—';
    const abs = Math.abs(v);
    if (abs >= 1) {
      return `$${v.toLocaleString('en-US', { maximumFractionDigits: abs >= 1000 ? 0 : 2 })}`;
    }
    return `$${v.toLocaleString('en-US', { maximumFractionDigits: 4 })}`;
  }
</script>

<svelte:head>
  <title>Feed · Swash</title>
</svelte:head>

<main id="main-content" class="m-page">
  <div class="m-tabs" role="tablist" aria-label="Feed tabs">
    <button
      type="button"
      role="tab"
      aria-selected={tab === 'trades'}
      class="m-tab tappable tap-hit"
      class:is-active={tab === 'trades'}
      onclick={() => (tab = 'trades')}
    >
      Trades
    </button>
    <button
      type="button"
      role="tab"
      aria-selected={tab === 'positions'}
      class="m-tab tappable tap-hit"
      class:is-active={tab === 'positions'}
      onclick={() => (tab = 'positions')}
    >
      Positions
    </button>
    <button
      type="button"
      role="tab"
      aria-selected={tab === 'sentiment'}
      class="m-tab tappable tap-hit"
      class:is-active={tab === 'sentiment'}
      onclick={() => (tab = 'sentiment')}
    >
      Sentiment
    </button>
  </div>

  {#if loading}
    <ul class="m-card-list" aria-busy="true">
      {#each Array(8) as _, i (i)}
        <li class="m-skeleton-row">
          <span class="m-skeleton m-skeleton-avatar"></span>
          <span class="m-skeleton-main">
            <span class="m-skeleton m-skeleton-line"></span>
            <span class="m-skeleton m-skeleton-line-sm"></span>
          </span>
        </li>
      {/each}
    </ul>
  {:else if errorMsg}
    <div class="m-error safe-x" role="alert">
      <p>{errorMsg}</p>
      <button type="button" class="m-error-retry m-btn tappable" onclick={() => load()}>
        Retry
      </button>
    </div>
  {:else if tab === 'trades'}
    {#if fills.length === 0}
      <div class="m-empty safe-x">No trades yet.</div>
    {:else}
      <ul class="m-card-list">
        {#each fills.slice(0, 60) as f (f.key)}
          <li>
            <a class="m-feed-row tappable-row" href={`/trader/${f.address}`}>
              <img
                class="m-feed-avatar"
                src={effigyUrl(f.address)}
                alt=""
                loading="lazy"
              />
              <div class="m-feed-main">
                <div class="m-feed-line-1">
                  <span class="m-feed-address">{shortAddress(f.address, 4, 4)}</span>
                  <!-- A raw fill only tells us buy/sell — a sell can be closing a
                       long, so labeling it "short" would mislead. -->
                  <span class="m-feed-action {f.side === 'B' ? 'is-buy' : 'is-sell'}">
                    {f.side === 'B' ? 'buy' : 'sell'}
                  </span>
                  <span class="m-feed-coin">
                    {#if coinIconUrl(f.coin)}
                      <img src={coinIconUrl(f.coin)} style:background-color={coinIconBg(f.coin)} style:padding={coinIconBg(f.coin) ? '2px' : null} alt="" loading="lazy" />
                    {/if}
                    {coinDisplayName(f.coin)}
                  </span>
                </div>
                <div class="m-feed-line-2">
                  {formatUsd(f.notionalUsd)}
                  {#if f.leverage}· {f.leverage}x{/if}
                  · {formatRelativeTime(new Date(f.blockTimeMs))}
                </div>
              </div>
            </a>
          </li>
        {/each}
      </ul>
    {/if}
  {:else if tab === 'positions'}
    {#if flatPositions.length === 0}
      <div class="m-empty safe-x">No open positions reported.</div>
    {:else}
      <ul class="m-pos-cards">
        {#each flatPositions.slice(0, 40) as p, i (p.address + p.coin + i)}
          {@const cur = markPx(p)}
          <li>
            <a
              class="m-pos-card {p.side === 'long' ? 'is-long' : 'is-short'}"
              href={`/trader/${p.address}`}
            >
              <div class="m-pos-head">
                <img class="m-pos-avatar" src={effigyUrl(p.address)} alt="" loading="lazy" />
                <div class="m-pos-id">
                  <div class="m-pos-addr">{shortAddress(p.address, 4, 4)}</div>
                  <div class="m-pos-meta">
                    <span class="m-pos-side {p.side === 'long' ? 'is-long' : 'is-short'}">
                      {p.side}{formatLeverage(p.leverage) ? ` ${formatLeverage(p.leverage)}` : ''}
                    </span>
                    <span class="m-pos-cn">
                      {#if coinIconUrl(p.coin)}
                        <img src={coinIconUrl(p.coin)} style:background-color={coinIconBg(p.coin)} style:padding={coinIconBg(p.coin) ? '2px' : null} alt="" loading="lazy" />
                      {/if}
                      {coinDisplayName(p.coin)}
                    </span>
                  </div>
                </div>
                <div class="m-pos-metrics">
                  {#if p.returnOnEquity !== null}
                    <div class="m-pos-roi {pnlSignClass(p.returnOnEquity)}">
                      {p.returnOnEquity >= 0 ? '+' : ''}{formatPct(p.returnOnEquity)}
                    </div>
                  {/if}
                  <div class="m-pos-pnl {pnlSignClass(p.unrealizedPnlUsd)}">
                    {formatPnl(p.unrealizedPnlUsd)}
                  </div>
                </div>
              </div>

              <div class="m-pos-grid">
                <div class="m-pos-cell">
                  <span class="m-pos-cell-label">entry</span>
                  <span class="m-pos-cell-val">{fmtPrice(p.entryPxUsd)}</span>
                </div>
                <div class="m-pos-cell">
                  <span class="m-pos-cell-label">current</span>
                  <span class="m-pos-cell-val {pnlSignClass(p.unrealizedPnlUsd)}">{fmtPrice(cur)}</span>
                </div>
                <div class="m-pos-cell">
                  <span class="m-pos-cell-label">liq. price</span>
                  <span class="m-pos-cell-val is-liq">{fmtPrice(p.liquidationPxUsd)}</span>
                </div>
              </div>

              <div class="m-pos-notional">
                <span class="m-pos-cell-label">position size</span>
                <span class="m-pos-notional-val">{formatUsd(p.notionalUsd)}</span>
              </div>
            </a>
          </li>
        {/each}
      </ul>
    {/if}
  {:else if sentimentSections.length === 0}
    <div class="m-empty safe-x">No positions to summarize.</div>
  {:else}
    <div class="m-sentiment">
      {#each sentimentSections as section (section.label)}
        <h2 class="m-sent-head safe-x">{section.label}</h2>
        <ul class="m-list">
          {#each section.rows as r (r.coin)}
            <li class="m-sent-row">
              <div class="m-sent-top">
                <span class="m-feed-coin">
                  {#if coinIconUrl(r.coin)}
                    <img src={coinIconUrl(r.coin)} style:background-color={coinIconBg(r.coin)} style:padding={coinIconBg(r.coin) ? '2px' : null} alt="" loading="lazy" />
                  {/if}
                  {coinDisplayName(r.coin)}
                </span>
                <!-- $ at stake is the primary measure (it's what the bar is
                     weighted by); trader counts are the secondary read below. -->
                <span class="m-sent-notionals">
                  <span class="is-long">{formatUsd(r.longNotionalUsd)} long</span>
                  <span class="m-sent-sep">·</span>
                  <span class="is-short">{formatUsd(r.shortNotionalUsd)} short</span>
                </span>
              </div>
              <div
                class="m-sent-bar"
                role="img"
                aria-label={`${formatUsd(r.longNotionalUsd)} long vs ${formatUsd(r.shortNotionalUsd)} short, by ${r.longCount} long and ${r.shortCount} short traders`}
              >
                <span class="m-sent-bar-long" style:width={`${longPct(r)}%`}></span>
                <span class="m-sent-bar-short" style:width={`${100 - longPct(r)}%`}></span>
              </div>
              <div class="m-sent-foot">
                <span>{r.longCount} {r.longCount === 1 ? 'trader' : 'traders'} long</span>
                <span>{r.shortCount} short</span>
              </div>
            </li>
          {/each}
        </ul>
      {/each}
    </div>
  {/if}
</main>

<style>
  .m-page {
    display: flex;
    flex-direction: column;
    min-height: 100vh;
    padding-top: var(--space-3);
    padding-bottom: calc(var(--safe-bottom) + 80px);
  }

  /* Feed tabs — glass container, same language as the nav and filter rows.
     The tabs split the container width equally (flex: 1 on .m-tab). */
  .m-tabs {
    display: flex;
    gap: var(--space-1);
    margin: 0 max(var(--safe-left), var(--space-4)) var(--space-3);
    padding: var(--space-1);
    background: var(--glass-bg);
    -webkit-backdrop-filter: var(--glass-blur);
    backdrop-filter: var(--glass-blur);
    border-radius: var(--radius-xl);
    box-shadow: var(--glass-highlight);
  }

  .m-tab {
    flex: 1 1 0;
    min-height: 32px;
    padding: 6px 14px;
    border-radius: var(--radius-lg);
    background: transparent;
    color: var(--stripe-text-secondary);
    font-family: var(--font-mono);
    font-size: var(--type-footnote);
    cursor: pointer;
  }

  /* Active = pressed into the container's glass surface. */
  .m-tab.is-active {
    background: var(--glass-pressed-bg);
    box-shadow: var(--glass-pressed-inset);
    color: var(--stripe-text-primary);
  }

  .m-feed-row {
    min-height: var(--touch-comfortable);
    padding: var(--space-3) var(--space-4);
    gap: var(--space-3);
    color: inherit;
    text-decoration: none;
    align-items: center;
    background: var(--glass-bg);
    border-radius: var(--radius-md);
  }

  .m-feed-avatar {
    width: 36px;
    height: 36px;
    flex: 0 0 36px;
    border-radius: var(--radius-full);
    background: var(--stripe-bg-secondary);
    border: 1px solid var(--stripe-border-light);
    box-shadow: var(--glass-shadow);
  }

  .m-feed-main {
    flex: 1 1 auto;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .m-feed-line-1 {
    display: flex;
    align-items: center;
    gap: 6px;
    font-family: var(--font-mono);
    font-size: var(--type-callout);
    color: var(--stripe-text-primary);
    overflow: hidden;
    white-space: nowrap;
  }

  .m-feed-address {
    color: var(--stripe-text-secondary);
  }

  .m-feed-action {
    text-transform: lowercase;
    font-family: var(--font-mono);
    font-size: var(--type-caption);
  }
  .m-feed-action.is-buy {
    color: var(--stripe-success);
  }
  .m-feed-action.is-sell {
    color: var(--stripe-danger);
  }

  .m-feed-coin {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    color: var(--stripe-text-primary);
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .m-feed-coin img {
    width: 14px;
    height: 14px;
    border-radius: var(--radius-full);
  }

  .m-feed-line-2 {
    font-family: var(--font-mono);
    font-variant-numeric: tabular-nums;
    font-size: var(--type-caption);
    color: var(--stripe-text-tertiary);
  }

  /* ── Position cards ─────────────────────────────────────────────────── */
  .m-pos-cards {
    list-style: none;
    margin: 0;
    padding: 0;
  }

  .m-pos-card {
    display: block;
    box-sizing: border-box;
    margin: 0 max(var(--safe-left), var(--space-4)) var(--space-3);
    padding: var(--space-3) var(--space-4) var(--space-4);
    background: var(--glass-bg);
    -webkit-backdrop-filter: var(--glass-blur);
    backdrop-filter: var(--glass-blur);
    border-radius: var(--radius-xl);
    box-shadow: var(--glass-highlight);
    border-left: 3px solid transparent;
    color: inherit;
    text-decoration: none;
    -webkit-tap-highlight-color: transparent;
    touch-action: manipulation;
    transition: background-color var(--motion-fast) var(--motion-ease);
  }
  .m-pos-card:active {
    background-color: var(--tap-feedback-bg);
  }
  .m-pos-card.is-long {
    border-left-color: var(--stripe-success);
  }
  .m-pos-card.is-short {
    border-left-color: var(--stripe-danger);
  }

  .m-pos-head {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    min-width: 0;
  }

  .m-pos-avatar {
    width: 40px;
    height: 40px;
    flex: 0 0 40px;
    border-radius: var(--radius-full);
    background: var(--stripe-bg-secondary);
    border: 1px solid var(--stripe-border-light);
    box-shadow: var(--glass-shadow);
  }

  .m-pos-id {
    flex: 1 1 auto;
    min-width: 0;
  }

  .m-pos-addr {
    font-family: var(--font-mono);
    font-size: var(--type-body);
    font-weight: 600;
    color: var(--stripe-text-primary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .m-pos-meta {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-top: 3px;
    font-family: var(--font-mono);
    font-size: var(--type-footnote);
    color: var(--stripe-text-secondary);
    overflow: hidden;
    white-space: nowrap;
  }
  .m-pos-side {
    padding: 1px 8px;
    border-radius: var(--radius-sm);
    text-transform: lowercase;
  }
  .m-pos-side.is-long {
    background: var(--stripe-success-subtle);
    color: var(--stripe-success);
  }
  .m-pos-side.is-short {
    background: var(--stripe-danger-subtle);
    color: var(--stripe-danger);
  }
  .m-pos-cn {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    color: var(--stripe-text-primary);
  }
  .m-pos-cn img {
    width: 14px;
    height: 14px;
    border-radius: var(--radius-full);
  }

  /* Right metric column — ROI (hero) with PnL echoed beneath it. */
  .m-pos-metrics {
    flex: 0 0 auto;
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 1px;
  }
  .m-pos-roi {
    font-family: var(--font-mono);
    font-variant-numeric: tabular-nums;
    /* Scale the hero number with viewport width so the longest values
       (e.g. +874.5%) still fit on narrow phones. */
    font-size: clamp(var(--type-body), 5.2vw, var(--type-title));
    font-weight: 600;
    white-space: nowrap;
    color: var(--stripe-text-primary);
  }
  .m-pos-roi:global(.k-pnl-positive) {
    color: var(--stripe-success);
  }
  .m-pos-roi:global(.k-pnl-negative) {
    color: var(--stripe-danger);
  }
  .m-pos-pnl {
    font-family: var(--font-mono);
    font-variant-numeric: tabular-nums;
    font-size: var(--type-footnote);
    white-space: nowrap;
    opacity: 0.85;
    color: var(--stripe-text-tertiary);
  }
  .m-pos-pnl:global(.k-pnl-positive) {
    color: var(--stripe-success);
  }
  .m-pos-pnl:global(.k-pnl-negative) {
    color: var(--stripe-danger);
  }

  /* entry · current · liq price strip — three equal columns, hairline above. */
  .m-pos-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: var(--space-2);
    margin-top: var(--space-3);
    padding-top: var(--space-3);
    border-top: 1px solid var(--stripe-border);
  }
  .m-pos-cell {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }
  .m-pos-cell-label {
    font-family: var(--font-sans);
    font-size: var(--type-caption);
    color: var(--stripe-text-tertiary);
  }
  .m-pos-cell-val {
    font-family: var(--font-mono);
    font-variant-numeric: tabular-nums;
    font-size: var(--type-subhead);
    color: var(--stripe-text-primary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .m-pos-cell-val.is-liq {
    color: var(--stripe-danger);
  }
  .m-pos-cell-val:global(.k-pnl-positive) {
    color: var(--stripe-success);
  }
  .m-pos-cell-val:global(.k-pnl-negative) {
    color: var(--stripe-danger);
  }

  .m-pos-notional {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
    margin-top: var(--space-3);
    padding-top: var(--space-3);
    border-top: 1px solid var(--stripe-border);
  }
  .m-pos-notional-val {
    font-family: var(--font-mono);
    font-variant-numeric: tabular-nums;
    font-size: var(--type-subhead);
    font-weight: 600;
    color: var(--stripe-text-primary);
  }

  /* ── Sentiment ──────────────────────────────────────────────────────── */
  .m-sent-head {
    font-family: var(--font-sans);
    font-size: var(--type-footnote);
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--stripe-text-secondary);
    margin: var(--space-4) 0 var(--space-2);
  }
  .m-sentiment > .m-list:not(:last-child) {
    margin-bottom: var(--space-2);
  }

  .m-sent-row {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: var(--space-3) var(--space-4);
  }

  .m-sent-top {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
    font-family: var(--font-mono);
    font-size: var(--type-callout);
  }

  .m-sent-notionals {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-variant-numeric: tabular-nums;
    font-size: var(--type-footnote);
    font-weight: 600;
    white-space: nowrap;
  }
  .m-sent-sep {
    color: var(--stripe-text-tertiary);
  }
  .is-long {
    color: var(--stripe-success);
  }
  .is-short {
    color: var(--stripe-danger);
  }

  /* Dollar-weighted long/short bar — green | red, proportional to notional. */
  .m-sent-bar {
    display: flex;
    height: 8px;
    border-radius: var(--radius-full);
    overflow: hidden;
    background: var(--stripe-bg-secondary);
  }
  .m-sent-bar-long {
    background: var(--stripe-success);
  }
  .m-sent-bar-short {
    background: var(--stripe-danger);
  }

  .m-sent-foot {
    display: flex;
    align-items: center;
    justify-content: space-between;
    font-family: var(--font-mono);
    font-variant-numeric: tabular-nums;
    font-size: var(--type-caption);
    color: var(--stripe-text-tertiary);
  }

  /* Skeleton bones and error/empty states come from the shared layer in
     lib/styles/mobile.css. */
</style>
