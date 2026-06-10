<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { page } from '$app/stores';
  import { getLeaderDetail, type LeaderDetail } from '$lib/api/leader-detail';
  import {
    shortAddress,
    effigyUrl,
    formatPnl,
    formatUsd,
    formatPct,
    formatDuration,
    formatRelativeTime,
    pnlSignClass,
  } from '$lib/utils/format';
  import { coinDisplayName, coinIconUrl, coinIconBg } from '$lib/utils/coin';
  import MobilePriceChart from '$lib/components/MobilePriceChart.svelte';
  import Tag from '$lib/components/Tag.svelte';
  import { appSheet } from '$lib/ui/sheets.svelte';

  const address = $derived($page.params['address'] ?? '');

  let detail = $state<LeaderDetail | null>(null);
  let loading = $state(true);
  let errorMsg = $state<string | null>(null);
  let abortCtrl: AbortController | null = null;
  let mounted = false;

  async function load() {
    if (!address) return;
    abortCtrl?.abort();
    abortCtrl = new AbortController();
    loading = true;
    errorMsg = null;
    try {
      detail = await getLeaderDetail(address);
    } catch (err) {
      errorMsg = (err as Error).message || 'Failed to load trader';
    } finally {
      loading = false;
    }
  }

  onMount(() => {
    mounted = true;
    void load();
  });

  onDestroy(() => abortCtrl?.abort());

  $effect(() => {
    if (!mounted) return;
    void address;
    void load();
  });

  function copyAddress() {
    if (!address) return;
    void navigator.clipboard?.writeText(address);
  }

  // Crosshair readout for the equity curve: the cumulative PnL value under the
  // pointer and its date. Null when not hovering — heading shows Net PnL then.
  let hovered = $state<{ price: number; time: number } | null>(null);
  function formatHoverDate(seconds: number): string {
    return new Date(seconds * 1000).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
    });
  }

  /** Collapse the recent fill-by-fill list into one row per coin: total
   *  notional traded, net realized PnL, fill count, and the most recent
   *  fill time. Ordered most-recently-active first. */
  const aggregatedTrades = $derived.by(() => {
    const byCoin = new Map<
      string,
      { coin: string; notional: number; pnl: number; lastMs: number; count: number }
    >();
    for (const f of detail?.recent_fills ?? []) {
      const e =
        byCoin.get(f.coin) ??
        { coin: f.coin, notional: 0, pnl: 0, lastMs: 0, count: 0 };
      e.notional += f.notional ?? 0;
      e.pnl += f.closed_pnl ?? 0;
      e.lastMs = Math.max(e.lastMs, f.block_time_ms);
      e.count += 1;
      byCoin.set(f.coin, e);
    }
    return [...byCoin.values()].sort((a, b) => b.lastMs - a.lastMs);
  });
</script>

<svelte:head>
  <title>{detail ? shortAddress(detail.address) : 'Trader'} · Swash</title>
</svelte:head>

<main id="main-content" class="m-page">
  <header class="m-detail-header safe-x">
    <a href="/traders" class="m-back tappable" aria-label="Back to leaderboard">
      <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="m15 18-6-6 6-6" />
      </svg>
    </a>
    <h1 class="sr-only">Trader detail</h1>
  </header>

  {#if loading}
    <section class="m-detail-hero safe-x">
      <div class="m-skeleton m-skeleton-avatar"></div>
      <div class="m-skeleton m-skeleton-title"></div>
      <div class="m-skeleton m-skeleton-subtitle"></div>
    </section>
  {:else if errorMsg}
    <div class="m-error safe-x" role="alert">
      <p>{errorMsg}</p>
      <button type="button" class="m-error-retry m-btn tappable" onclick={() => load()}>Retry</button>
    </div>
  {:else if detail}
    <section class="m-detail-hero safe-x">
      <div class="m-detail-id">
        <img class="m-detail-avatar" src={effigyUrl(detail.address)} alt="" />
        <div class="m-detail-meta">
          <button type="button" class="m-detail-address tappable" onclick={copyAddress} aria-label="Copy address">
            {shortAddress(detail.address, 6, 4)}
          </button>
          <span class="m-detail-tagrow">
            <Tag tag={detail.primary_tag} />
          </span>
        </div>
      </div>
      <!-- Composite score — the same number the leaderboard ranks by; tapping
           opens the plain-language explainer. -->
      <button
        type="button"
        class="m-detail-score tap-hit"
        aria-label={`Score ${detail.score === null ? 'unknown' : Math.round(detail.score)} out of 100 — what does this mean?`}
        onclick={() => appSheet.open('score')}
      >
        <span class="m-detail-score-num">
          <span class="m-detail-score-val">{detail.score === null ? '—' : Math.round(detail.score)}</span>
          <span class="m-detail-score-of">/100</span>
          <svg
            class="m-detail-score-info"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="1.8"
            stroke-linecap="round"
            aria-hidden="true"
          >
            <circle cx="12" cy="12" r="9" />
            <path d="M12 11v5 M12 8h.01" />
          </svg>
        </span>
        <span class="m-detail-score-bars" aria-hidden="true">
          {#each Array(10) as _, i (i)}
            <span
              class="m-detail-score-bar"
              class:is-on={detail.score !== null && i < Math.max(0, Math.min(10, Math.round(detail.score / 10)))}
            ></span>
          {/each}
        </span>
      </button>
    </section>

    <div class="m-detail-cta safe-x">
      <button
        type="button"
        class="m-detail-mirror m-cta-primary tappable"
        onclick={() => appSheet.open('mirror')}
      >
        Mirror this trader
      </button>
    </div>

    {#if detail.equity_curve.length > 1}
      <section class="m-detail-section m-detail-chart safe-x" aria-label="Profit curve">
        <div class="m-chart-heading">
          <!-- The curve plots cumulative realized PnL, not account value —
               "profit" is both the accurate and the plain-language name. -->
          <h2 class="m-section-title">Profit curve · 90D</h2>
          {#if hovered}
            <div class="m-chart-netpnl {pnlSignClass(hovered.price)}">
              <span class="m-chart-netpnl-label">{formatHoverDate(hovered.time)}</span>
              <span class="m-chart-netpnl-value">{formatPnl(hovered.price)}</span>
            </div>
          {:else}
            <div class="m-chart-netpnl {pnlSignClass(detail.scoring?.net_pnl_usd)}">
              <span class="m-chart-netpnl-label">Net profit</span>
              <span class="m-chart-netpnl-value">{formatPnl(detail.scoring?.net_pnl_usd ?? null)}</span>
            </div>
          {/if}
        </div>
        <MobilePriceChart
          line={detail.equity_curve.map((p) => ({ t: p.ts, value: p.value }))}
          height={200}
          onhover={(h) => (hovered = h)}
        />
      </section>
    {/if}

    <section class="m-detail-stats safe-x" aria-label="Key metrics">
      <div class="m-stat">
        <div class="m-stat-label">Account value</div>
        <div class="m-stat-value">{formatUsd(detail.account_value)}</div>
      </div>
      <div class="m-stat">
        <div class="m-stat-label">Win rate</div>
        <div class="m-stat-value">
          {detail.scoring?.win_rate != null ? formatPct(detail.scoring.win_rate, 0) : '—'}
        </div>
      </div>
      <div class="m-stat">
        <div class="m-stat-label">Trades</div>
        <div class="m-stat-value">{detail.scoring?.total_trades ?? '—'}</div>
      </div>
      <div class="m-stat">
        <div class="m-stat-label">Avg hold</div>
        <div class="m-stat-value">{formatDuration(detail.scoring?.avg_hold_seconds ?? null)}</div>
      </div>
    </section>

    {#if detail.open_positions.length > 0}
      <section class="m-detail-section safe-x">
        <h2 class="m-section-title">Open positions ({detail.open_positions.length})</h2>
        <ul class="m-position-list">
          {#each detail.open_positions.slice(0, 10) as p, i (i + p.coin)}
            <li class="m-position-row">
              <div class="m-position-icon">
                {#if coinIconUrl(p.coin)}
                  <img src={coinIconUrl(p.coin)} style:background-color={coinIconBg(p.coin)} style:padding={coinIconBg(p.coin) ? '4px' : null} alt="" loading="lazy" />
                {/if}
              </div>
              <div class="m-position-main">
                <div class="m-position-coin">{coinDisplayName(p.coin)}</div>
                <div class="m-position-side {p.side === 'long' ? 'is-long' : 'is-short'}">
                  {p.side ?? '—'} · {p.leverage ? `${p.leverage}x` : ''}
                </div>
              </div>
              <div class="m-position-stats">
                <div class="m-position-notional">{formatUsd(p.notionalUsd)}</div>
                <div class="m-position-pnl {pnlSignClass(p.unrealizedPnlUsd)}">
                  {formatPnl(p.unrealizedPnlUsd)}
                </div>
              </div>
            </li>
          {/each}
        </ul>
      </section>
    {/if}

    {#if aggregatedTrades.length > 0}
      <section class="m-detail-section safe-x">
        <h2 class="m-section-title">Recent trades · by coin</h2>
        <ul class="m-position-list">
          {#each aggregatedTrades.slice(0, 15) as t (t.coin)}
            <li class="m-position-row">
              <div class="m-position-icon">
                {#if coinIconUrl(t.coin)}
                  <img src={coinIconUrl(t.coin)} style:background-color={coinIconBg(t.coin)} style:padding={coinIconBg(t.coin) ? '4px' : null} alt="" loading="lazy" />
                {/if}
              </div>
              <div class="m-position-main">
                <div class="m-position-coin">{coinDisplayName(t.coin)}</div>
                <div class="m-position-side">
                  {t.count} {t.count === 1 ? 'trade' : 'trades'}
                  · {formatRelativeTime(new Date(t.lastMs))}
                </div>
              </div>
              <div class="m-position-stats">
                <div class="m-position-notional">{formatUsd(t.notional)}</div>
                {#if t.pnl !== 0}
                  <div class="m-position-pnl {pnlSignClass(t.pnl)}">
                    {formatPnl(t.pnl)}
                  </div>
                {/if}
              </div>
            </li>
          {/each}
        </ul>
      </section>
    {/if}
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
    padding-top: max(var(--safe-top), var(--space-2));
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

  /* Avatar left, wallet beside it — mirrors the asset-page hero placement.
     The composite score sits on the right edge. */
  .m-detail-hero {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
    padding-top: var(--space-3);
    padding-bottom: var(--space-4);
  }

  .m-detail-id {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    min-width: 0;
  }

  .m-detail-avatar {
    width: 56px;
    height: 56px;
    min-width: 56px;
    border-radius: var(--radius-full);
    background: var(--stripe-bg-secondary);
    border: 1.5px solid var(--stripe-border-light);
    box-shadow: var(--glass-shadow);
  }

  .m-detail-meta {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }

  .m-detail-address {
    font-family: var(--font-mono);
    font-size: var(--type-title);
    line-height: 1.15;
    color: var(--stripe-text-primary);
    background: transparent;
    border: none;
    padding: 0;
    text-align: left;
    cursor: pointer;
  }

  .m-detail-tagrow {
    display: inline-flex;
    margin-top: 4px;
  }

  /* Score block — right edge of the hero, tappable → explainer sheet. */
  .m-detail-score {
    flex: 0 0 auto;
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 5px;
    padding: 0;
    border: 0;
    background: transparent;
    cursor: pointer;
    font-family: var(--font-mono);
    font-variant-numeric: tabular-nums;
  }
  .m-detail-score-num {
    display: inline-flex;
    align-items: baseline;
    gap: 3px;
  }
  .m-detail-score-val {
    font-size: var(--type-title);
    font-weight: 700;
    line-height: 1;
    color: var(--stripe-text-primary);
  }
  .m-detail-score-of {
    font-size: var(--type-caption);
    color: var(--stripe-text-tertiary);
  }
  .m-detail-score-info {
    width: 13px;
    height: 13px;
    align-self: center;
    color: var(--stripe-text-tertiary);
  }
  .m-detail-score-bars {
    display: inline-flex;
    gap: 2px;
    align-items: flex-end;
  }
  .m-detail-score-bar {
    display: inline-block;
    width: 3px;
    height: 8px;
    background: var(--stripe-accent-muted);
    border-radius: 1px;
  }
  /* Monochrome accent — green stays reserved for profit/long. */
  .m-detail-score-bar.is-on {
    background: var(--stripe-accent);
  }

  .m-detail-cta {
    padding-bottom: var(--space-5);
  }
  .m-detail-mirror {
    width: 100%;
  }

  .m-detail-stats {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: var(--space-3);
    padding-top: var(--space-2);
    padding-bottom: var(--space-5);
  }

  .m-stat {
    background: var(--glass-bg);
    -webkit-backdrop-filter: var(--glass-blur);
    backdrop-filter: var(--glass-blur);
    border: 1px solid var(--stripe-border);
    border-radius: var(--radius-md);
    box-shadow: var(--glass-highlight), var(--glass-shadow);
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

  .m-stat-value:global(.k-pnl-positive) {
    color: var(--stripe-success);
  }
  .m-stat-value:global(.k-pnl-negative) {
    color: var(--stripe-danger);
  }

  .m-detail-section {
    padding-top: var(--space-4);
    padding-bottom: var(--space-5);
    border-top: 1px solid var(--stripe-border);
  }

  .m-section-title {
    font-family: var(--font-sans);
    font-size: var(--type-body);
    font-weight: 600;
    color: var(--stripe-text-primary);
    margin: 0 0 var(--space-3);
  }

  /* Equity-curve heading row: title left, Net PnL pinned right. */
  .m-chart-heading {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: var(--space-3);
    margin-bottom: var(--space-3);
  }
  .m-chart-heading .m-section-title {
    margin: 0;
  }

  .m-chart-netpnl {
    display: flex;
    align-items: baseline;
    gap: var(--space-2);
    font-family: var(--font-mono);
    font-variant-numeric: tabular-nums;
  }
  .m-chart-netpnl-label {
    font-size: 10px;
    color: var(--stripe-text-tertiary);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .m-chart-netpnl-value {
    font-size: var(--type-headline);
    color: var(--stripe-text-primary);
    font-weight: 600;
  }
  .m-chart-netpnl:global(.k-pnl-positive) .m-chart-netpnl-value {
    color: var(--stripe-success);
  }
  .m-chart-netpnl:global(.k-pnl-negative) .m-chart-netpnl-value {
    color: var(--stripe-danger);
  }

  .m-position-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    background: var(--glass-bg);
    -webkit-backdrop-filter: var(--glass-blur);
    backdrop-filter: var(--glass-blur);
    border: 1px solid var(--stripe-border);
    border-radius: var(--radius-lg);
    box-shadow: var(--glass-highlight), var(--glass-shadow);
    overflow: hidden;
  }
  .m-position-list > li + li {
    border-top: 1px solid var(--stripe-border);
  }

  .m-position-row {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-3) var(--space-4);
    min-height: var(--touch-comfortable);
  }

  .m-position-icon {
    flex: 0 0 32px;
    width: 32px;
    height: 32px;
    border-radius: var(--radius-full);
    background: var(--stripe-bg-secondary);
    box-shadow: var(--glass-shadow);
    overflow: hidden;
  }
  .m-position-icon img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .m-position-main {
    flex: 1 1 auto;
    min-width: 0;
  }

  .m-position-coin {
    font-family: var(--font-mono);
    font-size: var(--type-body);
    color: var(--stripe-text-primary);
  }

  .m-position-side {
    font-family: var(--font-mono);
    font-size: var(--type-caption);
    color: var(--stripe-text-tertiary);
    text-transform: capitalize;
  }
  .m-position-side.is-long {
    color: var(--stripe-success);
  }
  .m-position-side.is-short {
    color: var(--stripe-danger);
  }

  .m-position-stats {
    flex: 0 0 auto;
    text-align: right;
    font-family: var(--font-mono);
    font-variant-numeric: tabular-nums;
  }

  .m-position-notional {
    font-size: var(--type-subhead);
    color: var(--stripe-text-primary);
  }

  .m-position-pnl {
    font-size: var(--type-caption);
    color: var(--stripe-text-tertiary);
    margin-top: 2px;
  }
  .m-position-pnl:global(.k-pnl-positive) {
    color: var(--stripe-success);
  }
  .m-position-pnl:global(.k-pnl-negative) {
    color: var(--stripe-danger);
  }

  .m-skeleton-avatar {
    width: 72px;
    height: 72px;
    border-radius: var(--radius-full);
  }
  .m-skeleton-title {
    width: 160px;
    height: 22px;
    margin-top: var(--space-2);
  }
  .m-skeleton-subtitle {
    width: 100px;
    height: 14px;
    margin-top: var(--space-1);
  }

  /* Error/empty states come from the shared layer in lib/styles/mobile.css. */
</style>
