<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { page } from '$app/stores';
  import MobilePriceChart from '$lib/components/MobilePriceChart.svelte';
  import MobileMarketSentimentBar from '$lib/components/MobileMarketSentimentBar.svelte';
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
  import { getCohortSentiment, type MarketSentiment } from '$lib/api/feed';
  import { getSmartMarks, type SmartMarks, type SmartMarkTrade } from '$lib/api/smart-marks';
  import type { ChartMark, ChartLink, ChartLevel } from '$lib/components/MobilePriceChart.svelte';
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
    traderName,
  } from '$lib/utils/format';

  const coin = $derived($page.params['coin'] ?? '');

  let asset = $state<Asset | null>(null);
  let candles = $state<Candle[]>([]);
  let range = $state<CandleRange>('1d');
  let chartMode = $state<'line' | 'candle'>('line');
  let hovered = $state<{ price: number; time: number } | null>(null);
  let tab = $state<'traders' | 'trades'>('traders');
  let topTraders = $state<TopTrader[]>([]);
  let latestOpens = $state<TraderOpen[]>([]);
  // Smart-money cohort sentiment for this market, when the cohort feed covers
  // it (it ranks ~top-20 markets by notional; quieter coins won't appear).
  let sentiment = $state<MarketSentiment | null>(null);
  // Smart-money chart layer: EP closed-trade markers + open-position entry
  // levels, toggleable and persisted.
  let smartMarks = $state<SmartMarks | null>(null);
  let smartOn = $state(true);
  // The bucket of trades behind a tapped dot/bundle, shown in the panel.
  let smartBucket = $state<SmartMarkTrade[] | null>(null);

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

  async function loadSentiment() {
    if (!coin) return;
    try {
      const { sentiment: cohort } = await getCohortSentiment();
      const want = coin.toUpperCase();
      sentiment = cohort?.markets.find((m) => m.coin.toUpperCase() === want) ?? null;
    } catch {
      // Non-fatal — the bar just doesn't render.
      sentiment = null;
    }
  }

  async function loadSmartMarks() {
    if (!coin) return;
    try {
      smartMarks = await getSmartMarks(coin);
    } catch {
      // Non-fatal — the chart just renders without the layer.
      smartMarks = null;
    }
  }

  onMount(() => {
    mounted = true;
    smartOn = localStorage.getItem('swash.chart.smartMoney') !== '0';
    void loadAsset();
    void loadCandles();
    void loadTraders();
    void loadSentiment();
    void loadSmartMarks();
  });

  onDestroy(() => {
    assetCtrl?.abort();
    candleCtrl?.abort();
  });

  // Re-fetch candles when range changes (debounced via the effect re-run).
  $effect(() => {
    if (!mounted) return;
    void range;
    smartBucket = null;
    void loadCandles();
  });

  // Re-fetch everything if the route changes to a different coin (deep-link
  // from one asset page to another).
  $effect(() => {
    if (!mounted) return;
    void coin;
    smartBucket = null;
    void loadAsset();
    void loadCandles();
    void loadTraders();
    void loadSentiment();
    void loadSmartMarks();
  });

  // Price move across the chart's currently selected range — first candle's
  // open to the latest close, so it always tracks the visible window.
  const changeSelected = $derived(
    candles.length >= 1 && candles[0]!.o
      ? (candles[candles.length - 1]!.c - candles[0]!.o) / candles[0]!.o
      : null,
  );
  const displayName = $derived(coinDisplayName(coin));

  // ── Smart-money layer ──────────────────────────────────────────────────
  interface SmartLayer {
    marks: ChartMark[];
    links: ChartLink[];
    levels: ChartLevel[];
    /** Mark key → the trades behind that dot/bundle, for the tap panel. */
    buckets: Map<string, SmartMarkTrade[]>;
  }
  const SMART_LAYER_EMPTY: SmartLayer = { marks: [], links: [], levels: [], buckets: new Map() };

  function isLong(t: SmartMarkTrade): boolean {
    return t.direction.toLowerCase() !== 'short';
  }

  /** Dot radius in 3 notional buckets, capped. */
  function dotRadius(notionalUsd: number): number {
    if (notionalUsd >= 1_000_000) return 5.5;
    if (notionalUsd >= 250_000) return 4.5;
    return 3.5;
  }

  /**
   * Turn the raw smart-marks payload into chart primitives for the current
   * candle window: validate each endpoint against its covering candle
   * (Hyperdash randomly corrupts prices — anything outside the candle's
   * [low, high] ±1.5% is dropped), then cluster endpoints per candle bucket
   * (>2 marks in a bucket collapse into one "×N" bundle).
   */
  function buildSmartLayer(cs: Candle[], data: SmartMarks): SmartLayer {
    const step = cs[1]!.t - cs[0]!.t;
    if (step <= 0) return SMART_LAYER_EMPTY;
    const start = cs[0]!.t;
    const end = cs[cs.length - 1]!.t + step;

    const candleAt = (t: number): Candle | null => {
      if (t < start || t >= end) return null;
      const guess = cs[Math.floor((t - start) / step)];
      if (guess && t >= guess.t && t < guess.t + step) return guess;
      // Gaps / irregular spacing: fall back to a scan.
      return cs.find((k) => t >= k.t && t < k.t + step) ?? null;
    };
    const priceOk = (t: number, px: number): boolean => {
      const c = candleAt(t);
      return c !== null && px >= c.l * 0.985 && px <= c.h * 1.015;
    };

    // Validate both endpoints of every trade independently.
    type Endpoint = { tMs: number; pxUsd: number; kind: 'entry' | 'exit'; trade: SmartMarkTrade };
    const byBucket = new Map<number, Endpoint[]>();
    const linkable: SmartMarkTrade[] = [];
    for (const t of data.trades) {
      const entryOk =
        t.openedAtMs !== null && t.entryPxUsd > 0 && priceOk(t.openedAtMs, t.entryPxUsd);
      const exitOk = t.closedAtMs > 0 && t.exitPxUsd > 0 && priceOk(t.closedAtMs, t.exitPxUsd);
      const push = (ep: Endpoint) => {
        const b = Math.floor(ep.tMs / step);
        const list = byBucket.get(b) ?? [];
        list.push(ep);
        byBucket.set(b, list);
      };
      if (entryOk) push({ tMs: t.openedAtMs!, pxUsd: t.entryPxUsd, kind: 'entry', trade: t });
      if (exitOk) push({ tMs: t.closedAtMs, pxUsd: t.exitPxUsd, kind: 'exit', trade: t });
      if (entryOk && exitOk) linkable.push(t);
    }

    const marks: ChartMark[] = [];
    const buckets = new Map<string, SmartMarkTrade[]>();
    const bundled = new Set<number>();
    for (const [b, list] of byBucket) {
      const key = `b${b}`;
      const trades = [...new Set(list.map((ep) => ep.trade))].sort(
        (x, y) => y.notionalUsd - x.notionalUsd,
      );
      buckets.set(key, trades);
      if (list.length > 2) {
        // Bundle: one bubble at the marks' average (time, price), tinted by
        // the bucket's net direction weighted by notional.
        bundled.add(b);
        let tSum = 0;
        let pxSum = 0;
        let net = 0;
        for (const ep of list) {
          tSum += ep.tMs;
          pxSum += ep.pxUsd;
          net += isLong(ep.trade) ? ep.trade.notionalUsd : -ep.trade.notionalUsd;
        }
        marks.push({
          key,
          tMs: tSum / list.length,
          pxUsd: pxSum / list.length,
          tone: net >= 0 ? 'success' : 'danger',
          filled: true,
          r: 9,
          count: list.length,
        });
      } else {
        for (const ep of list) {
          marks.push({
            key,
            tMs: ep.tMs,
            pxUsd: ep.pxUsd,
            // Entry dots are tinted by side, exit rings by win/loss.
            tone:
              ep.kind === 'entry'
                ? isLong(ep.trade)
                  ? 'success'
                  : 'danger'
                : ep.trade.netPnlUsd >= 0
                  ? 'success'
                  : 'danger',
            filled: ep.kind === 'entry',
            r: dotRadius(ep.trade.notionalUsd),
          });
        }
      }
    }

    // Connectors only when both ends render as individual dots.
    const links: ChartLink[] = [];
    for (const t of linkable) {
      if (bundled.has(Math.floor(t.openedAtMs! / step)) || bundled.has(Math.floor(t.closedAtMs / step)))
        continue;
      links.push({
        aTMs: t.openedAtMs!,
        aPxUsd: t.entryPxUsd,
        bTMs: t.closedAtMs,
        bPxUsd: t.exitPxUsd,
        tone: t.netPnlUsd >= 0 ? 'success' : 'danger',
      });
    }

    // Entry levels, sanity-checked against the latest close (same corruption
    // source as the trade prices).
    const levels: ChartLevel[] = [];
    const latestClose = cs[cs.length - 1]!.c;
    for (const side of ['long', 'short'] as const) {
      const l = data.entryLevels[side];
      if (!l || latestClose <= 0) continue;
      if (Math.abs(l.avgPxUsd / latestClose - 1) > 0.3) continue;
      levels.push({
        pxUsd: l.avgPxUsd,
        tone: side === 'long' ? 'success' : 'danger',
        label: `${l.count} ${side} · ${formatUsd(l.avgPxUsd)}`,
      });
    }

    return { marks, links, levels, buckets };
  }

  const smartLayer = $derived.by(() => {
    if (!smartOn || !smartMarks || candles.length < 2) return SMART_LAYER_EMPTY;
    return buildSmartLayer(candles, smartMarks);
  });

  // The toggle chip only appears when the cohort has anything at all here.
  const hasSmartData = $derived(
    smartMarks !== null &&
      (smartMarks.trades.length > 0 ||
        smartMarks.entryLevels.long !== null ||
        smartMarks.entryLevels.short !== null),
  );

  function toggleSmart() {
    smartOn = !smartOn;
    if (!smartOn) smartBucket = null;
    try {
      localStorage.setItem('swash.chart.smartMoney', smartOn ? '1' : '0');
    } catch {
      // Storage can be unavailable (private mode) — the toggle still works.
    }
  }

  function onMarkTap(key: string) {
    smartBucket = smartLayer.buckets.get(key) ?? null;
  }

  /** Entry/exit price in the tap panel — precise below $100k so the entry→exit
   *  delta stays legible (BTC included). */
  function smartPx(px: number): string {
    return formatUsd(px, { precise: px < 100_000 });
  }
</script>

<svelte:head>
  <title>{displayName} · Swash</title>
</svelte:head>

<main id="main-content" class="m-page">
  <h1 class="sr-only">{displayName}</h1>

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

  </section>

  <section class="m-chart safe-x" aria-label="Price chart">
    {#if sentiment}
      <div class="m-chart-sent">
        <MobileMarketSentimentBar m={sentiment} />
      </div>
    {/if}
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
          {#if changeSelected !== null}
            <span class="m-chart-readout-change {pnlSignClass(changeSelected)}">
              {formatPct(changeSelected)}
            </span>
          {/if}
        {/if}
      </div>
      <div class="m-chart-mode" role="group" aria-label="Chart type">
        <button
          type="button"
          class="m-chart-mode-btn tappable tap-hit"
          class:is-active={chartMode === 'line'}
          aria-pressed={chartMode === 'line'}
          onclick={() => (chartMode = 'line')}
        >
          Line
        </button>
        <button
          type="button"
          class="m-chart-mode-btn tappable tap-hit"
          class:is-active={chartMode === 'candle'}
          aria-pressed={chartMode === 'candle'}
          onclick={() => (chartMode = 'candle')}
        >
          Candles
        </button>
      </div>
    </div>
    <!-- svelte-ignore a11y_no_static_element_interactions, a11y_click_events_have_key_events -->
    <div
      class="m-chart-frame"
      class:is-loading={chartLoading}
      onclick={() => (smartBucket = null)}
    >
      <MobilePriceChart
        {candles}
        height={200}
        mode={chartMode}
        marks={smartLayer.marks}
        links={smartLayer.links}
        levels={smartLayer.levels}
        onmarktap={onMarkTap}
        onhover={(h) => (hovered = h)}
      />
    </div>
    <div class="m-range-strip" role="tablist" aria-label="Chart range">
      {#each CANDLE_RANGES as r (r.value)}
        <button
          type="button"
          role="tab"
          aria-selected={range === r.value}
          class="m-range-chip tappable tap-hit"
          class:is-active={range === r.value}
          onclick={() => (range = r.value)}
        >
          {r.label}
        </button>
      {/each}
    </div>
    {#if hasSmartData}
      <div class="m-smart-row">
        <button
          type="button"
          class="m-smart-chip tappable tap-hit"
          class:is-active={smartOn}
          aria-pressed={smartOn}
          onclick={toggleSmart}
        >
          Smart money
        </button>
      </div>
    {/if}
    {#if smartBucket && smartBucket.length > 0}
      <div class="m-smart-panel" role="dialog" aria-label="Smart-money trades at this point">
        <div class="m-smart-panel-head">
          <span class="m-smart-panel-title">
            Smart money · {smartBucket.length} trade{smartBucket.length === 1 ? '' : 's'}
          </span>
          <button
            type="button"
            class="m-smart-panel-close tappable tap-hit"
            aria-label="Close"
            onclick={() => (smartBucket = null)}
          >
            ✕
          </button>
        </div>
        {#each smartBucket as t, i (`${t.address}-${t.closedAtMs}-${i}`)}
          <a class="m-smart-trade tappable-row" href={`/trader/${t.address}`}>
            <div class="m-smart-trade-copy">
              <span class="m-smart-trade-name">{traderName(t.displayName, t.address)}</span>
              <span class="m-smart-trade-line">
                <span
                  class="m-trade-side"
                  class:is-long={isLong(t)}
                  class:is-short={!isLong(t)}
                >
                  {isLong(t) ? 'Long' : 'Short'}
                </span>
                {formatUsd(t.notionalUsd)} · in {smartPx(t.entryPxUsd)} → out {smartPx(t.exitPxUsd)}
              </span>
            </div>
            <div class="m-smart-trade-stats">
              <span class="m-smart-trade-pnl {pnlSignClass(t.netPnlUsd)}">
                {t.netPnlUsd > 0 ? '+' : ''}{formatPnl(t.netPnlUsd)}
              </span>
              <span class="m-smart-trade-time">{formatRelativeTime(new Date(t.closedAtMs))}</span>
            </div>
          </a>
        {/each}
      </div>
    {/if}
  </section>

  {#if asset}
    <section class="m-asset-tabs safe-x" aria-label="Traders">
      <div class="m-tab-bar" role="tablist" aria-label="Trader view">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'traders'}
          class="m-tab tappable tap-hit"
          class:is-active={tab === 'traders'}
          onclick={() => (tab = 'traders')}
        >
          Top traders
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'trades'}
          class="m-tab tappable tap-hit"
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
            <p class="m-trader-empty">No recent trades on {displayName}.</p>
          {/each}
        </div>
      {/if}
    </section>

    <section class="m-detail-section safe-x">
      <p class="m-section-blurb">
        Tap <a href="/feed" class="m-inline-link">Feed</a> to see live trades across
        all markets, or <a href={`/?search=${encodeURIComponent(coin)}`} class="m-inline-link">
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

  .m-asset-hero-error {
    color: var(--stripe-danger);
    font-family: var(--font-mono);
    font-size: var(--type-footnote);
  }

  .m-chart {
    padding-bottom: var(--space-3);
  }

  /* Smart-money sentiment bar above the chart header. */
  .m-chart-sent {
    margin-bottom: var(--space-4);
  }

  /* No frame — the chart canvas is transparent, so it sits directly on the
     app's page background. */
  .m-chart-frame {
    position: relative;
    transition: opacity var(--motion-fast) var(--motion-ease);
  }
  .m-chart-frame.is-loading {
    opacity: 0.6;
  }
  /* A thin dotted midline across the chart's vertical center — a fixed visual
     reference present on every range. Sits over the transparent canvas; the
     crosshair and series still read clearly above it. */
  .m-chart-frame::after {
    content: '';
    position: absolute;
    left: 0;
    right: 0;
    top: 50%;
    border-top: 1px dotted var(--stripe-border);
    pointer-events: none;
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
  .m-chart-readout-change {
    font-size: var(--type-caption);
    color: var(--stripe-text-secondary);
  }
  .m-chart-readout-change:global(.k-pnl-positive) {
    color: var(--stripe-success);
  }
  .m-chart-readout-change:global(.k-pnl-negative) {
    color: var(--stripe-danger);
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

  /* Smart-money layer toggle — a lone glass chip under the range strip. */
  .m-smart-row {
    display: flex;
    margin-top: var(--space-2);
  }

  .m-smart-chip {
    min-height: 28px;
    padding: 4px 12px;
    border-radius: var(--radius-lg);
    background: var(--glass-bg);
    -webkit-backdrop-filter: var(--glass-blur);
    backdrop-filter: var(--glass-blur);
    box-shadow: var(--glass-highlight);
    color: var(--stripe-text-tertiary);
    font-family: var(--font-mono);
    font-size: var(--type-caption);
    cursor: pointer;
  }
  /* On = pressed into the glass, same language as the range chips. */
  .m-smart-chip.is-active {
    background: var(--glass-pressed-bg);
    box-shadow: var(--glass-pressed-inset);
    color: var(--stripe-text-primary);
  }

  /* Tap panel — the trades behind a tapped dot/bundle. Compact glass. */
  .m-smart-panel {
    margin-top: var(--space-3);
    padding: var(--space-2) var(--space-3);
    background: var(--glass-bg);
    -webkit-backdrop-filter: var(--glass-blur);
    backdrop-filter: var(--glass-blur);
    border-radius: var(--radius-xl);
    box-shadow: var(--glass-highlight);
  }

  .m-smart-panel-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
  }

  .m-smart-panel-title {
    font-family: var(--font-mono);
    font-size: var(--type-caption);
    color: var(--stripe-text-tertiary);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  .m-smart-panel-close {
    min-height: 28px;
    padding: 2px 8px;
    border-radius: var(--radius-md);
    background: transparent;
    color: var(--stripe-text-tertiary);
    font-family: var(--font-mono);
    font-size: var(--type-caption);
    cursor: pointer;
  }

  .m-smart-trade {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    min-height: var(--touch-comfortable);
    padding: var(--space-2) 0;
    color: inherit;
    text-decoration: none;
    border-top: 1px solid var(--stripe-border);
  }
  .m-smart-trade:first-of-type {
    border-top: none;
  }

  .m-smart-trade-copy {
    flex: 1 1 auto;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .m-smart-trade-name {
    font-family: var(--font-mono);
    font-size: var(--type-footnote);
    font-weight: 500;
    color: var(--stripe-text-primary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .m-smart-trade-line {
    font-family: var(--font-mono);
    font-size: var(--type-caption);
    color: var(--stripe-text-secondary);
    font-variant-numeric: tabular-nums;
  }

  .m-smart-trade-stats {
    flex: 0 0 auto;
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 2px;
    font-family: var(--font-mono);
    font-variant-numeric: tabular-nums;
    text-align: right;
  }

  .m-smart-trade-pnl {
    font-size: var(--type-footnote);
    font-weight: 500;
    color: var(--stripe-text-primary);
  }
  .m-smart-trade-pnl:global(.k-pnl-positive) {
    color: var(--stripe-success);
  }
  .m-smart-trade-pnl:global(.k-pnl-negative) {
    color: var(--stripe-danger);
  }

  .m-smart-trade-time {
    font-size: var(--type-caption);
    color: var(--stripe-text-tertiary);
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
    min-height: 32px;
    padding: 6px 12px;
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
