<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { page } from '$app/stores';
  import MobileSparkline from '$lib/components/MobileSparkline.svelte';
  import {
    getAsset,
    getCandles,
    CANDLE_RANGES,
    type Candle,
    type CandleRange,
  } from '$lib/api/asset-detail';
  import type { Asset } from '$lib/api/assets';
  import { coinDisplayName, coinIconUrl, coinNeedsWhiteBg } from '$lib/utils/coin';
  import {
    formatUsd,
    formatPct,
    formatNumber,
    pnlSignClass,
  } from '$lib/utils/format';

  const coin = $derived($page.params['coin'] ?? '');

  let asset = $state<Asset | null>(null);
  let candles = $state<Candle[]>([]);
  let range = $state<CandleRange>('1d');
  let loading = $state(true);
  let chartLoading = $state(false);
  let errorMsg = $state<string | null>(null);
  let mounted = false;
  let assetCtrl: AbortController | null = null;
  let candleCtrl: AbortController | null = null;

  async function loadAsset() {
    if (!coin) return;
    assetCtrl?.abort();
    assetCtrl = new AbortController();
    loading = true;
    errorMsg = null;
    try {
      asset = await getAsset(coin);
      if (!asset) errorMsg = `No market named “${coin}”.`;
    } catch (err) {
      errorMsg = (err as Error).message || 'Failed to load asset';
    } finally {
      loading = false;
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

  onMount(() => {
    mounted = true;
    void loadAsset();
    void loadCandles();
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
  });

  const trend = $derived(asset?.change24h ?? null);
  const trendClass = $derived(pnlSignClass(trend));
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
    <div class="m-asset-hero-icon" class:is-white={coinNeedsWhiteBg(coin)}>
      {#if coinIconUrl(coin)}
        <img src={coinIconUrl(coin)} alt="" />
      {/if}
    </div>
    <div class="m-asset-hero-name">{displayName}</div>

    {#if loading}
      <div class="m-skeleton m-asset-hero-price-skel"></div>
    {:else if asset}
      <div class="m-asset-hero-price">
        {formatUsd(asset.price, { precise: (asset.price ?? 0) < 100 })}
      </div>
      <div class="m-asset-hero-change {trendClass}">
        {formatPct(asset.change24h)} · 24h
      </div>
    {:else if errorMsg}
      <p class="m-asset-hero-error">{errorMsg}</p>
    {/if}
  </section>

  <section class="m-chart safe-x" aria-label="Price chart">
    <div class="m-chart-frame" class:is-loading={chartLoading}>
      <MobileSparkline {candles} height={160} />
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
    <section class="m-asset-stats safe-x" aria-label="Market stats">
      <div class="m-stat">
        <div class="m-stat-label">Volume 24h</div>
        <div class="m-stat-value">{formatUsd(asset.volume24h)}</div>
      </div>
      <div class="m-stat">
        <div class="m-stat-label">Open interest</div>
        <div class="m-stat-value">{formatUsd(asset.openInterestUsd)}</div>
      </div>
      <div class="m-stat">
        <div class="m-stat-label">Funding</div>
        <div class="m-stat-value">
          {asset.funding !== null ? formatPct(asset.funding * 24, 3) : '—'}
        </div>
      </div>
      <div class="m-stat">
        <div class="m-stat-label">Max leverage</div>
        <div class="m-stat-value">
          {asset.maxLeverage ? `${asset.maxLeverage}x` : '—'}
        </div>
      </div>
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
    width: var(--touch-min);
    height: var(--touch-min);
    border-radius: var(--radius-full);
    color: var(--stripe-text-primary);
    text-decoration: none;
    background: transparent;
    border: none;
  }

  .m-asset-hero {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-1);
    padding-top: var(--space-3);
    padding-bottom: var(--space-5);
  }

  .m-asset-hero-icon {
    width: 64px;
    height: 64px;
    border-radius: var(--radius-full);
    background: var(--stripe-bg-secondary);
    overflow: hidden;
    margin-bottom: var(--space-2);
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
    color: var(--stripe-text-secondary);
  }

  .m-asset-hero-price {
    font-family: var(--font-mono);
    font-variant-numeric: tabular-nums;
    font-size: 36px;
    line-height: 1.1;
    color: var(--stripe-text-primary);
    font-weight: 600;
  }

  .m-asset-hero-price-skel {
    width: 180px;
    height: 36px;
  }

  .m-asset-hero-change {
    font-family: var(--font-mono);
    font-size: var(--type-callout);
    color: var(--stripe-text-tertiary);
    margin-top: 4px;
  }
  .m-asset-hero-change:global(.k-pnl-positive) {
    color: var(--stripe-success);
  }
  .m-asset-hero-change:global(.k-pnl-negative) {
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

  .m-chart-frame {
    border: 1px solid var(--stripe-border);
    border-radius: var(--radius-md);
    background: var(--stripe-bg-secondary);
    padding: var(--space-3);
    transition: opacity var(--motion-fast) var(--motion-ease);
  }
  .m-chart-frame.is-loading {
    opacity: 0.6;
  }

  .m-range-strip {
    display: flex;
    gap: var(--space-2);
    margin-top: var(--space-3);
    overflow-x: auto;
    scrollbar-width: none;
  }
  .m-range-strip::-webkit-scrollbar {
    display: none;
  }

  .m-range-chip {
    flex: 1 1 0;
    min-width: 56px;
    min-height: 36px;
    padding: 6px 12px;
    background: var(--stripe-bg-secondary);
    color: var(--stripe-text-secondary);
    border: 0.5px solid var(--stripe-border);
    border-radius: var(--radius-md);
    font-family: var(--font-mono);
    font-size: var(--type-footnote);
    cursor: pointer;
  }

  .m-range-chip.is-active {
    background: var(--stripe-accent-subtle);
    color: var(--stripe-accent);
    border-color: var(--stripe-accent);
  }

  .m-asset-stats {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: var(--space-3);
    padding-top: var(--space-4);
    padding-bottom: var(--space-4);
  }

  .m-stat {
    background: var(--stripe-bg-secondary);
    border: 1px solid var(--stripe-border);
    border-radius: var(--radius-md);
    padding: var(--space-3);
    min-height: 64px;
  }

  .m-stat-label {
    font-family: var(--font-mono);
    font-size: 10px;
    color: var(--stripe-text-tertiary);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  .m-stat-value {
    font-family: var(--font-mono);
    font-variant-numeric: tabular-nums;
    font-size: var(--type-headline);
    color: var(--stripe-text-primary);
    margin-top: 4px;
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
