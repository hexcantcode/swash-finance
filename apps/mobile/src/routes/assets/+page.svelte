<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import MobileAssetRow from '$lib/components/MobileAssetRow.svelte';
  import { listAssets, deriveMovers, type Asset, type AssetMovers } from '$lib/api/assets';
  import { coinDisplayName, coinIconUrl, coinNeedsWhiteBg } from '$lib/utils/coin';
  import { formatUsd, formatPct, pnlSignClass, shortAddress } from '$lib/utils/format';
  import { listTopPositions, type TopPosition } from '$lib/api/positions';

  let assets = $state<Asset[]>([]);
  let movers = $state<AssetMovers | null>(null);
  let loading = $state(true);
  let errorMsg = $state<string | null>(null);
  let search = $state('');

  let positions = $state<TopPosition[]>([]);
  let positionsLoading = $state(true);
  let positionsError = $state<string | null>(null);

  let abortCtrl: AbortController | null = null;
  let mounted = false;

  async function load() {
    abortCtrl?.abort();
    abortCtrl = new AbortController();
    loading = true;
    errorMsg = null;
    try {
      const list = await listAssets();
      assets = list;
      movers = deriveMovers(list);
    } catch (err) {
      errorMsg = (err as Error).message || 'Failed to load assets';
    } finally {
      loading = false;
    }
  }

  async function loadPositions() {
    positionsLoading = true;
    positionsError = null;
    try {
      positions = await listTopPositions(25);
    } catch (err) {
      positionsError = (err as Error).message || 'Failed to load top positions';
    } finally {
      positionsLoading = false;
    }
  }

  const filtered = $derived(
    search.trim()
      ? assets.filter((a) => {
          const q = search.trim().toLowerCase();
          return (
            a.coin.toLowerCase().includes(q) ||
            a.symbol.toLowerCase().includes(q) ||
            coinDisplayName(a.coin).toLowerCase().includes(q)
          );
        })
      : (movers?.byVolume ?? assets),
  );

  onMount(() => {
    mounted = true;
    void load();
    void loadPositions();
  });

  onDestroy(() => {
    abortCtrl?.abort();
  });
</script>

<svelte:head>
  <title>Assets · Swash</title>
</svelte:head>

<main id="main-content" class="m-page">
  <header class="m-page-header safe-x">
    <input
      type="search"
      class="m-search-input"
      placeholder="Search assets…"
      bind:value={search}
      aria-label="Search assets"
    />
  </header>

  {#if !search.trim() && movers && movers.winners.length > 0}
    <section class="m-movers safe-x" aria-label="Top movers">
      <h2 class="m-section-title">Top movers</h2>
      <div class="m-movers-scroll">
        {#each movers.winners as a (a.coin)}
          <a class="m-mover-card tappable" href={`/assets/${encodeURIComponent(a.coin)}`}>
            <div class="m-mover-icon" class:is-white={coinNeedsWhiteBg(a.coin)}>
              {#if coinIconUrl(a.coin)}
                <img src={coinIconUrl(a.coin)} alt="" loading="lazy" />
              {/if}
            </div>
            <span class="m-mover-name">{coinDisplayName(a.coin)}</span>
            <span class="m-mover-price">
              {formatUsd(a.price, { precise: (a.price ?? 0) < 100 })}
            </span>
            <span class="m-mover-change {pnlSignClass(a.change24h)}">
              {formatPct(a.change24h)}
            </span>
          </a>
        {/each}
      </div>
    </section>
  {/if}

  {#if !search.trim() && (positionsLoading || positionsError || positions.length > 0)}
    <section class="m-positions safe-x" aria-label="Top positions">
      <h2 class="m-section-title">Top positions</h2>
      {#if positionsLoading}
        <ul class="m-tp-list" aria-busy="true">
          {#each Array(6) as _, i (i)}
            <li class="m-tp-skel">
              <span class="m-skeleton m-skeleton-icon"></span>
              <span class="m-skeleton-main">
                <span class="m-skeleton m-skeleton-line"></span>
                <span class="m-skeleton m-skeleton-line-sm"></span>
              </span>
              <span class="m-skeleton m-skeleton-stat"></span>
            </li>
          {/each}
        </ul>
      {:else if positionsError}
        <div class="m-mini-error" role="alert">{positionsError}</div>
      {:else}
        <ol class="m-tp-list">
          {#each positions as p, i (p.address + p.coin)}
            <li>
              <a class="m-tp-row tappable" href={`/trader/${p.address}`}>
                <span class="m-tp-rank">{i + 1}</span>
                <span class="m-tp-icon" class:is-white={coinNeedsWhiteBg(p.coin)}>
                  {#if coinIconUrl(p.coin)}
                    <img src={coinIconUrl(p.coin)} alt="" loading="lazy" />
                  {/if}
                </span>
                <span class="m-tp-main">
                  <span class="m-tp-coin">{coinDisplayName(p.coin)}</span>
                  <span class="m-tp-trader">{shortAddress(p.address)}</span>
                </span>
                <span class="m-tp-stats">
                  <span class="m-tp-notional">{formatUsd(p.notionalUsd)}</span>
                  <span
                    class="m-tp-side"
                    class:is-long={p.side === 'long'}
                    class:is-short={p.side === 'short'}
                  >
                    {p.side === 'long' ? 'LONG' : 'SHORT'}
                  </span>
                </span>
              </a>
            </li>
          {/each}
        </ol>
      {/if}
    </section>
  {/if}

  <h2 class="m-section-title safe-x">{search.trim() ? 'Results' : 'Assets'}</h2>

  {#if loading}
    <ul class="m-card-list" aria-busy="true">
      {#each Array(10) as _, i (i)}
        <li class="m-skeleton-row">
          <span class="m-skeleton m-skeleton-icon"></span>
          <span class="m-skeleton-main">
            <span class="m-skeleton m-skeleton-line"></span>
            <span class="m-skeleton m-skeleton-line-sm"></span>
          </span>
          <span class="m-skeleton m-skeleton-stat"></span>
        </li>
      {/each}
    </ul>
  {:else if errorMsg}
    <div class="m-error safe-x" role="alert">
      <p>{errorMsg}</p>
      <button type="button" class="m-error-retry tappable" onclick={() => load()}>
        Retry
      </button>
    </div>
  {:else if filtered.length === 0}
    <div class="m-empty safe-x">
      <p>No assets match “{search}”.</p>
    </div>
  {:else}
    <ul class="m-card-list">
      {#each filtered.slice(0, 200) as a (a.coin)}
        <li>
          <MobileAssetRow asset={a} />
        </li>
      {/each}
      {#if filtered.length > 200}
        <li class="m-footnote">
          Showing 200 of {filtered.length} — refine search to narrow.
        </li>
      {/if}
    </ul>
  {/if}
</main>

<style>
  .m-page {
    display: flex;
    flex-direction: column;
    min-height: 100vh;
    padding-bottom: calc(var(--safe-bottom) + 80px);
  }

  .m-page-header {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding-top: var(--space-3);
    padding-bottom: var(--space-3);
    background: var(--stripe-bg-deep);
  }

  .m-search-input {
    flex: 1 1 auto;
    min-width: 0;
    height: 40px;
    padding: 0 12px;
    background: var(--stripe-bg-secondary);
    border: 1px solid var(--stripe-border);
    border-radius: var(--radius-md);
    color: var(--stripe-text-primary);
    font-family: var(--font-mono);
    /* Keep 16px so iOS Safari doesn't zoom the page on focus. */
    font-size: var(--type-body);
  }

  .m-search-input::placeholder {
    color: var(--stripe-text-muted);
  }

  .m-search-input:focus {
    outline: none;
    border-color: var(--stripe-accent);
    box-shadow: var(--shadow-focus);
  }

  .m-movers {
    padding-bottom: var(--space-4);
  }

  .m-section-title {
    font-family: var(--font-mono);
    font-size: var(--type-footnote);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--stripe-text-tertiary);
    margin: 0 0 var(--space-2);
    font-weight: 500;
  }

  .m-movers-scroll {
    display: flex;
    gap: var(--space-2);
    overflow-x: auto;
    overscroll-behavior-x: contain;
    scrollbar-width: none;
    margin: 0 calc(-1 * max(var(--safe-left), var(--space-4)));
    padding: 0 max(var(--safe-left), var(--space-4));
  }
  .m-movers-scroll::-webkit-scrollbar {
    display: none;
  }

  /* Single-line pill — mirrors the home Pre-IPO cards: icon · name · price ·
     change on one row, width sized to content. */
  .m-mover-card {
    flex: 0 0 auto;
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: 7px 12px;
    background: var(--glass-bg);
    border-radius: var(--radius-md);
    color: inherit;
    text-decoration: none;
    white-space: nowrap;
  }

  .m-mover-icon {
    flex: 0 0 22px;
    width: 22px;
    height: 22px;
    border-radius: var(--radius-full);
    background: var(--stripe-bg-secondary);
    border: 1px solid var(--stripe-border-light);
    overflow: hidden;
  }
  .m-mover-icon.is-white {
    background: #fff;
  }
  .m-mover-icon img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .m-mover-name {
    font-family: var(--font-sans);
    font-size: var(--type-footnote);
    font-weight: 600;
    color: var(--stripe-text-primary);
  }

  .m-mover-price {
    font-family: var(--font-mono);
    font-variant-numeric: tabular-nums;
    font-size: var(--type-caption);
    color: var(--stripe-text-primary);
  }

  .m-mover-change {
    font-family: var(--font-mono);
    font-variant-numeric: tabular-nums;
    font-size: 11px;
    color: var(--stripe-text-tertiary);
  }
  .m-mover-change:global(.k-pnl-positive) {
    color: var(--stripe-success);
  }
  .m-mover-change:global(.k-pnl-negative) {
    color: var(--stripe-danger);
  }

  .m-skeleton-row {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-3) var(--space-4);
    min-height: var(--touch-comfortable);
  }
  .m-skeleton-icon {
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
    width: 60%;
  }
  .m-skeleton-line-sm {
    height: 10px;
    width: 40%;
  }
  .m-skeleton-stat {
    width: 64px;
    height: 28px;
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
    background: var(--stripe-accent-subtle);
    color: var(--stripe-accent);
    border: 1px solid var(--stripe-accent);
    border-radius: var(--radius-md);
    font-family: var(--font-mono);
    cursor: pointer;
  }

  .m-footnote {
    padding: var(--space-4);
    text-align: center;
    font-size: var(--type-caption);
    color: var(--stripe-text-muted);
    font-family: var(--font-mono);
  }

  /* ── Top positions ──────────────────────────────────────── */
  .m-positions {
    padding-bottom: var(--space-4);
  }

  .m-tp-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }

  .m-tp-row {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-2);
    border-radius: var(--radius-md);
    text-decoration: none;
    color: inherit;
    min-height: var(--touch-min);
  }

  .m-tp-rank {
    flex: 0 0 18px;
    text-align: center;
    font-family: var(--font-mono);
    font-variant-numeric: tabular-nums;
    font-size: var(--type-caption);
    color: var(--stripe-text-muted);
  }

  .m-tp-icon {
    flex: 0 0 30px;
    width: 30px;
    height: 30px;
    border-radius: var(--radius-full);
    background: var(--stripe-bg-tertiary);
    overflow: hidden;
  }
  .m-tp-icon.is-white {
    background: #fff;
  }
  .m-tp-icon img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .m-tp-main {
    flex: 1 1 auto;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 1px;
  }
  .m-tp-coin {
    font-family: var(--font-mono);
    font-size: var(--type-footnote);
    font-weight: 500;
    color: var(--stripe-text-primary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .m-tp-trader {
    font-family: var(--font-mono);
    font-size: var(--type-caption);
    color: var(--stripe-text-muted);
  }

  .m-tp-stats {
    flex: 0 0 auto;
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 2px;
  }
  .m-tp-notional {
    font-family: var(--font-mono);
    font-variant-numeric: tabular-nums;
    font-size: var(--type-footnote);
    font-weight: 700;
    color: var(--stripe-text-primary);
  }
  .m-tp-side {
    font-family: var(--font-mono);
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.04em;
    padding: 1px 6px;
    border-radius: var(--radius-sm);
  }
  .m-tp-side.is-long {
    color: var(--stripe-success);
    background: var(--stripe-success-subtle);
  }
  .m-tp-side.is-short {
    color: var(--stripe-danger);
    background: var(--stripe-danger-subtle);
  }

  .m-tp-skel {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-2);
    min-height: var(--touch-min);
  }

  .m-mini-error {
    padding: var(--space-3) 0;
    font-family: var(--font-mono);
    font-size: var(--type-footnote);
    color: var(--stripe-danger);
  }
</style>
