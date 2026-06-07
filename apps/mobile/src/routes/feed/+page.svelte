<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import {
    getLatestFills,
    getTopOpenPositions,
    mergeFills,
    type LatestFill,
    type CategorizedPositions,
  } from '$lib/api/feed';
  import { coinDisplayName, coinIconUrl, coinIconBg } from '$lib/utils/coin';
  import {
    shortAddress,
    effigyUrl,
    formatUsd,
    formatPnl,
    formatRelativeTime,
    pnlSignClass,
  } from '$lib/utils/format';

  type Tab = 'trades' | 'positions';

  let tab = $state<Tab>('trades');
  let fills = $state<LatestFill[]>([]);
  let positions = $state<CategorizedPositions | null>(null);
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
      const [latest, top] = await Promise.all([
        getLatestFills(),
        getTopOpenPositions(),
      ]);
      fills = mergeFills(latest);
      positions = top;
    } catch (err) {
      errorMsg = (err as Error).message || 'Failed to load feed';
    } finally {
      loading = false;
    }
  }

  function scheduleRefresh() {
    pollTimer = setTimeout(async () => {
      if (document.visibilityState === 'visible') {
        await load({ silent: true });
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

  const flatPositions = $derived(
    positions
      ? [...positions.stocks, ...positions.crypto, ...positions.index].sort(
          (a, b) => Math.abs(b.unrealizedPnlUsd) - Math.abs(a.unrealizedPnlUsd),
        )
      : [],
  );
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
      class="m-tab tappable"
      class:is-active={tab === 'trades'}
      onclick={() => (tab = 'trades')}
    >
      Latest trades
    </button>
    <button
      type="button"
      role="tab"
      aria-selected={tab === 'positions'}
      class="m-tab tappable"
      class:is-active={tab === 'positions'}
      onclick={() => (tab = 'positions')}
    >
      Top open
    </button>
  </div>

  {#if loading}
    <ul class="m-list" aria-busy="true">
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
      <ul class="m-list">
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
                  <span class="m-feed-action {f.side === 'B' ? 'is-buy' : 'is-sell'}">
                    {f.side === 'B' ? 'bought' : 'sold'}
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
  {:else if flatPositions.length === 0}
    <div class="m-empty safe-x">No open positions reported.</div>
  {:else}
    <ul class="m-list">
      {#each flatPositions.slice(0, 40) as p, i (p.address + p.coin + i)}
        <li>
          <a class="m-feed-row tappable-row" href={`/trader/${p.address}`}>
            <img
              class="m-feed-avatar"
              src={effigyUrl(p.address)}
              alt=""
              loading="lazy"
            />
            <div class="m-feed-main">
              <div class="m-feed-line-1">
                <span class="m-feed-address">{shortAddress(p.address, 4, 4)}</span>
                <span class="m-feed-action {p.side === 'long' ? 'is-buy' : 'is-sell'}">
                  {p.side}
                </span>
                <span class="m-feed-coin">
                  {#if coinIconUrl(p.coin)}
                    <img src={coinIconUrl(p.coin)} style:background-color={coinIconBg(p.coin)} style:padding={coinIconBg(p.coin) ? '2px' : null} alt="" loading="lazy" />
                  {/if}
                  {coinDisplayName(p.coin)}
                </span>
              </div>
              <div class="m-feed-line-2">
                {formatUsd(p.notionalUsd)}
                {#if p.leverage}· {p.leverage}x{/if}
              </div>
            </div>
            <div class="m-feed-pnl {pnlSignClass(p.unrealizedPnlUsd)}">
              {formatPnl(p.unrealizedPnlUsd)}
            </div>
          </a>
        </li>
      {/each}
    </ul>
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
     The two tabs split the container width equally (flex: 1 on .m-tab). */
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
    min-height: var(--touch-min);
    padding: 8px 14px;
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

  .m-feed-pnl {
    flex: 0 0 auto;
    font-family: var(--font-mono);
    font-variant-numeric: tabular-nums;
    font-size: var(--type-subhead);
    color: var(--stripe-text-primary);
  }
  .m-feed-pnl:global(.k-pnl-positive) {
    color: var(--stripe-success);
  }
  .m-feed-pnl:global(.k-pnl-negative) {
    color: var(--stripe-danger);
  }

  .m-skeleton-row {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-3) var(--space-4);
    min-height: var(--touch-comfortable);
  }
  .m-skeleton-avatar {
    width: 36px;
    height: 36px;
    border-radius: var(--radius-full);
  }
  .m-skeleton-main {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .m-skeleton-line {
    height: 14px;
    width: 70%;
  }
  .m-skeleton-line-sm {
    height: 10px;
    width: 50%;
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
