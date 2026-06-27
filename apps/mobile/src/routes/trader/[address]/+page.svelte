<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { page } from '$app/stores';
  import { getEpTraderDetail, type EpTraderDetail } from '$lib/api/leader-detail';
  import {
    shortAddress,
    traderName,
    effigyUrl,
    formatPnl,
    formatUsd,
    formatRelativeTime,
    pnlSignClass,
  } from '$lib/utils/format';
  import { coinDisplayName, coinIconUrl, coinIconBg } from '$lib/utils/coin';

  const address = $derived($page.params['address'] ?? '');

  let detail = $state<EpTraderDetail | null>(null);
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
      detail = await getEpTraderDetail(address);
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

  const stats = $derived(detail?.stats ?? null);
</script>

<svelte:head>
  <title>{detail ? traderName(detail.displayName, detail.address) : 'Trader'} · Swash</title>
</svelte:head>

<main id="main-content" class="m-page">
  <h1 class="sr-only">Trader detail</h1>

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
            {traderName(detail.displayName, detail.address, 6, 4)}
          </button>
          {#if detail.displayName}
            <span class="m-detail-subaddr">{shortAddress(detail.address, 6, 4)}</span>
          {/if}
        </div>
      </div>
    </section>

    {#if stats}
      <section class="m-detail-stats safe-x" aria-label="Key metrics">
        <div class="m-stat">
          <div class="m-stat-label">All-time profit</div>
          <div class="m-stat-value {pnlSignClass(stats.pnlUsd)}">{formatPnl(stats.pnlUsd)}</div>
        </div>
        <div class="m-stat">
          <div class="m-stat-label">Win rate</div>
          <div class="m-stat-value">{Math.round(stats.winratePct)}%</div>
        </div>
        <div class="m-stat">
          <div class="m-stat-label">Trades</div>
          <div class="m-stat-value">{stats.totalTrades}</div>
        </div>
        <div class="m-stat">
          <div class="m-stat-label">Sharpe</div>
          <div class="m-stat-value">{stats.sharpe.toFixed(2)}</div>
        </div>
        <div class="m-stat">
          <div class="m-stat-label">Max drawdown</div>
          <div class="m-stat-value">{Math.round(stats.drawdown)}%</div>
        </div>
      </section>

      {#if stats.topAssets.length > 0}
        <section class="m-detail-section safe-x">
          <h2 class="m-section-title">Top markets</h2>
          <ul class="m-position-list">
            {#each stats.topAssets as a (a.coin)}
              <li class="m-position-row">
                <div class="m-position-icon">
                  {#if coinIconUrl(a.coin)}
                    <img src={coinIconUrl(a.coin)} style:background-color={coinIconBg(a.coin)} style:padding={coinIconBg(a.coin) ? '4px' : null} alt="" loading="lazy" />
                  {/if}
                </div>
                <div class="m-position-main">
                  <div class="m-position-coin">{coinDisplayName(a.coin)}</div>
                </div>
                <div class="m-position-stats">
                  <div class="m-position-notional">{formatUsd(a.volumeUsd)}</div>
                  <div class="m-position-pnl {pnlSignClass(a.pnlUsd)}">{formatPnl(a.pnlUsd)}</div>
                </div>
              </li>
            {/each}
          </ul>
        </section>
      {/if}
    {/if}

    {#if detail.positions.length > 0}
      <section class="m-detail-section safe-x">
        <h2 class="m-section-title">Open positions ({detail.positions.length})</h2>
        <ul class="m-position-list">
          {#each detail.positions.slice(0, 10) as p, i (i + p.coin)}
            <li class="m-position-row">
              <div class="m-position-icon">
                {#if coinIconUrl(p.coin)}
                  <img src={coinIconUrl(p.coin)} style:background-color={coinIconBg(p.coin)} style:padding={coinIconBg(p.coin) ? '4px' : null} alt="" loading="lazy" />
                {/if}
              </div>
              <div class="m-position-main">
                <div class="m-position-coin">{coinDisplayName(p.coin)}</div>
                <div class="m-position-side {p.side === 'long' ? 'is-long' : 'is-short'}">
                  {p.side}
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

    {#if detail.trades.length > 0}
      <section class="m-detail-section safe-x">
        <h2 class="m-section-title">Recent trades</h2>
        <ul class="m-position-list">
          {#each detail.trades.slice(0, 15) as t, i (i + t.coin)}
            <li class="m-position-row">
              <div class="m-position-icon">
                {#if coinIconUrl(t.coin)}
                  <img src={coinIconUrl(t.coin)} style:background-color={coinIconBg(t.coin)} style:padding={coinIconBg(t.coin) ? '4px' : null} alt="" loading="lazy" />
                {/if}
              </div>
              <div class="m-position-main">
                <div class="m-position-coin">{coinDisplayName(t.coin)}</div>
                <div class="m-position-side">
                  {t.direction} · {formatRelativeTime(new Date(t.closedAtMs))}
                </div>
              </div>
              <div class="m-position-stats">
                <div class="m-position-notional">{formatUsd(t.notionalUsd)}</div>
                <div class="m-position-pnl {pnlSignClass(t.netPnlUsd)}">
                  {formatPnl(t.netPnlUsd)}
                </div>
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
    padding-bottom: calc(var(--safe-bottom) + 96px);
  }

  /* Hero: identity row. */
  .m-detail-hero {
    display: flex;
    flex-direction: column;
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

  .m-detail-subaddr {
    font-family: var(--font-mono);
    font-variant-numeric: tabular-nums;
    font-size: var(--type-caption);
    color: var(--stripe-text-tertiary);
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
