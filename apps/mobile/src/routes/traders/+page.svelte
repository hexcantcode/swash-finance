<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { goto } from '$app/navigation';
  import { page } from '$app/stores';
  import MobileLeaderRow from '$lib/components/MobileLeaderRow.svelte';
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

  let rows = $state<LeaderRow[]>([]);
  let total = $state(0);
  let loading = $state(true);
  let refreshing = $state(false);
  let errorMsg = $state<string | null>(null);

  // Sort + search are driven from the URL so deep-links work and the back
  // button is meaningful. Defaults: composite score, no search.
  const sort = $derived<LeaderSort>(
    (($page.url.searchParams.get('sort') as LeaderSort | null) ?? 'score'),
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

  onMount(() => {
    mounted = true;
    void load();
  });

  onDestroy(() => {
    abortCtrl?.abort();
  });

  // Re-fetch when sort or search changes (driven by URL).
  $effect(() => {
    if (!mounted) return;
    // Touch the derived values so the effect re-runs on URL change.
    void sort;
    void search;
    void load({ silent: true });
  });
</script>

<svelte:head>
  <title>Leaderboard · Swash</title>
</svelte:head>

<main id="main-content" class="m-page">
  <div
    class="m-sort-strip safe-x"
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
    <ul class="m-list" aria-busy="true" aria-label="Loading leaderboard">
      {#each Array(8) as _, i (i)}
        <li class="m-skeleton-row">
          <span class="m-skeleton m-skeleton-rank"></span>
          <span class="m-skeleton-main">
            <span class="m-skeleton m-skeleton-line"></span>
            <span class="m-skeleton m-skeleton-line-sm"></span>
          </span>
          <span class="m-skeleton m-skeleton-score"></span>
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
  {:else if rows.length === 0}
    <div class="m-empty safe-x">
      <p>No traders match this filter.</p>
    </div>
  {:else}
    <ul class="m-list">
      {#each rows as row, i (row.address)}
        <li>
          <MobileLeaderRow {row} rank={i + 1} />
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
    padding-bottom: calc(var(--safe-bottom) + 80px); /* bottom nav clearance */
  }

  .m-sort-strip {
    display: flex;
    gap: var(--space-2);
    padding-top: var(--space-2);
    padding-bottom: var(--space-3);
    overflow-x: auto;
    overscroll-behavior-x: contain;
    scrollbar-width: none;
  }
  .m-sort-strip::-webkit-scrollbar {
    display: none;
  }

  .m-sort-chip {
    padding: 8px 16px;
    min-height: 36px;
    border-radius: var(--radius-md);
    background: var(--glass-white-bg);
    -webkit-backdrop-filter: var(--glass-blur);
    backdrop-filter: var(--glass-blur);
    color: var(--stripe-text-secondary);
    font-family: var(--font-mono);
    font-size: var(--type-footnote);
    border: 1px solid transparent;
    box-shadow: var(--glass-white-highlight);
    cursor: pointer;
    white-space: nowrap;
  }

  /* Selected = the only chip with a visible border; unselected are borderless
     filled chips. The border is the highlight. */
  .m-sort-chip.is-active {
    border-color: rgba(255, 255, 255, 0.45);
    color: var(--stripe-text-primary);
  }

  .m-skeleton-row {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-3) var(--space-4);
    min-height: var(--touch-comfortable);
  }
  .m-skeleton-rank {
    width: 24px;
    height: 14px;
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
  .m-skeleton-score {
    width: 48px;
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
</style>
