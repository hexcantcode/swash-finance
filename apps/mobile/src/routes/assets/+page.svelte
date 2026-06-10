<script lang="ts">
  import { onMount, onDestroy, tick } from 'svelte';
  import MobileAssetRow from '$lib/components/MobileAssetRow.svelte';
  import { listAssets, deriveMovers, type Asset, type AssetMovers } from '$lib/api/assets';
  import { liveFeed } from '$lib/live/live-feed.svelte';
  import {
    coinDisplayName,
    coinIconUrl,
    coinNeedsWhiteBg,
    coinIconBg,
    coinCategory,
    type CoinCategory,
  } from '$lib/utils/coin';
  import { formatUsd, formatPct, pnlSignClass } from '$lib/utils/format';
  import MobileTicker from '$lib/components/MobileTicker.svelte';

  const CATEGORIES: { value: CoinCategory; label: string }[] = [
    { value: 'stocks', label: 'Stock' },
    { value: 'crypto', label: 'Crypto' },
    { value: 'commodity', label: 'Commodity' },
    { value: 'index', label: 'Index' },
  ];

  let assets = $state<Asset[]>([]);
  let movers = $state<AssetMovers | null>(null);
  let loading = $state(true);
  let errorMsg = $state<string | null>(null);
  let search = $state('');
  let activeCategory = $state<CoinCategory | null>(null);
  let favActive = $state(false);

  // Search starts collapsed to a magnifying-glass icon; expanded shows the
  // input + close button. Any existing search text forces the expanded view
  // (handled by the template condition `searchOpen || search.trim()`).
  let searchOpen = $state(false);
  let searchInputEl = $state<HTMLInputElement | undefined>(undefined);

  async function openSearch() {
    searchOpen = true;
    await tick();
    searchInputEl?.focus();
  }
  function closeSearch() {
    search = '';
    searchOpen = false;
  }
  function onSearchKey(e: KeyboardEvent) {
    if (e.key === 'Escape') closeSearch();
  }

  function selectCategory(cat: CoinCategory) {
    favActive = false;
    activeCategory = activeCategory === cat ? null : cat;
  }
  function toggleFav() {
    favActive = !favActive;
    if (favActive) activeCategory = null;
  }

  let abortCtrl: AbortController | null = null;
  let mounted = false;
  let stopLive: (() => void) | null = null;

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
      : favActive
        ? []
        : (movers?.byVolume ?? assets).filter(
            (a) => activeCategory === null || coinCategory(a.coin, a.dex) === activeCategory,
          ),
  );

  onMount(() => {
    mounted = true;
    void load();
    stopLive = liveFeed.subscribe();
  });

  onDestroy(() => {
    abortCtrl?.abort();
    stopLive?.();
  });
</script>

<svelte:head>
  <title>Markets · Swash</title>
</svelte:head>

<main id="main-content" class="m-page">
  <MobileTicker />

  {#if !search.trim() && movers && movers.winners.length > 0}
    <section class="m-movers safe-x" aria-label="Top movers">
      <h2 class="m-section-title">Top movers</h2>
      <div class="m-movers-scroll">
        {#each movers.winners as a (a.coin)}
          <a class="m-mover-card tappable" href={`/assets/${encodeURIComponent(a.coin)}`}>
            <div class="m-mover-icon" class:is-white={coinNeedsWhiteBg(a.coin)} style:background-color={coinIconBg(a.coin)} style:padding={coinIconBg(a.coin) ? '3px' : null}>
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

  <div class="m-assets-head safe-x">
    <h2 class="m-section-title">{search.trim() ? 'Results' : 'Markets'}</h2>
    <div class="m-search-slot">
      {#if searchOpen || search.trim()}
        <input
          bind:this={searchInputEl}
          type="search"
          class="m-search-input"
          placeholder="Search…"
          bind:value={search}
          onkeydown={onSearchKey}
          aria-label="Search markets"
        />
        <button
          type="button"
          class="m-search-iconbtn tappable"
          onclick={closeSearch}
          aria-label="Close search"
        >
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M18 6 6 18 M6 6l12 12" />
          </svg>
        </button>
      {:else}
        <button
          type="button"
          class="m-search-iconbtn tappable"
          onclick={openSearch}
          aria-label="Search markets"
        >
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <circle cx="11" cy="11" r="7" />
            <path d="m21 21-4.3-4.3" />
          </svg>
        </button>
      {/if}
    </div>
  </div>

  {#if !search.trim()}
    <div class="m-filter-row" role="tablist" aria-label="Market filters">
      <button
        type="button"
        class="m-filter-chip m-filter-star tappable tap-hit"
        class:is-active={favActive}
        aria-pressed={favActive}
        aria-label="Favorites"
        onclick={toggleFav}
      >
        <svg viewBox="0 0 24 24" width="15" height="15" fill={favActive ? 'currentColor' : 'none'} stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
        </svg>
      </button>
      {#each CATEGORIES as c (c.value)}
        <button
          type="button"
          role="tab"
          aria-selected={activeCategory === c.value}
          class="m-filter-chip tappable tap-hit"
          class:is-active={activeCategory === c.value}
          onclick={() => selectCategory(c.value)}
        >
          {c.label}
        </button>
      {/each}
    </div>
  {/if}

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
      <button type="button" class="m-error-retry m-btn tappable" onclick={() => load()}>
        Retry
      </button>
    </div>
  {:else if favActive}
    <div class="m-empty safe-x">
      <p>No favorites yet — tap ☆ on an asset to save it.</p>
    </div>
  {:else if filtered.length === 0}
    <div class="m-empty safe-x">
      <p>{search.trim() ? `No markets match “${search}”.` : 'No markets in this category.'}</p>
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

  /* "Markets" / "Results" heading row with the collapsible search slot. */
  .m-assets-head {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    margin-bottom: var(--space-3);
  }
  .m-assets-head .m-section-title {
    flex: 0 0 auto;
    margin: 0;
  }

  /* Slot fills the row to the right; expanded input grows inside it,
     collapsed state just shows the icon button anchored right. */
  .m-search-slot {
    flex: 1 1 auto;
    min-width: 0;
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 6px;
  }

  /* Borderless icon button for both the open (search) and close (✕) actions. */
  .m-search-iconbtn {
    flex: 0 0 auto;
    display: grid;
    place-items: center;
    width: 28px;
    height: 28px;
    background: transparent;
    border: 0;
    border-radius: var(--radius-full);
    color: var(--stripe-text-secondary);
    cursor: pointer;
    transition:
      background var(--motion-fast) var(--motion-ease),
      color var(--motion-fast) var(--motion-ease);
  }
  .m-search-iconbtn:hover {
    background: var(--glass-white-bg);
    color: var(--stripe-text-primary);
  }
  .m-search-iconbtn:active {
    background: var(--stripe-accent-subtle);
  }

  /* Frameless glass field — the blank track is a glass surface (no border),
     and focus presses it in (depth, not an outline ring) to match the chip
     selection language. */
  .m-search-input {
    flex: 1 1 auto;
    min-width: 0;
    height: 28px;
    padding: 0 10px;
    background: var(--glass-bg);
    -webkit-backdrop-filter: var(--glass-blur);
    backdrop-filter: var(--glass-blur);
    border: 0;
    border-radius: var(--radius-lg);
    box-shadow: var(--glass-highlight);
    color: var(--stripe-text-primary);
    font-family: var(--font-mono);
    /* Keep 16px so iOS Safari doesn't zoom the page on focus — shrink the box
       (height/padding), not the font, when making this more compact. */
    font-size: var(--type-body);
  }

  .m-search-input::placeholder {
    color: var(--stripe-text-muted);
  }

  .m-search-input:focus {
    outline: none;
    background: var(--glass-pressed-bg);
    box-shadow: var(--glass-pressed-inset);
  }

  .m-movers {
    padding-bottom: var(--space-4);
  }

  .m-section-title {
    font-family: var(--font-sans);
    font-size: var(--type-body);
    font-weight: 600;
    color: var(--stripe-text-primary);
    margin: 0 0 var(--space-2);
  }

  /* Filter strip — glass container that mirrors the bottom-nav language;
     chips inside are transparent labels that press into the surface when
     selected (see home page for the same pattern). */
  .m-filter-row {
    display: flex;
    gap: var(--space-1);
    overflow-x: auto;
    overflow-y: hidden;
    scrollbar-width: none;
    margin: 0 max(var(--safe-left), var(--space-4)) var(--space-3);
    padding: var(--space-1);
    background: var(--glass-bg);
    -webkit-backdrop-filter: var(--glass-blur);
    backdrop-filter: var(--glass-blur);
    border-radius: var(--radius-xl);
    box-shadow: var(--glass-highlight);
  }
  .m-filter-row::-webkit-scrollbar {
    display: none;
  }
  .m-filter-chip {
    flex: 0 0 auto;
    min-height: 32px;
    padding: 6px 14px;
    border-radius: var(--radius-lg);
    background: transparent;
    color: var(--stripe-text-secondary);
    font-family: var(--font-mono);
    font-size: var(--type-footnote);
    cursor: pointer;
    white-space: nowrap;
  }
  .m-filter-chip.is-active {
    background: var(--glass-pressed-bg);
    box-shadow: var(--glass-pressed-inset);
    color: var(--stripe-text-primary);
  }
  .m-filter-star {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 6px 12px;
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

  /* Page-specific skeleton bones (shared row/line bones + error/empty states
     live in lib/styles/mobile.css). */
  .m-skeleton-icon {
    width: 36px;
    height: 36px;
    border-radius: var(--radius-full);
  }
  .m-skeleton-stat {
    width: 64px;
    height: 28px;
  }

  .m-footnote {
    padding: var(--space-4);
    text-align: center;
    font-size: var(--type-caption);
    color: var(--stripe-text-muted);
    font-family: var(--font-mono);
  }

</style>
