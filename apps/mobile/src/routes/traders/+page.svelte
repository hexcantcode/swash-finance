<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { goto } from '$app/navigation';
  import { page } from '$app/stores';
  import MobileTraderCard from '$lib/components/MobileTraderCard.svelte';
  import { listLeaders, type LeaderRow, type LeaderSort } from '$lib/api/leaders';

  // Client-only data loading. No server-side data fetch here — apps/web owns
  // the canonical leaderboard query and exposes it at /api/leaders. The Vite
  // dev proxy routes that path to apps/web (port 5173); the Capacitor build
  // injects PUBLIC_API_BASE so the same code resolves cross-origin.

  const SORTS: { value: LeaderSort; label: string }[] = [
    { value: 'score', label: 'Score' },
    { value: 'pnl', label: 'PnL' },
    { value: 'equity', label: 'Equity' },
    { value: 'frequency', label: 'Active' },
  ];

  type Focus = 'all' | 'equity' | 'crypto';
  const FOCI: { value: Focus; label: string }[] = [
    { value: 'all', label: 'All' },
    { value: 'equity', label: 'Equity' },
    { value: 'crypto', label: 'Crypto' },
  ];

  let rows = $state<LeaderRow[]>([]);
  let total = $state(0);
  let loading = $state(true);
  let refreshing = $state(false);
  let errorMsg = $state<string | null>(null);

  // Sort, focus, and search are driven from the URL so deep-links work and the
  // back button is meaningful. Defaults: composite score, all traders, no search.
  const sort = $derived<LeaderSort>(
    (($page.url.searchParams.get('sort') as LeaderSort | null) ?? 'score'),
  );
  const focus = $derived<Focus>(
    (($page.url.searchParams.get('focus') as Focus | null) ?? 'all'),
  );
  const search = $derived($page.url.searchParams.get('search') ?? '');

  let mounted = false;
  let abortCtrl: AbortController | null = null;

  async function load(opts: { silent?: boolean } = {}) {
    abortCtrl?.abort();
    abortCtrl = new AbortController();
    if (opts.silent) refreshing = true;
    else loading = true;
    errorMsg = null;
    try {
      const args: Parameters<typeof listLeaders>[0] = { sort, limit: 50 };
      if (search) args.search = search;
      if (focus !== 'all') args.focus = focus;
      const result = await listLeaders(args);
      rows = result.rows;
      total = result.total;
    } catch (err) {
      if ((err as Error).name === 'AbortError') return;
      errorMsg = (err as Error).message || 'Failed to load leaderboard';
    } finally {
      loading = false;
      refreshing = false;
    }
  }

  function setSort(next: LeaderSort) {
    const url = new URL($page.url);
    if (next === 'score') url.searchParams.delete('sort');
    else url.searchParams.set('sort', next);
    goto(`${url.pathname}${url.search}`, { replaceState: true, keepFocus: true });
  }

  function setFocus(next: Focus) {
    const url = new URL($page.url);
    if (next === 'all') url.searchParams.delete('focus');
    else url.searchParams.set('focus', next);
    goto(`${url.pathname}${url.search}`, { replaceState: true, keepFocus: true });
  }

  onMount(() => {
    mounted = true;
    void load();
  });

  onDestroy(() => {
    abortCtrl?.abort();
  });

  // Re-fetch when sort / focus / search change (driven by URL).
  $effect(() => {
    if (!mounted) return;
    // Touch the derived values so the effect re-runs on URL change.
    void sort;
    void focus;
    void search;
    void load({ silent: true });
  });
</script>

<svelte:head>
  <title>Leaderboard · Swash</title>
</svelte:head>

<main id="main-content" class="m-page">
  <div
    class="m-sort-strip"
    role="tablist"
    aria-label="Filter by asset class"
  >
    {#each FOCI as opt (opt.value)}
      <button
        type="button"
        role="tab"
        aria-selected={focus === opt.value}
        class="m-sort-chip tappable"
        class:is-active={focus === opt.value}
        onclick={() => setFocus(opt.value)}
      >
        {opt.label}
      </button>
    {/each}
  </div>
  <div
    class="m-sort-strip"
    role="tablist"
    aria-label="Sort leaderboard"
  >
    {#each SORTS as opt (opt.value)}
      <button
        type="button"
        role="tab"
        aria-selected={sort === opt.value}
        class="m-sort-chip tappable"
        class:is-active={sort === opt.value}
        onclick={() => setSort(opt.value)}
      >
        {opt.label}
      </button>
    {/each}
  </div>

  {#if refreshing && !loading}
    <div class="m-loading-bar" aria-hidden="true"></div>
  {/if}

  {#if loading}
    <div class="m-cards" aria-busy="true" aria-label="Loading leaderboard">
      {#each Array(6) as _, i (i)}
        <div class="m-skeleton m-card-skel"></div>
      {/each}
    </div>
  {:else if errorMsg}
    <div class="m-error safe-x" role="alert">
      <p>{errorMsg}</p>
      <button type="button" class="m-error-retry m-btn tappable" onclick={() => load()}>
        Retry
      </button>
    </div>
  {:else if rows.length === 0}
    <div class="m-empty safe-x">
      <p>No traders match this filter.</p>
    </div>
  {:else}
    <div class="m-cards">
      {#each rows as row (row.address)}
        <MobileTraderCard {row} />
      {/each}
    </div>
  {/if}
</main>

<style>
  .m-page {
    display: flex;
    flex-direction: column;
    min-height: 100vh;
    padding-top: var(--space-3);
    padding-bottom: calc(var(--safe-bottom) + 80px); /* bottom nav clearance */
  }

  /* Sort strip — glass container, same language as the bottom-nav and the
     home/assets filter strips. */
  .m-sort-strip {
    display: flex;
    gap: var(--space-1);
    overflow-x: auto;
    overflow-y: hidden;
    overscroll-behavior-x: contain;
    scrollbar-width: none;
    margin: var(--space-2) max(var(--safe-left), var(--space-4)) var(--space-3);
    padding: var(--space-1);
    background: var(--glass-bg);
    -webkit-backdrop-filter: var(--glass-blur);
    backdrop-filter: var(--glass-blur);
    border-radius: var(--radius-xl);
    box-shadow: var(--glass-highlight);
  }
  .m-sort-strip::-webkit-scrollbar {
    display: none;
  }

  .m-sort-chip {
    flex: 0 0 auto;
    padding: 6px 14px;
    min-height: 32px;
    border-radius: var(--radius-lg);
    background: transparent;
    color: var(--stripe-text-secondary);
    font-family: var(--font-mono);
    font-size: var(--type-footnote);
    cursor: pointer;
    white-space: nowrap;
  }

  /* Active = pressed into the container's glass surface. */
  .m-sort-chip.is-active {
    background: var(--glass-pressed-bg);
    box-shadow: var(--glass-pressed-inset);
    color: var(--stripe-text-primary);
  }

  /* Card stack — replaces the old list. Inset to the page edges so cards
     stand apart from the screen frame; gap matches the home-page section
     spacing. */
  .m-cards {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    margin: 0 max(var(--safe-left), var(--space-4));
  }
  .m-card-skel {
    height: 188px;
    border-radius: var(--radius-lg);
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
