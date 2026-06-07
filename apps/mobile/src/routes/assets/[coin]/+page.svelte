<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { page } from '$app/stores';
  import MobilePriceChart from '$lib/components/MobilePriceChart.svelte';
  import {
    getAsset,
    getCandles,
    getTopTraders,
    getLatestOpens,
    CANDLE_RANGES,
    type Candle,
    type CandleRange,
    type TopTrader,
    type TraderOpen,
  } from '$lib/api/asset-detail';
  import type { Asset } from '$lib/api/assets';
  import { coinDisplayName, coinIconUrl, coinNeedsWhiteBg, coinIconBg } from '$lib/utils/coin';
  import {
    formatUsd,
    formatPct,
    formatPnl,
    formatRelativeTime,
    shortAddress,
    effigyUrl,
    pnlSignClass,
  } from '$lib/utils/format';

  const coin = $derived($page.params['coin'] ?? '');

  let asset = $state<Asset | null>(null);
  let candles = $state<Candle[]>([]);
  // A standalone 30d series used only to derive the 1W/1M price changes — the
  // assets API only carries the 1D (24h) change. Independent of the chart's
  // selected range so toggling the chart doesn't disturb the header figures.
  let changeCandles = $state<Candle[]>([]);
  let range = $state<CandleRange>('1d');
  let chartMode = $state<'line' | 'candle'>('line');
  let hovered = $state<{ price: number; time: number } | null>(null);
  let tab = $state<'traders' | 'trades'>('traders');
  let topTraders = $state<TopTrader[]>([]);
  let latestOpens = $state<TraderOpen[]>([]);

  // The crosshair time is a UTC second-timestamp. Show enough granularity to
  // place the point: a date plus hour:minute, no year (the range is short).
  function formatHoverTime(seconds: number): string {
    return new Date(seconds * 1000).toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }
  let chartLoading = $state(false);
  let errorMsg = $state<string | null>(null);
  let mounted = false;
  let assetCtrl: AbortController | null = null;
  let candleCtrl: AbortController | null = null;

  async function loadAsset() {
    if (!coin) return;
    assetCtrl?.abort();
    assetCtrl = new AbortController();
    errorMsg = null;
    try {
      asset = await getAsset(coin);
      if (!asset) errorMsg = `No market named “${coin}”.`;
    } catch (err) {
      errorMsg = (err as Error).message || 'Failed to load asset';
    }
  }

  async function loadCandles() {
    if (!coin) return;
    candleCtrl?.abort();
    candleCtrl = new AbortController();
    chartLoading = true;
    try {
      candles = await getCandles(coin, range);
    } catch {
      // Chart errors are non-fatal — the page still shows stats. Keep the
      // previous candles so a quick range toggle doesn't blank the chart.
    } finally {
      chartLoading = false;
    }
  }

  async function loadChangeCandles() {
    if (!coin) return;
    try {
      changeCandles = await getCandles(coin, '30d');
    } catch {
      // Non-fatal — the 1W/1M figures fall back to "—".
    }
  }

  async function loadTraders() {
    if (!coin) return;
    try {
      [topTraders, latestOpens] = await Promise.all([
        getTopTraders(coin),
        getLatestOpens(coin),
      ]);
    } catch {
      // Non-fatal — the tabs show their empty state.
    }
  }

  onMount(() => {
    mounted = true;
    void loadAsset();
    void loadCandles();
    void loadChangeCandles();
    void loadTraders();
  });

  onDestroy(() => {
    assetCtrl?.abort();
    candleCtrl?.abort();
  });

  // Re-fetch candles when range changes (debounced via the effect re-run).
  $effect(() => {
    if (!mounted) return;
    void range;
    void loadCandles();
  });

  // Re-fetch everything if the route changes to a different coin (deep-link
  // from one asset page to another).
  $effect(() => {
    if (!mounted) return;
    void coin;
    void loadAsset();
    void loadCandles();
    void loadChangeCandles();
    void loadTraders();
  });

  /** Percent change of the latest close vs the close `lookbackMs` earlier,
   *  using the candle at or just before that target time. Returns a decimal
   *  (0.042 = +4.2%), or null if the series can't cover the window. */
  function windowChange(series: Candle[], lookbackMs: number): number | null {
    if (series.length < 2) return null;
    const last = series[series.length - 1]!;
    const target = last.t - lookbackMs;
    let ref = series[0]!;
    for (const c of series) {
      if (c.t <= target) ref = c;
      else break;
    }
    if (!ref.c) return null;
    return (last.c - ref.c) / ref.c;
  }

  const DAY_MS = 24 * 60 * 60 * 1000;
  // 1D is the canonical 24h field; 1W/1M are derived from the 30d series.
  const change1d = $derived(asset?.change24h ?? null);
  const change1w = $derived(windowChange(changeCandles, 7 * DAY_MS));
  const change1m = $derived(windowChange(changeCandles, 30 * DAY_MS));
  const displayName = $derived(coinDisplayName(coin));
</script>

<svelte:head>
  <title>{displayName} · Swash</title>
</svelte:head>

<main id="main-content" class="m-page">
  <header class="m-detail-header safe-x">
    <a href="/assets" class="m-back tappable" aria-label="Back to assets">
      <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="m15 18-6-6 6-6" />
      </svg>
    </a>
    <h1 class="sr-only">{displayName}</h1>
  </header>

  <section class="m-asset-hero safe-x">
    <div class="m-asset-hero-id">
      <div class="m-asset-hero-icon" class:is-white={coinNeedsWhiteBg(coin)} style:background-color={coinIconBg(coin)} style:padding={coinIconBg(coin) ? '6px' : null}>
        {#if coinIconUrl(coin)}
          <img src={coinIconUrl(coin)} alt="" />
        {/if}
      </div>
      <div class="m-asset-hero-meta">
        <div class="m-asset-hero-name">{displayName}</div>
        <div class="m-asset-hero-ticker">{asset?.symbol ?? displayName}</div>
        {#if errorMsg}
          <p class="m-asset-hero-error">{errorMsg}</p>
        {/if}
      </div>
    </div>

    {#if asset}
      <div class="m-asset-hero-changes">
        <div class="m-change-row">
          <span class="m-change-label">1D</span>
          <span class="m-change-val {pnlSignClass(change1d)}">{formatPct(change1d)}</span>
        </div>
        <div class="m-change-row">
          <span class="m-change-label">1W</span>
          <span class="m-change-val {pnlSignClass(change1w)}">
            {change1w !== null ? formatPct(change1w) : '—'}
          </span>
        </div>
        <div class="m-change-row">
          <span class="m-change-label">1M</span>
          <span class="m-change-val {pnlSignClass(change1m)}">
            {change1m !== null ? formatPct(change1m) : '—'}
          </span>
        </div>
      </div>
    {/if}
  </section>

  <section class="m-chart safe-x" aria-label="Price chart">
    <div class="m-chart-head">
      <div class="m-chart-readout" aria-live="polite">
        {#if hovered}
          <span class="m-chart-readout-price">
            {formatUsd(hovered.price, { precise: hovered.price < 100 })}
          </span>
          <span class="m-chart-readout-time">{formatHoverTime(hovered.time)}</span>
        {:else if asset}
          <span class="m-chart-readout-price">
            {formatUsd(asset.price, { precise: (asset.price ?? 0) < 100 })}
          </span>
        {/if}
      </div>
      <div class="m-chart-mode" role="group" aria-label="Chart type">
        <button
          type="button"
          class="m-chart-mode-btn tappable"
          class:is-active={chartMode === 'line'}
          aria-pressed={chartMode === 'line'}
          onclick={() => (chartMode = 'line')}
        >
          Line
        </button>
        <button
          type="button"
          class="m-chart-mode-btn tappable"
          class:is-active={chartMode === 'candle'}
          aria-pressed={chartMode === 'candle'}
          onclick={() => (chartMode = 'candle')}
        >
          Candles
        </button>
      </div>
    </div>
    <div class="m-chart-frame" class:is-loading={chartLoading}>
      <MobilePriceChart
        {candles}
        height={200}
        mode={chartMode}
        onhover={(h) => (hovered = h)}
      />
    </div>
    <div class="m-range-strip" role="tablist" aria-label="Chart range">
      {#each CANDLE_RANGES as r (r.value)}
        <button
          type="button"
          role="tab"
          aria-selected={range === r.value}
          class="m-range-chip tappable"
          class:is-active={range === r.value}
          onclick={() => (range = r.value)}
        >
          {r.label}
        </button>
      {/each}
    </div>
  </section>

  {#if asset}
    <section class="m-asset-tabs safe-x" aria-label="Traders">
      <div class="m-tab-bar" role="tablist" aria-label="Trader view">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'traders'}
          class="m-tab tappable"
          class:is-active={tab === 'traders'}
          onclick={() => (tab = 'traders')}
        >
          Top traders
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'trades'}
          class="m-tab tappable"
          class:is-active={tab === 'trades'}
          onclick={() => (tab = 'trades')}
        >
          Latest trades
        </button>
      </div>

      {#if tab === 'traders'}
        <div class="m-trader-list">
          {#each topTraders as t (t.address)}
            <a class="m-trader-row tappable-row" href={`/trader/${t.address}`}>
              <img class="m-trader-avatar" src={effigyUrl(t.address)} alt="" loading="lazy" />
              <div class="m-trader-copy">
                <span class="m-trader-address">{shortAddress(t.address)}</span>
                <span class="m-trader-sub">{t.tradeCount} trades</span>
              </div>
              <div class="m-trader-stats">
                <span class="m-trader-pnl {pnlSignClass(t.totalPnlUsd)}">{formatPnl(t.totalPnlUsd)}</span>
                <span class="m-trader-roi {pnlSignClass(t.roi)}">
                  {t.roi !== null ? formatPct(t.roi) : '—'}
                </span>
              </div>
            </a>
          {:else}
            <p class="m-trader-empty">No closed trades on {displayName} yet.</p>
          {/each}
        </div>
      {:else}
        <div class="m-trader-list">
          {#each latestOpens as o, i (`${o.address}-${o.blockTimeMs}-${i}`)}
            <a class="m-trader-row tappable-row" href={`/trader/${o.address}`}>
              <img class="m-trader-avatar" src={effigyUrl(o.address)} alt="" loading="lazy" />
              <div class="m-trader-copy">
                <span class="m-trader-address">{shortAddress(o.address)}</span>
                <span
                  class="m-trade-side"
                  class:is-long={o.side === 'B'}
                  class:is-short={o.side === 'A'}
                >
                  {o.side === 'B' ? 'Long' : 'Short'}
                </span>
              </div>
              <div class="m-trader-stats">
                <span class="m-trader-pnl">{formatUsd(o.pxUsd, { precise: o.pxUsd < 100 })}</span>
                <span class="m-trader-roi">{formatRelativeTime(new Date(o.blockTimeMs))}</span>
              </div>
            </a>
          {:else}
            <p class="m-trader-empty">No recent opens on {displayName}.</p>
          {/each}
        </div>
      {/if}
    </section>

    <section class="m-detail-section safe-x">
      <p class="m-section-blurb">
        Tap <a href="/feed" class="m-inline-link">Feed</a> to see live trades across
        all markets, or <a href={`/traders?search=${encodeURIComponent(coin)}`} class="m-inline-link">
          search Traders for {displayName}
        </a> to find wallets active here.
      </p>
    </section>
  {/if}
</main>

<style>
  .m-page {
    display: flex;
    flex-direction: column;
    min-height: 100vh;
    padding-bottom: calc(var(--safe-bottom) + 80px);
  }

  .m-detail-header {
    padding-top: var(--space-2);
    padding-bottom: var(--space-2);
    display: flex;
    align-items: center;
  }

  .m-back {
    width: 40px;
    height: 40px;
    min-width: 40px;
    min-height: 40px;
    border-radius: var(--radius-md);
    color: var(--stripe-text-primary);
    text-decoration: none;
    background: var(--glass-bg);
    -webkit-backdrop-filter: var(--glass-blur);
    backdrop-filter: var(--glass-blur);
    border: 1px solid var(--stripe-border);
    box-shadow: var(--glass-highlight);
  }

  /* Identity on the left, the 1D/1W/1M change stack on the right. */
  .m-asset-hero {
    display: flex;
    flex-direction: row;
    align-items: flex-start;
    justify-content: space-between;
    gap: var(--space-3);
    padding-top: var(--space-3);
    padding-bottom: var(--space-5);
  }

  .m-asset-hero-id {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    min-width: 0;
  }

  .m-asset-hero-meta {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }

  .m-asset-hero-icon {
    width: 56px;
    height: 56px;
    min-width: 56px;
    border-radius: var(--radius-full);
    background: var(--stripe-bg-secondary);
    box-shadow: var(--glass-shadow);
    overflow: hidden;
  }
  .m-asset-hero-icon.is-white {
    background: #fff;
  }
  .m-asset-hero-icon img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .m-asset-hero-name {
    font-family: var(--font-mono);
    font-size: var(--type-title);
    line-height: 1.15;
    color: var(--stripe-text-primary);
  }

  .m-asset-hero-ticker {
    font-family: var(--font-mono);
    font-size: var(--type-footnote);
    color: var(--stripe-text-tertiary);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  /* Right-side changes — three small columns pinned to the top right, each a
     label stacked above its signed percent. */
  .m-asset-hero-changes {
    display: flex;
    flex-direction: row;
    gap: var(--space-3);
    align-items: flex-start;
  }

  .m-change-row {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 1px;
  }

  .m-change-label {
    font-family: var(--font-mono);
    font-size: 9px;
    color: var(--stripe-text-tertiary);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  .m-change-val {
    font-family: var(--font-mono);
    font-variant-numeric: tabular-nums;
    font-size: var(--type-caption);
    color: var(--stripe-text-secondary);
    text-align: center;
  }
  .m-change-val:global(.k-pnl-positive) {
    color: var(--stripe-success);
  }
  .m-change-val:global(.k-pnl-negative) {
    color: var(--stripe-danger);
  }

  .m-asset-hero-error {
    color: var(--stripe-danger);
    font-family: var(--font-mono);
    font-size: var(--type-footnote);
  }

  .m-chart {
    padding-bottom: var(--space-3);
  }

  /* No frame — the chart canvas is transparent, so it sits directly on the
     app's page background. */
  .m-chart-frame {
    transition: opacity var(--motion-fast) var(--motion-ease);
  }
  .m-chart-frame.is-loading {
    opacity: 0.6;
  }

  /* Header row above the chart: hover readout on the left, type switch on the
     right. */
  .m-chart-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
    min-height: 32px;
    margin-bottom: var(--space-2);
  }

  /* Price + time under the crosshair. Reserves its line height even when empty
     so the chart below doesn't jump as the readout appears/disappears. */
  .m-chart-readout {
    display: flex;
    align-items: baseline;
    gap: var(--space-2);
    min-height: 20px;
    font-family: var(--font-mono);
    font-variant-numeric: tabular-nums;
  }
  .m-chart-readout-price {
    font-size: var(--type-headline);
    color: var(--stripe-text-primary);
  }
  .m-chart-readout-time {
    font-size: var(--type-caption);
    color: var(--stripe-text-tertiary);
  }

  /* Line/Candle switch — glass pill, same language as the range chips. */
  .m-chart-mode {
    display: flex;
    gap: 2px;
    padding: 2px;
    background: var(--glass-bg);
    -webkit-backdrop-filter: var(--glass-blur);
    backdrop-filter: var(--glass-blur);
    border-radius: var(--radius-lg);
    box-shadow: var(--glass-highlight);
  }

  .m-chart-mode-btn {
    min-height: 28px;
    padding: 4px 10px;
    border-radius: var(--radius-md);
    background: transparent;
    color: var(--stripe-text-tertiary);
    font-family: var(--font-mono);
    font-size: var(--type-caption);
    cursor: pointer;
  }

  /* Active = pressed into the pill's glass surface (no outline border). */
  .m-chart-mode-btn.is-active {
    background: var(--glass-pressed-bg);
    box-shadow: var(--glass-pressed-inset);
    color: var(--stripe-text-primary);
  }

  /* Range strip — glass container, same language as the nav and filter rows.
     Lives inside .m-chart's safe-x padding, so it only needs internal padding. */
  .m-range-strip {
    display: flex;
    gap: var(--space-1);
    margin-top: var(--space-3);
    overflow-x: auto;
    overflow-y: hidden;
    scrollbar-width: none;
    padding: var(--space-1);
    background: var(--glass-bg);
    -webkit-backdrop-filter: var(--glass-blur);
    backdrop-filter: var(--glass-blur);
    border-radius: var(--radius-xl);
    box-shadow: var(--glass-highlight);
  }
  .m-range-strip::-webkit-scrollbar {
    display: none;
  }

  .m-range-chip {
    flex: 1 1 0;
    min-width: 56px;
    min-height: 32px;
    padding: 6px 12px;
    border-radius: var(--radius-lg);
    background: transparent;
    color: var(--stripe-text-secondary);
    font-family: var(--font-mono);
    font-size: var(--type-footnote);
    cursor: pointer;
  }

  /* Active = pressed into the container's glass surface. */
  .m-range-chip.is-active {
    background: var(--glass-pressed-bg);
    box-shadow: var(--glass-pressed-inset);
    color: var(--stripe-text-primary);
  }

  .m-asset-tabs {
    padding-top: var(--space-4);
    padding-bottom: var(--space-4);
  }

  /* Tab bar — glass pill, same language as the chart's range strip. */
  .m-tab-bar {
    display: flex;
    gap: var(--space-1);
    margin-bottom: var(--space-3);
    padding: var(--space-1);
    background: var(--glass-bg);
    -webkit-backdrop-filter: var(--glass-blur);
    backdrop-filter: var(--glass-blur);
    border-radius: var(--radius-xl);
    box-shadow: var(--glass-highlight);
  }

  .m-tab {
    flex: 1 1 0;
    min-height: 36px;
    padding: 8px 12px;
    border-radius: var(--radius-lg);
    background: transparent;
    color: var(--stripe-text-secondary);
    font-family: var(--font-mono);
    font-size: var(--type-footnote);
    cursor: pointer;
  }
  /* Active = pressed into the bar's glass surface (no outline border). */
  .m-tab.is-active {
    background: var(--glass-pressed-bg);
    box-shadow: var(--glass-pressed-inset);
    color: var(--stripe-text-primary);
  }

  .m-trader-list {
    display: flex;
    flex-direction: column;
  }

  .m-trader-row {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    min-height: var(--touch-comfortable);
    padding: var(--space-2) var(--space-1);
    color: inherit;
    text-decoration: none;
    border-bottom: 1px solid var(--stripe-border);
  }
  .m-trader-row:last-child {
    border-bottom: none;
  }

  .m-trader-avatar {
    width: 32px;
    height: 32px;
    flex: 0 0 32px;
    border-radius: var(--radius-full);
    background: var(--stripe-bg-secondary);
  }

  .m-trader-copy {
    flex: 1 1 auto;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .m-trader-address {
    font-family: var(--font-mono);
    font-size: var(--type-body);
    color: var(--stripe-text-primary);
    font-weight: 500;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .m-trader-sub {
    font-family: var(--font-mono);
    font-size: var(--type-caption);
    color: var(--stripe-text-tertiary);
  }

  .m-trade-side {
    font-family: var(--font-mono);
    font-size: var(--type-caption);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .m-trade-side.is-long {
    color: var(--stripe-success);
  }
  .m-trade-side.is-short {
    color: var(--stripe-danger);
  }

  .m-trader-stats {
    flex: 0 0 auto;
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 2px;
    font-family: var(--font-mono);
    font-variant-numeric: tabular-nums;
    text-align: right;
  }

  .m-trader-pnl {
    font-size: var(--type-subhead);
    font-weight: 500;
    color: var(--stripe-text-primary);
  }
  .m-trader-pnl:global(.k-pnl-positive) {
    color: var(--stripe-success);
  }
  .m-trader-pnl:global(.k-pnl-negative) {
    color: var(--stripe-danger);
  }

  .m-trader-roi {
    font-size: var(--type-caption);
    color: var(--stripe-text-tertiary);
  }
  .m-trader-roi:global(.k-pnl-positive) {
    color: var(--stripe-success);
  }
  .m-trader-roi:global(.k-pnl-negative) {
    color: var(--stripe-danger);
  }

  .m-trader-empty {
    font-family: var(--font-mono);
    font-size: var(--type-footnote);
    color: var(--stripe-text-tertiary);
    padding: var(--space-4) 0;
    margin: 0;
    text-align: center;
  }

  .m-detail-section {
    padding-top: var(--space-4);
    padding-bottom: var(--space-5);
    border-top: 1px solid var(--stripe-border);
  }

  .m-section-blurb {
    font-family: var(--font-mono);
    font-size: var(--type-footnote);
    color: var(--stripe-text-secondary);
    line-height: var(--line-body);
    margin: 0;
  }

  .m-inline-link {
    color: var(--stripe-accent);
    text-decoration: underline;
    text-decoration-color: var(--stripe-accent-subtle);
    text-underline-offset: 3px;
  }
</style>
