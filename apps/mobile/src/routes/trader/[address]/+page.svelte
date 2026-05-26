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
    formatNumber,
    formatDuration,
    formatRelativeTime,
    pnlSignClass,
  } from '$lib/utils/format';
  import { coinDisplayName, coinIconUrl } from '$lib/utils/coin';

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
      <img class="m-detail-avatar" src={effigyUrl(detail.address)} alt="" />
      <div class="m-detail-identity">
        <button type="button" class="m-detail-address tappable" onclick={copyAddress} aria-label="Copy address">
          {shortAddress(detail.address, 6, 4)}
        </button>
        {#if detail.primary_tag}
          <span class="m-detail-tag">{detail.primary_tag}</span>
        {/if}
      </div>

      {#if detail.score !== null}
        <div class="m-detail-score">
          <span class="m-detail-score-num">{Math.round(detail.score)}</span>
          <span class="m-detail-score-label">composite score</span>
        </div>
      {/if}
    </section>

    <section class="m-detail-stats safe-x" aria-label="Key metrics">
      <div class="m-stat">
        <div class="m-stat-label">Net PnL</div>
        <div class="m-stat-value {pnlSignClass(detail.scoring?.net_pnl_usd)}">
          {formatPnl(detail.scoring?.net_pnl_usd ?? null)}
        </div>
      </div>
      <div class="m-stat">
        <div class="m-stat-label">Equity</div>
        <div class="m-stat-value">{formatUsd(detail.account_value)}</div>
      </div>
      <div class="m-stat">
        <div class="m-stat-label">Win rate</div>
        <div class="m-stat-value">{formatPct(detail.scoring?.win_rate ?? null, 0)}</div>
      </div>
      <div class="m-stat">
        <div class="m-stat-label">Sharpe</div>
        <div class="m-stat-value">{formatNumber(detail.scoring?.sharpe ?? null)}</div>
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
                  <img src={coinIconUrl(p.coin)} alt="" loading="lazy" />
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

    {#if detail.recent_fills.length > 0}
      <section class="m-detail-section safe-x">
        <h2 class="m-section-title">Recent trades</h2>
        <ul class="m-position-list">
          {#each detail.recent_fills.slice(0, 15) as f (f.tid)}
            <li class="m-position-row">
              <div class="m-position-icon">
                {#if coinIconUrl(f.coin)}
                  <img src={coinIconUrl(f.coin)} alt="" loading="lazy" />
                {/if}
              </div>
              <div class="m-position-main">
                <div class="m-position-coin">{coinDisplayName(f.coin)}</div>
                <div class="m-position-side">
                  {f.side === 'B' ? 'Buy' : f.side === 'A' ? 'Sell' : f.side}
                  · {formatRelativeTime(new Date(f.block_time_ms))}
                </div>
              </div>
              <div class="m-position-stats">
                <div class="m-position-notional">{formatUsd(f.notional)}</div>
                {#if f.closed_pnl !== null && f.closed_pnl !== 0}
                  <div class="m-position-pnl {pnlSignClass(f.closed_pnl)}">
                    {formatPnl(f.closed_pnl)}
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

  .m-detail-hero {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-2);
    padding-top: var(--space-3);
    padding-bottom: var(--space-5);
  }

  .m-detail-avatar {
    width: 72px;
    height: 72px;
    border-radius: var(--radius-full);
    background: var(--stripe-bg-secondary);
    border: 1.5px solid var(--stripe-border-light);
    box-shadow: var(--glass-shadow);
  }

  .m-detail-identity {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }

  .m-detail-address {
    font-family: var(--font-mono);
    font-size: var(--type-title);
    color: var(--stripe-text-primary);
    background: transparent;
    border: none;
    padding: 4px 8px;
    border-radius: var(--radius-md);
    cursor: pointer;
  }

  .m-detail-tag {
    text-transform: capitalize;
    font-family: var(--font-mono);
    font-size: var(--type-caption);
    color: var(--stripe-text-secondary);
    background: var(--stripe-bg-secondary);
    border: 1px solid var(--stripe-border);
    padding: 2px 8px;
    border-radius: var(--radius-md);
  }

  /* Composite score = the one teal-accented surface on the page. */
  .m-detail-score {
    display: flex;
    flex-direction: column;
    align-items: center;
    margin-top: var(--space-3);
    padding: var(--space-3) var(--space-6);
    background: var(--stripe-accent-subtle);
    border: 1px solid var(--stripe-border-focus);
    border-radius: var(--radius-lg);
    box-shadow: var(--glass-highlight);
  }

  .m-detail-score-num {
    font-family: var(--font-mono);
    font-variant-numeric: tabular-nums;
    font-size: 48px;
    line-height: 1;
    color: var(--stripe-accent-light);
    font-weight: 700;
  }

  .m-detail-score-label {
    font-family: var(--font-mono);
    font-size: var(--type-caption);
    color: var(--stripe-text-tertiary);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    margin-top: 4px;
  }

  .m-detail-stats {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
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
    font-family: var(--font-mono);
    font-size: var(--type-footnote);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--stripe-text-tertiary);
    margin: 0 0 var(--space-3);
    font-weight: 500;
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

  .m-error,
  .m-empty {
    padding: var(--space-8) var(--space-4);
    text-align: center;
    color: var(--stripe-text-secondary);
  }

  .m-error-retry {
    margin-top: var(--space-3);
    padding: 10px 20px;
    font-family: var(--font-mono);
  }
</style>
