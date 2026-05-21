<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import MobileAssetRow from '$lib/components/MobileAssetRow.svelte';
  import { listAssets, deriveMovers, type Asset, type AssetMovers } from '$lib/api/assets';
  import { coinDisplayName, coinIconUrl } from '$lib/utils/coin';
  import { formatPct, pnlSignClass } from '$lib/utils/format';

  let assets = $state<Asset[]>([]);
  let movers = $state<AssetMovers | null>(null);
  let loading = $state(true);
  let errorMsg = $state<string | null>(null);
  let search = $state('');

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
    <h1 class="m-page-title">Assets</h1>
    <p class="m-page-subtitle">
      {#if loading}
        Loading…
      {:else}
        {assets.length} markets · live
      {/if}
    </p>
  </header>

  <div class="m-search safe-x">
    <input
      type="search"
      class="m-search-input"
      placeholder="Search BTC, ETH, TSLA…"
      bind:value={search}
      aria-label="Search assets"
    />
  </div>

  {#if !search.trim() && movers && movers.winners.length > 0}
    <section class="m-movers safe-x" aria-label="Top movers">
      <h2 class="m-section-title">Top movers</h2>
      <div class="m-movers-scroll">
        {#each [...movers.winners, ...movers.losers] as a (a.coin)}
          <a class="m-mover-card tappable" href={`/assets/${encodeURIComponent(a.coin)}`}>
            <div class="m-mover-icon">
              {#if coinIconUrl(a.coin)}
                <img src={coinIconUrl(a.coin)} alt="" loading="lazy" />
              {/if}
            </div>
            <div class="m-mover-name">{coinDisplayName(a.coin)}</div>
            <div class="m-mover-change {pnlSignClass(a.change24h)}">
              {formatPct(a.change24h)}
            </div>
          </a>
        {/each}
      </div>
    </section>
  {/if}

  {#if loading}
    <ul class="m-list" aria-busy="true">
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
    <ul class="m-list">
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
    padding-top: max(var(--safe-top), var(--space-3));
    padding-bottom: var(--space-3);
    background: var(--stripe-bg-deep);
  }

  .m-page-title {
    font-family: var(--font-sans);
    font-size: var(--type-display);
    line-height: var(--line-display);
    font-weight: 600;
    color: var(--stripe-text-primary);
    margin: 0;
  }

  .m-page-subtitle {
    font-size: var(--type-footnote);
    color: var(--stripe-text-tertiary);
    margin: 4px 0 0;
    font-family: var(--font-mono);
  }

  .m-search {
    padding-top: var(--space-2);
    padding-bottom: var(--space-3);
  }

  .m-search-input {
    width: 100%;
    min-height: var(--touch-min);
    padding: 10px 14px;
    background: var(--stripe-bg-secondary);
    border: 1px solid var(--stripe-border);
    border-radius: var(--radius-md);
    color: var(--stripe-text-primary);
    font-family: var(--font-mono);
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

  .m-mover-card {
    flex: 0 0 100px;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 6px;
    padding: var(--space-3);
    background: var(--stripe-bg-secondary);
    border: 0.5px solid var(--stripe-border);
    border-radius: var(--radius-md);
    min-height: var(--touch-comfortable);
    color: inherit;
    text-decoration: none;
  }

  .m-mover-icon {
    width: 28px;
    height: 28px;
    border-radius: var(--radius-full);
    background: var(--stripe-bg-tertiary);
    overflow: hidden;
  }
  .m-mover-icon img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .m-mover-name {
    font-family: var(--font-mono);
    font-size: var(--type-caption);
    color: var(--stripe-text-secondary);
    white-space: nowrap;
  }

  .m-mover-change {
    font-family: var(--font-mono);
    font-variant-numeric: tabular-nums;
    font-size: var(--type-caption);
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
</style>
