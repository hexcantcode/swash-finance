<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import {
    getMostHeld,
    getCohortSentiment,
    getHyperdashPositions,
    getHyperdashTrades,
    type CategorizedMostHeld,
    type MostHeldRow,
    type CohortFeed,
    type MarketSentiment,
    type MarketPositions,
    type SmartTrade,
    type CohortBias,
  } from '$lib/api/feed';
  import MobileMarketSentimentBar from '$lib/components/MobileMarketSentimentBar.svelte';
  import { coinDisplayName, coinIconUrl, coinIconBg, coinCategory } from '$lib/utils/coin';
  import { Crown, Gem, Coins, Flower2, Ghost, Skull } from 'lucide-svelte';
  import {
    shortAddress,
    effigyUrl,
    formatUsd,
    formatPnl,
    formatRelativeTime,
    pnlSignClass,
  } from '$lib/utils/format';

  type Tab = 'trades' | 'positions' | 'sentiment';

  let tab = $state<Tab>('sentiment');
  let trades = $state<SmartTrade[]>([]);
  let positionMarkets = $state<MarketPositions[]>([]);
  let mostHeld = $state<CategorizedMostHeld | null>(null);
  let cohortFeed = $state<CohortFeed | null>(null);
  let loading = $state(true);
  let errorMsg = $state<string | null>(null);
  let pollTimer: ReturnType<typeof setTimeout> | null = null;
  let mounted = false;
  let abortCtrl: AbortController | null = null;

  const POLL_MS = 10_000;

  async function load(opts: { silent?: boolean } = {}) {
    abortCtrl?.abort();
    abortCtrl = new AbortController();
    if (!opts.silent) loading = true;
    errorMsg = null;
    try {
      const [tr, pos, held, cohorts] = await Promise.all([
        getHyperdashTrades(),
        getHyperdashPositions(),
        getMostHeld(),
        getCohortSentiment(),
      ]);
      trades = tr;
      positionMarkets = pos;
      mostHeld = held;
      cohortFeed = cohorts;
    } catch (err) {
      errorMsg = (err as Error).message || 'Failed to load feed';
    } finally {
      loading = false;
    }
  }

  /** Background poll for the active tab only — every dataset is Hyperdash-backed
   *  and cached server-side, so polling just reflects that cadence. Refreshes
   *  just the visible tab; the others keep their last snapshot until the user
   *  switches back (the initial load() already primed all of them). */
  async function refreshActive() {
    try {
      if (tab === 'trades') trades = await getHyperdashTrades();
      else if (tab === 'positions') positionMarkets = await getHyperdashPositions();
      else if (tab === 'sentiment') {
        [mostHeld, cohortFeed] = await Promise.all([getMostHeld(), getCohortSentiment()]);
      }
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
  });

  onDestroy(() => {
    if (pollTimer) clearTimeout(pollTimer);
    abortCtrl?.abort();
  });

  const sentimentSections = $derived(
    mostHeld
      ? ([
          { label: 'Stock & Commodity', rows: mostHeld.stocks },
          { label: 'Crypto', rows: mostHeld.crypto },
        ] as const).filter((s) => s.rows.length > 0)
      : [],
  );

  /** Split the cohort's markets into Stocks & Commodities / Crypto. The dex
   *  prefix (e.g. `XYZ:` on TradFi markets) is what `coinCategory` needs to tell
   *  a stock from a coin, so derive it from the coin string. */
  const cohortGroups = $derived.by(() => {
    const stocks: MarketSentiment[] = [];
    const crypto: MarketSentiment[] = [];
    for (const m of cohortFeed?.sentiment?.markets ?? []) {
      const ci = m.coin.indexOf(':');
      const dex = ci === -1 ? null : m.coin.slice(0, ci).toLowerCase();
      (coinCategory(m.coin, dex) === 'crypto' ? crypto : stocks).push(m);
    }
    return ([
      { label: 'Stocks & Commodities', rows: stocks },
      { label: 'Crypto', rows: crypto },
    ] as const).filter((g) => g.rows.length > 0);
  });

  /** PnL cohort → line icon. Crown / gem / coins for the profitable tiers,
   *  wilting flower / ghost / skull for the losing tiers. */
  const COHORT_ICONS: Record<string, typeof Crown> = {
    extremely_profitable: Crown,
    very_profitable: Gem,
    profitable: Coins,
    unprofitable: Flower2,
    very_unprofitable: Ghost,
    rekt: Skull,
  };

  /** Cohort bias → display label, arrow, and tone class. Bullish leans long
   *  (the crowd buying), bearish leans short. */
  function biasDisplay(b: CohortBias): { label: string; arrow: string; tone: 'bull' | 'bear' | 'flat' } {
    switch (b) {
      case 'very_bullish':
        return { label: 'Very Bullish', arrow: '↗', tone: 'bull' };
      case 'bullish':
        return { label: 'Bullish', arrow: '↗', tone: 'bull' };
      case 'slightly_bullish':
        return { label: 'Slightly Bullish', arrow: '↗', tone: 'bull' };
      case 'slightly_bearish':
        return { label: 'Slightly Bearish', arrow: '↘', tone: 'bear' };
      case 'bearish':
        return { label: 'Bearish', arrow: '↘', tone: 'bear' };
      case 'very_bearish':
        return { label: 'Very Bearish', arrow: '↘', tone: 'bear' };
      default:
        return { label: 'Neutral', arrow: '→', tone: 'flat' };
    }
  }

  /** Green-segment width % for a sentiment bar — long notional as a share of
   *  total directional notional. Falls back to 50/50 when both sides are 0. */
  function longPct(r: { longNotionalUsd: number; shortNotionalUsd: number }): number {
    const total = r.longNotionalUsd + r.shortNotionalUsd;
    return total > 0 ? (r.longNotionalUsd / total) * 100 : 50;
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

  /** Compact base-unit size for a fill, e.g. "0.5", "12K", "1.2M". */
  function fmtSize(n: number): string {
    if (!Number.isFinite(n) || n === 0) return '0';
    const abs = Math.abs(n);
    const digits = abs >= 1000 ? 1 : abs >= 1 ? 2 : 4;
    return new Intl.NumberFormat('en-US', {
      notation: abs >= 10000 ? 'compact' : 'standard',
      maximumFractionDigits: digits,
    }).format(n);
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
      aria-selected={tab === 'sentiment'}
      class="m-tab tappable tap-hit"
      class:is-active={tab === 'sentiment'}
      onclick={() => (tab = 'sentiment')}
    >
      Vibes
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
      aria-selected={tab === 'trades'}
      class="m-tab tappable tap-hit"
      class:is-active={tab === 'trades'}
      onclick={() => (tab = 'trades')}
    >
      Trades
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
    {#if trades.length === 0}
      <div class="m-empty safe-x">No closed trades yet.</div>
    {:else}
      <!-- Smart-money closed trades — recent round-trips by the copytraders. -->
      <ul class="m-card-list">
        {#each trades as t (t.address + t.coin + t.closedAtMs)}
          {@const isLong = t.direction.toLowerCase() === 'long'}
          <li>
            <a class="m-feed-row tappable-row" href={`/trader/${t.address}`}>
              <img class="m-feed-avatar" src={effigyUrl(t.address)} alt="" loading="lazy" />
              <div class="m-feed-main">
                <div class="m-feed-line-1">
                  <span class="m-feed-address">{t.displayName || shortAddress(t.address, 4, 4)}</span>
                  <span class="m-feed-action {isLong ? 'is-buy' : 'is-sell'}">
                    {isLong ? 'long' : 'short'}
                  </span>
                  <span class="m-feed-coin">
                    {#if coinIconUrl(t.coin)}
                      <img src={coinIconUrl(t.coin)} style:background-color={coinIconBg(t.coin)} style:padding={coinIconBg(t.coin) ? '2px' : null} alt="" loading="lazy" />
                    {/if}
                    {coinDisplayName(t.coin)}
                  </span>
                </div>
                <div class="m-feed-line-2">
                  <span class="m-feed-size">{fmtSize(t.szBase)} {coinDisplayName(t.coin)}</span>
                  <span class="m-feed-dot">·</span>
                  <span>{fmtPrice(t.entryPxUsd)} → {fmtPrice(t.exitPxUsd)}</span>
                </div>
              </div>
              <div class="m-feed-amount">
                <span class="m-feed-notional {pnlSignClass(t.netPnlUsd)}">
                  {formatPnl(t.netPnlUsd)}
                </span>
                <span class="m-feed-time">{formatRelativeTime(new Date(t.closedAtMs))}</span>
              </div>
            </a>
          </li>
        {/each}
      </ul>
    {/if}
  {:else if tab === 'positions'}
    {#if positionMarkets.length === 0}
      <div class="m-empty safe-x">No smart-money positions reported.</div>
    {:else}
      <!-- Where the smart money (highest copy-scores) is positioned, by market. -->
      {#each positionMarkets as mkt (mkt.coin)}
        <section class="m-posmkt" aria-label={`${coinDisplayName(mkt.coin)} positions`}>
          <h3 class="m-posmkt-head safe-x">
            <span class="m-feed-coin">
              {#if coinIconUrl(mkt.coin)}
                <img src={coinIconUrl(mkt.coin)} style:background-color={coinIconBg(mkt.coin)} style:padding={coinIconBg(mkt.coin) ? '2px' : null} alt="" loading="lazy" />
              {/if}
              {coinDisplayName(mkt.coin)}
            </span>
            <span class="m-posmkt-ls">{mkt.longCount.toLocaleString()} long · {mkt.shortCount.toLocaleString()} short</span>
          </h3>
          <ul class="m-card-list">
            {#each mkt.positions as p (p.address)}
              <li>
                <a class="m-feed-row tappable-row" href={`/trader/${p.address}`}>
                  <img class="m-feed-avatar" src={effigyUrl(p.address)} alt="" loading="lazy" />
                  <div class="m-feed-main">
                    <div class="m-feed-line-1">
                      <span class="m-feed-address">{p.displayName || shortAddress(p.address, 4, 4)}</span>
                      <span class="m-feed-action {p.side === 'long' ? 'is-buy' : 'is-sell'}">{p.side}</span>
                      <span class="m-pos-copy">copy {Math.round(p.copyScore)}</span>
                    </div>
                    <div class="m-feed-line-2">
                      <span class="m-feed-size">{formatUsd(p.notionalUsd)}</span>
                      <span class="m-feed-dot">·</span>
                      <span>entry {fmtPrice(p.entryPxUsd)}</span>
                    </div>
                  </div>
                  <div class="m-feed-amount">
                    <span class="m-feed-notional {pnlSignClass(p.unrealizedPnlUsd)}">
                      {formatPnl(p.unrealizedPnlUsd)}
                    </span>
                    <span class="m-feed-time">uPnL</span>
                  </div>
                </a>
              </li>
            {/each}
          </ul>
        </section>
      {/each}
    {/if}
  {:else}
    <!-- Sentiment tab -->
    {#if cohortFeed && cohortFeed.cohorts.length > 0}
      <!-- General sentiment for each realized-PnL cohort. -->
      <section class="m-cohorts" aria-label="Cohort sentiment">
        <ul class="m-cohort-list">
          {#each cohortFeed.cohorts as c (c.id)}
            {@const cb = biasDisplay(c.bias)}
            {@const Icon = COHORT_ICONS[c.id] ?? Coins}
            <li class="m-cohort-row">
              <Icon class="m-cohort-icon" size={18} strokeWidth={1.6} aria-hidden="true" />
              <span class="m-cohort-id">
                <span class="m-cohort-label">{c.label}</span>
                <span class="m-cohort-range">{c.range}</span>
              </span>
              <span class="m-cohort-bias is-{cb.tone}">
                {cb.label}
                <span class="m-cohort-arrow" aria-hidden="true">{cb.arrow}</span>
              </span>
            </li>
          {/each}
        </ul>
      </section>
    {/if}

    {#if cohortFeed?.sentiment && cohortFeed.sentiment.markets.length > 0}
      <!-- Smart-money (Extremely Profitable) positioning by market, by category. -->
      <section class="m-cohort-markets" aria-label="Smart-money positioning by market">
        <h2 class="m-sent-head safe-x">Smart money by market</h2>
        {#each cohortGroups as group (group.label)}
          <h3 class="m-sub-head safe-x">{group.label}</h3>
          <ul class="m-list">
            {#each group.rows as m (m.coin)}
              <li class="m-sent-row">
                <MobileMarketSentimentBar {m} coin={m.coin} />
              </li>
            {/each}
          </ul>
        {/each}
      </section>
    {/if}

    {#if sentimentSections.length === 0}
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
    display: flex;
    align-items: center;
    gap: 5px;
    font-family: var(--font-mono);
    font-variant-numeric: tabular-nums;
    font-size: var(--type-caption);
    color: var(--stripe-text-tertiary);
    overflow: hidden;
    white-space: nowrap;
  }
  /* Size + coin is the most useful detail — give it the secondary tone so it
     stands a step above the price/lev/time metadata. */
  .m-feed-size {
    color: var(--stripe-text-secondary);
    flex-shrink: 0;
  }
  .m-feed-lev {
    color: var(--stripe-text-secondary);
  }
  .m-feed-dot {
    color: var(--stripe-text-muted);
  }

  /* Right column — notional headline (tinted buy/sell) over the timestamp. */
  .m-feed-amount {
    flex: 0 0 auto;
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 2px;
    text-align: right;
  }
  .m-feed-notional {
    font-family: var(--font-mono);
    font-variant-numeric: tabular-nums;
    font-size: var(--type-callout);
    font-weight: 600;
    color: var(--stripe-text-primary);
  }
  .m-feed-notional.is-buy {
    color: var(--stripe-success);
  }
  .m-feed-notional.is-sell {
    color: var(--stripe-danger);
  }
  /* Realized/unrealized PnL coloring (closed trades + open positions). */
  .m-feed-notional:global(.k-pnl-positive) {
    color: var(--stripe-success);
  }
  .m-feed-notional:global(.k-pnl-negative) {
    color: var(--stripe-danger);
  }
  .m-feed-time {
    font-family: var(--font-mono);
    font-size: var(--type-caption);
    color: var(--stripe-text-tertiary);
    white-space: nowrap;
  }

  /* ── Positions by market (smart money) ──────────────────────────────── */
  .m-posmkt {
    margin-bottom: var(--space-4);
  }
  .m-posmkt-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
    margin: var(--space-3) 0 var(--space-1);
  }
  .m-posmkt-ls {
    font-family: var(--font-mono);
    font-size: var(--type-footnote);
    color: var(--stripe-text-tertiary);
    white-space: nowrap;
  }
  .m-pos-copy {
    font-family: var(--font-mono);
    font-size: var(--type-caption);
    color: var(--stripe-text-tertiary);
    white-space: nowrap;
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

  /* ── Cohort market sentiment (top of the Sentiment tab) ─────────────── */
  .m-cohorts {
    margin-bottom: var(--space-4);
  }
  /* Cohort table — one row per realized-PnL tier, its general bias on the right. */
  .m-cohort-list {
    list-style: none;
    /* Inset to match .m-list / .safe-x so the card aligns with the rest of the
       tab instead of bleeding to the screen edges. */
    margin: 0 max(var(--safe-right), var(--space-4)) 0 max(var(--safe-left), var(--space-4));
    padding: 0;
    background: var(--glass-bg);
    -webkit-backdrop-filter: var(--glass-blur);
    backdrop-filter: var(--glass-blur);
    border-radius: var(--radius-lg);
    box-shadow: var(--glass-highlight), var(--glass-shadow);
    overflow: hidden;
  }
  /* Three responsive columns: icon (auto) | identity (flexes + truncates) |
     bias pill (auto, right-aligned). minmax(0, 1fr) lets the middle column
     shrink and ellipsis instead of pushing the bias pill off a narrow screen. */
  .m-cohort-row {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-3) var(--space-4);
  }
  .m-cohort-row:not(:last-child) {
    border-bottom: 1px solid var(--stripe-border);
  }
  .m-cohort-row :global(.m-cohort-icon) {
    color: var(--stripe-text-secondary);
  }
  .m-cohort-id {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }
  .m-cohort-label {
    font-family: var(--font-sans);
    font-size: var(--type-subhead);
    font-weight: 600;
    color: var(--stripe-text-primary);
    line-height: 1.15;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .m-cohort-range {
    font-family: var(--font-mono);
    font-size: var(--type-footnote);
    color: var(--stripe-text-tertiary);
    letter-spacing: 0.02em;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  /* Category sub-heading under the "by market" breakdown — lighter than the
     section head so the two levels read as a hierarchy. */
  .m-sub-head {
    font-family: var(--font-sans);
    font-size: var(--type-caption);
    font-weight: 600;
    letter-spacing: 0.02em;
    color: var(--stripe-text-tertiary);
    margin: var(--space-3) 0 var(--space-1);
  }
  .m-cohort-bias {
    flex: 0 0 auto;
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 4px 10px;
    /* Match the app-wide pill radius (.tag-chip in app.css). */
    border-radius: var(--radius-sm);
    font-family: var(--font-sans);
    font-size: var(--type-footnote);
    font-weight: 600;
    white-space: nowrap;
  }
  .m-cohort-bias.is-bull {
    color: var(--stripe-success);
    background: color-mix(in srgb, var(--stripe-success) 15%, transparent);
  }
  .m-cohort-bias.is-bear {
    color: var(--stripe-danger);
    background: color-mix(in srgb, var(--stripe-danger) 15%, transparent);
  }
  .m-cohort-bias.is-flat {
    color: var(--stripe-text-secondary);
    background: var(--stripe-accent-muted);
  }
  .m-cohort-arrow {
    font-size: var(--type-callout);
    line-height: 1;
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
