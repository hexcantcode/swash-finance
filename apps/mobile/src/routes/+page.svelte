<script lang="ts">
  import { onMount } from 'svelte';
  import MobileTraderCard from '$lib/components/MobileTraderCard.svelte';
  import MobileAssetRow from '$lib/components/MobileAssetRow.svelte';
  import { listTopTraders, type TopTrader, type LeaderWindow } from '$lib/api/leaders-top';
  import { listAssets, type Asset } from '$lib/api/assets';
  import { coinCategory, coinDisplayName, coinIconUrl, coinNeedsWhiteBg, type CoinCategory } from '$lib/utils/coin';
  import { formatUsd, formatPct, pnlSignClass } from '$lib/utils/format';

  // ── Top traders ──────────────────────────────────────────
  const WINDOWS: { value: LeaderWindow; label: string }[] = [
    { value: '1d', label: '1d' },
    { value: '7d', label: '7d' },
    { value: '30d', label: '1m' },
  ];
  let tf = $state<LeaderWindow>('7d');
  let traders = $state<TopTrader[]>([]);
  let tradersLoading = $state(true);
  let tradersError = $state<string | null>(null);
  let mounted = false;
  let tradersCtrl: AbortController | null = null;

  const windowLabel = $derived(WINDOWS.find((w) => w.value === tf)?.label ?? '');

  async function loadTraders() {
    tradersCtrl?.abort();
    tradersCtrl = new AbortController();
    tradersLoading = true;
    tradersError = null;
    try {
      traders = await listTopTraders(tf, 12);
    } catch (err) {
      tradersError = (err as Error).message || 'Failed to load top traders';
    } finally {
      tradersLoading = false;
    }
  }

  // ── Assets + featured companies ──────────────────────────
  // Hand-picked private-company markets surfaced as featured cards. Display
  // labels are nicer than the bare ticker. A card self-hides if its market
  // isn't in the live asset list.
  const FEATURED: { coin: string; label: string }[] = [
    { coin: 'vntl:OPENAI', label: 'OpenAI' },
    { coin: 'vntl:ANTHROPIC', label: 'Anthropic' },
    { coin: 'xyz:SPCX', label: 'SpaceX' },
  ];

  const CATEGORIES: { value: CoinCategory; label: string }[] = [
    { value: 'stocks', label: 'Stock' },
    { value: 'crypto', label: 'Crypto' },
    { value: 'commodity', label: 'Commodity' },
    { value: 'index', label: 'Index' },
  ];

  let assets = $state<Asset[]>([]);
  let assetsLoading = $state(true);
  let assetsError = $state<string | null>(null);
  let activeCategory = $state<CoinCategory | null>(null);
  let favActive = $state(false);

  async function loadAssets() {
    assetsLoading = true;
    assetsError = null;
    try {
      assets = await listAssets();
    } catch (err) {
      assetsError = (err as Error).message || 'Failed to load assets';
    } finally {
      assetsLoading = false;
    }
  }

  const featured = $derived(
    FEATURED.map((f) => {
      const asset = assets.find((a) => a.coin === f.coin);
      return asset ? { ...f, asset } : null;
    }).filter((x): x is { coin: string; label: string; asset: Asset } => x !== null),
  );

  // Top 25 by 24h volume, optionally filtered to the active category.
  const topAssets = $derived(
    [...assets]
      .filter((a) => activeCategory === null || coinCategory(a.coin, a.dex) === activeCategory)
      .sort((a, b) => (b.volume24h ?? 0) - (a.volume24h ?? 0))
      .slice(0, 25),
  );

  function selectCategory(cat: CoinCategory) {
    favActive = false;
    activeCategory = activeCategory === cat ? null : cat;
  }
  function toggleFav() {
    favActive = !favActive;
    if (favActive) activeCategory = null;
  }

  onMount(() => {
    mounted = true;
    void loadAssets();
    void loadTraders();
  });

  $effect(() => {
    if (!mounted) return;
    void tf;
    void loadTraders();
  });
</script>

<svelte:head>
  <title>Swash — Top traders, mirrored to your wallet</title>
</svelte:head>

<main id="main-content" class="m-page">
  <!-- ── Top Traders ─────────────────────────────────────── -->
  <section class="m-home-section">
    <header class="m-section-head safe-x">
      <h2 class="m-section-title">Top Traders</h2>
      <div class="m-seg" role="tablist" aria-label="Top traders timeframe">
        {#each WINDOWS as w (w.value)}
          <button
            type="button"
            role="tab"
            aria-selected={tf === w.value}
            class="m-seg-btn tappable"
            class:is-active={tf === w.value}
            onclick={() => (tf = w.value)}
          >
            {w.label}
          </button>
        {/each}
      </div>
    </header>

    {#if tradersLoading}
      <div class="m-tcard-scroll safe-x" aria-busy="true">
        {#each Array(4) as _, i (i)}
          <div class="m-skeleton m-tcard-skel"></div>
        {/each}
      </div>
    {:else if tradersError}
      <div class="m-mini-error safe-x" role="alert">{tradersError}</div>
    {:else if traders.length === 0}
      <div class="m-mini-empty safe-x">No {windowLabel} data yet.</div>
    {:else}
      <div class="m-tcard-scroll safe-x">
        {#each traders as t (t.address)}
          <MobileTraderCard trader={t} {windowLabel} />
        {/each}
      </div>
    {/if}
  </section>

  <!-- ── Featured companies ──────────────────────────────── -->
  {#if featured.length > 0}
    <section class="m-home-section">
      <header class="m-section-head safe-x">
        <h2 class="m-section-title">Featured</h2>
      </header>
      <div class="m-company-row safe-x">
        {#each featured as f (f.coin)}
          <a class="m-company-card tappable" href={`/assets/${encodeURIComponent(f.coin)}`}>
            <div class="m-company-icon" class:is-white={coinNeedsWhiteBg(f.coin)}>
              {#if coinIconUrl(f.coin)}
                <img src={coinIconUrl(f.coin)} alt="" loading="lazy" />
              {/if}
            </div>
            <div class="m-company-name">{f.label}</div>
            <div class="m-company-price">
              {formatUsd(f.asset.price, { precise: (f.asset.price ?? 0) < 100 })}
            </div>
            <div class="m-company-change {pnlSignClass(f.asset.change24h)}">
              {formatPct(f.asset.change24h)}
            </div>
          </a>
        {/each}
      </div>
    </section>
  {/if}

  <!-- ── Assets ──────────────────────────────────────────── -->
  <section class="m-home-section">
    <header class="m-section-head safe-x">
      <h2 class="m-section-title">Assets</h2>
      <a href="/assets" class="m-see-all tappable">See all</a>
    </header>

    <div class="m-filter-row safe-x" role="tablist" aria-label="Asset filters">
      <button
        type="button"
        class="m-filter-chip m-filter-star tappable"
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
          class="m-filter-chip tappable"
          class:is-active={activeCategory === c.value}
          onclick={() => selectCategory(c.value)}
        >
          {c.label}
        </button>
      {/each}
    </div>

    {#if assetsLoading}
      <ul class="m-list" aria-busy="true">
        {#each Array(6) as _, i (i)}
          <li class="m-skeleton-row">
            <span class="m-skeleton m-skeleton-avatar"></span>
            <span class="m-skeleton-main">
              <span class="m-skeleton m-skeleton-line"></span>
              <span class="m-skeleton m-skeleton-line-sm"></span>
            </span>
          </li>
        {/each}
      </ul>
    {:else if assetsError}
      <div class="m-mini-error safe-x" role="alert">{assetsError}</div>
    {:else if favActive}
      <div class="m-mini-empty safe-x">No favorites yet — tap ☆ on an asset to save it.</div>
    {:else if topAssets.length === 0}
      <div class="m-mini-empty safe-x">No assets in this category.</div>
    {:else}
      <ul class="m-list">
        {#each topAssets as a (a.coin)}
          <li><MobileAssetRow asset={a} showVolume={false} /></li>
        {/each}
      </ul>
    {/if}
  </section>
</main>

<style>
  .m-page {
    display: flex;
    flex-direction: column;
    min-height: 100vh;
    padding-top: var(--space-3);
    padding-bottom: calc(var(--safe-bottom) + 80px);
  }

  .m-home-section {
    margin-bottom: var(--space-6);
  }

  .m-section-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
    margin-bottom: var(--space-3);
  }

  .m-section-title {
    font-family: var(--font-sans);
    font-size: var(--type-headline);
    font-weight: 600;
    color: var(--stripe-text-primary);
    margin: 0;
  }

  .m-see-all {
    font-family: var(--font-mono);
    font-size: var(--type-caption);
    color: var(--stripe-accent);
    text-decoration: none;
    min-height: 32px;
    display: inline-flex;
    align-items: center;
  }

  /* Segmented control (1d / 7d / 1m) — squarish, border+text selection. */
  .m-seg {
    display: inline-flex;
    gap: var(--space-1);
  }
  .m-seg-btn {
    min-height: 32px;
    padding: 5px 12px;
    border-radius: var(--radius-md);
    background: var(--glass-bg);
    -webkit-backdrop-filter: var(--glass-blur);
    backdrop-filter: var(--glass-blur);
    border: 1px solid var(--stripe-border);
    box-shadow: var(--glass-highlight);
    color: var(--stripe-text-secondary);
    font-family: var(--font-mono);
    font-size: var(--type-caption);
    cursor: pointer;
  }
  .m-seg-btn.is-active {
    color: var(--stripe-accent-light);
    border-color: var(--stripe-accent);
  }

  /* Horizontal trader-card strip. */
  .m-tcard-scroll {
    display: flex;
    gap: var(--space-3);
    overflow-x: auto;
    scroll-snap-type: x proximity;
    -webkit-overflow-scrolling: touch;
    scrollbar-width: none;
    padding-bottom: var(--space-1);
  }
  .m-tcard-scroll::-webkit-scrollbar {
    display: none;
  }
  .m-tcard-skel {
    flex: 0 0 auto;
    width: 152px;
    height: 96px;
    border-radius: var(--radius-lg);
  }

  /* Featured company cards — narrower than trader cards. */
  .m-company-row {
    display: flex;
    gap: var(--space-3);
    overflow-x: auto;
    scrollbar-width: none;
  }
  .m-company-row::-webkit-scrollbar {
    display: none;
  }
  .m-company-card {
    flex: 1 1 0;
    min-width: 100px;
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 4px;
    padding: var(--space-3);
    text-decoration: none;
    color: inherit;
    background: var(--glass-bg);
    -webkit-backdrop-filter: var(--glass-blur);
    backdrop-filter: var(--glass-blur);
    border: 1px solid var(--stripe-border);
    border-radius: var(--radius-lg);
    box-shadow: var(--glass-highlight), var(--glass-shadow);
  }
  .m-company-icon {
    width: 28px;
    height: 28px;
    border-radius: var(--radius-full);
    background: var(--stripe-bg-secondary);
    border: 1px solid var(--stripe-border-light);
    overflow: hidden;
    margin-bottom: 2px;
  }
  .m-company-icon.is-white {
    background: #fff;
  }
  .m-company-icon img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
  .m-company-name {
    font-family: var(--font-sans);
    font-size: var(--type-footnote);
    font-weight: 600;
    color: var(--stripe-text-primary);
  }
  .m-company-price {
    font-family: var(--font-mono);
    font-variant-numeric: tabular-nums;
    font-size: var(--type-callout);
    color: var(--stripe-text-primary);
  }
  .m-company-change {
    font-family: var(--font-mono);
    font-variant-numeric: tabular-nums;
    font-size: var(--type-caption);
    color: var(--stripe-text-tertiary);
  }
  .m-company-change:global(.k-pnl-positive) {
    color: var(--stripe-success);
  }
  .m-company-change:global(.k-pnl-negative) {
    color: var(--stripe-danger);
  }

  /* Asset filter row — horizontally scrollable, one line. */
  .m-filter-row {
    display: flex;
    gap: var(--space-2);
    overflow-x: auto;
    scrollbar-width: none;
    margin-bottom: var(--space-3);
  }
  .m-filter-row::-webkit-scrollbar {
    display: none;
  }
  .m-filter-chip {
    flex: 0 0 auto;
    min-height: 34px;
    padding: 6px 14px;
    border-radius: var(--radius-md);
    background: var(--glass-bg);
    -webkit-backdrop-filter: var(--glass-blur);
    backdrop-filter: var(--glass-blur);
    border: 1px solid var(--stripe-border);
    box-shadow: var(--glass-highlight);
    color: var(--stripe-text-secondary);
    font-family: var(--font-mono);
    font-size: var(--type-footnote);
    cursor: pointer;
    white-space: nowrap;
  }
  .m-filter-chip.is-active {
    color: var(--stripe-accent-light);
    border-color: var(--stripe-accent);
  }
  .m-filter-star {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 6px 12px;
  }

  .m-mini-error,
  .m-mini-empty {
    padding: var(--space-5) var(--space-4);
    font-family: var(--font-mono);
    font-size: var(--type-footnote);
    color: var(--stripe-text-tertiary);
  }
  .m-mini-error {
    color: var(--stripe-danger);
  }

  /* Skeleton rows reused from the list screens. */
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
    width: 60%;
  }
  .m-skeleton-line-sm {
    height: 10px;
    width: 40%;
  }
</style>
