<script lang="ts">
  import LeaderTable, { type SortKey } from '$lib/components/LeaderTable.svelte';
  import TradeTicker from '$lib/components/TradeTicker.svelte';
  import { goto } from '$app/navigation';
  import { page } from '$app/stores';
  import type { PageData } from './$types';

  interface Props {
    data: PageData;
  }
  let { data }: Props = $props();

  const TAG_OPTIONS: Array<{ value: string; label: string }> = [
    { value: 'alpha_hunter', label: 'Alpha' },
    { value: 'veteran', label: 'Veteran' },
    { value: 'insider', label: 'Insider' },
    { value: 'specialist', label: 'Specialist' },
    { value: 'dark_horse', label: 'Dark horse' },
  ];

  const ASSET_OPTIONS: Array<{ value: string; label: string }> = [
    { value: 'bluechip', label: 'Bluechip' },
    { value: 'altcoin', label: 'Altcoin' },
    { value: 'meme', label: 'Meme' },
    { value: 'stocks', label: 'Stocks' },
  ];

  const RISK_OPTIONS: Array<{ value: string; label: string }> = [
    { value: 'conservative', label: 'Conservative' },
    { value: 'balanced', label: 'Balanced' },
    { value: 'aggressive', label: 'Aggressive' },
  ];

  let searchInput = $state(data.appliedFilters.search ?? '');

  function setParam(key: string, value: string | undefined): void {
    const params = new URLSearchParams($page.url.searchParams);
    if (value === undefined || value === '') {
      params.delete(key);
    } else {
      params.set(key, value);
    }
    if (key !== 'page') params.delete('page');
    goto(`?${params.toString()}`, { keepFocus: true, noScroll: true });
  }

  function applySearch(e: Event) {
    e.preventDefault();
    setParam('search', searchInput.trim() || undefined);
  }

  function setSort(key: SortKey) {
    setParam('sort', key);
  }

  function resetFilters() {
    searchInput = '';
    goto('/browse');
  }

  const totalPages = $derived(Math.max(1, Math.ceil(data.total / data.limit)));
  const activeFilterCount = $derived(
    Object.values(data.appliedFilters).filter((v) => v !== undefined && v !== '').length,
  );
  const rankOffset = $derived((data.page - 1) * data.limit);
</script>

<svelte:head>
  <title>browse — Swish</title>
</svelte:head>

<main id="main-content" class="stripe-content">
  {#if activeFilterCount > 0}
    <div class="k-browse-clear">
      <button type="button" class="btn-poly" onclick={resetFilters}>
        Clear filters ({activeFilterCount})
      </button>
    </div>
  {/if}

  <div style="margin-bottom: 16px;">
    <TradeTicker trades={data.recentTrades} />
  </div>

  <div class="k-filter-bar">
    <form onsubmit={applySearch} class="k-filter-group" style="flex: 1; min-width: 220px;">
      <input
        type="search"
        bind:value={searchInput}
        placeholder="search address 0x…"
        class="k-filter-search"
      />
    </form>

    <div class="k-filter-group">
      <span class="k-filter-label">Tag</span>
      {#each TAG_OPTIONS as opt (opt.value)}
        {@const active = data.appliedFilters.mainTag === opt.value}
        <button
          type="button"
          class="k-filter-pill"
          class:is-active={active}
          onclick={() => setParam('tag', active ? undefined : opt.value)}
        >
          {opt.label}
        </button>
      {/each}
    </div>

    <div class="k-filter-group">
      <span class="k-filter-label">Asset</span>
      {#each ASSET_OPTIONS as opt (opt.value)}
        {@const active = data.appliedFilters.assetTag === opt.value}
        <button
          type="button"
          class="k-filter-pill"
          class:is-active={active}
          onclick={() => setParam('asset', active ? undefined : opt.value)}
        >
          {opt.label}
        </button>
      {/each}
    </div>

    <div class="k-filter-group">
      <span class="k-filter-label">Risk</span>
      {#each RISK_OPTIONS as opt (opt.value)}
        {@const active = data.appliedFilters.riskTag === opt.value}
        <button
          type="button"
          class="k-filter-pill"
          class:is-active={active}
          onclick={() => setParam('risk', active ? undefined : opt.value)}
        >
          {opt.label}
        </button>
      {/each}
    </div>
  </div>

  {#if data.leaders.length === 0}
    <div class="stripe-empty">
      <div class="stripe-empty-title">no leaders match those filters</div>
      <p class="stripe-empty-text">Try clearing some filters or broadening the score range.</p>
    </div>
  {:else}
    <LeaderTable
      rows={data.leaders}
      serverSorted
      sort={data.sort as SortKey}
      onSortChange={setSort}
      {rankOffset}
    />

    <footer class="k-footer">
      <button
        type="button"
        class="btn-poly"
        onclick={() => setParam('page', String(Math.max(1, data.page - 1)))}
        disabled={data.page === 1}
      >
        ← Prev
      </button>
      <span>page {data.page} of {totalPages}</span>
      <button
        type="button"
        class="btn-poly"
        onclick={() => setParam('page', String(Math.min(totalPages, data.page + 1)))}
        disabled={data.page === totalPages}
      >
        Next →
      </button>
    </footer>
  {/if}
</main>
