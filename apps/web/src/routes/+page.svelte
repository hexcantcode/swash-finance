<script lang="ts">
  import LeaderTable, { type SortKey } from '$lib/components/LeaderTable.svelte';
  import TradeTicker from '$lib/components/TradeTicker.svelte';
  import WeeklyRoiCards from '$lib/components/WeeklyRoiCards.svelte';
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
  const RISK_VALUES = RISK_OPTIONS.map((o) => o.value);

  let filtersOpen = $state(false);

  function setParam(key: string, value: string | undefined): void {
    const params = new URLSearchParams($page.url.searchParams);
    if (value === undefined || value === '') {
      params.delete(key);
    } else {
      params.set(key, value);
    }
    if (key !== 'page') params.delete('page');
    const qs = params.toString();
    goto(qs ? `?${qs}` : '/', { keepFocus: true, noScroll: true });
  }

  function setSort(key: SortKey) {
    setParam('sort', key);
  }

  function handleRiskInput(e: Event) {
    const idx = (e.currentTarget as HTMLInputElement).valueAsNumber;
    setParam('risk', RISK_VALUES[idx]);
  }

  function resetFilters() {
    filtersOpen = false;
    goto('/');
  }

  // Close the filter popup on outside click / Escape.
  function popover(node: HTMLElement) {
    function onPointerDown(e: Event) {
      if (filtersOpen && !node.contains(e.target as Node)) filtersOpen = false;
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') filtersOpen = false;
    }
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('keydown', onKeyDown);
    return {
      destroy() {
        document.removeEventListener('pointerdown', onPointerDown, true);
        document.removeEventListener('keydown', onKeyDown);
      },
    };
  }

  const totalPages = $derived(Math.max(1, Math.ceil(data.total / data.limit)));
  const activeFilterCount = $derived(
    Object.values(data.appliedFilters).filter((v) => v !== undefined && v !== '').length,
  );
  const rankOffset = $derived((data.page - 1) * data.limit);

  const riskRaw = $derived(RISK_VALUES.indexOf(data.appliedFilters.riskTag ?? ''));
  const riskSet = $derived(riskRaw !== -1);
  const riskIdx = $derived(riskRaw === -1 ? 1 : riskRaw);
</script>

{#snippet filterGroup(
  label: string,
  options: Array<{ value: string; label: string }>,
  paramKey: string,
  activeValue: string | undefined,
)}
  <div class="k-filter-row">
    <span class="k-filter-label">{label}</span>
    <div class="k-filter-row-pills">
      {#each options as opt (opt.value)}
        {@const active = activeValue === opt.value}
        <button
          type="button"
          class="btn-poly"
          class:is-active={active}
          onclick={() => setParam(paramKey, active ? undefined : opt.value)}
        >
          {opt.label}
        </button>
      {/each}
    </div>
  </div>
{/snippet}

<svelte:head>
  <title>Swash — hyperliquid trader leaderboard</title>
</svelte:head>

<main id="main-content" class="stripe-content">
  <section class="k-trader-section" style="margin-top: 0; margin-bottom: var(--space-6);">
    <TradeTicker trades={data.recentTrades} />
  </section>

  <section class="k-trader-section">
    <div class="k-section-head">
      <h2 class="k-section-title">Winners</h2>
      <span class="stripe-text-tertiary stripe-body-sm">per Hyperliquid's official 7d window</span>
    </div>

    {#if data.weeklyRoi.length === 0}
      <div class="stripe-empty">
        <div class="stripe-empty-title">no 7d data yet</div>
        <p class="stripe-empty-text">
          Run <code>pnpm leaderboard</code> to fetch HL leaderboard.
        </p>
      </div>
    {:else}
      <WeeklyRoiCards rows={data.weeklyRoi} />
    {/if}
  </section>

  <section class="k-trader-section">
    <div class="k-section-head">
      <h2 class="k-section-title">Leaderboard</h2>
      <div class="k-filter-control" use:popover>
        <button
          type="button"
          class="btn-poly k-filter-trigger"
          class:is-active={activeFilterCount > 0}
          aria-haspopup="dialog"
          aria-expanded={filtersOpen}
          onclick={() => (filtersOpen = !filtersOpen)}
        >
          + Filter{#if activeFilterCount > 0}&nbsp;· {activeFilterCount}{/if}
        </button>

        {#if filtersOpen}
          <div class="k-filter-pop" role="dialog" aria-label="Filters">
            <div class="k-filter-pop-head">
              <span class="k-filter-pop-title">Filters</span>
              {#if activeFilterCount > 0}
                <button type="button" class="k-filter-pop-clear" onclick={resetFilters}>
                  Clear all
                </button>
              {/if}
            </div>
            {@render filterGroup('Tag', TAG_OPTIONS, 'tag', data.appliedFilters.mainTag)}
            {@render filterGroup('Asset', ASSET_OPTIONS, 'asset', data.appliedFilters.assetTag)}

            <div class="k-filter-row">
              <span class="k-filter-label">Risk profile</span>
              <div class="k-risk" class:is-set={riskSet}>
                <input
                  type="range"
                  min="0"
                  max="2"
                  step="1"
                  value={riskIdx}
                  oninput={handleRiskInput}
                  class="k-risk-range"
                  aria-label="Risk profile"
                  aria-valuetext={RISK_OPTIONS[riskIdx]?.label ?? ''}
                />
                <div class="k-risk-ticks">
                  {#each RISK_OPTIONS as opt, i (opt.value)}
                    <button
                      type="button"
                      class="k-risk-tick"
                      class:is-active={riskSet && riskIdx === i}
                      onclick={() => setParam('risk', riskSet && riskIdx === i ? undefined : opt.value)}
                    >
                      {opt.label}
                    </button>
                  {/each}
                </div>
              </div>
            </div>
          </div>
        {/if}
      </div>
    </div>

    {#if data.topLeaders.length === 0}
      <div class="stripe-empty">
        <div class="stripe-empty-title">no leaders match those filters</div>
        <p class="stripe-empty-text">Try clearing some filters or broadening the score range.</p>
      </div>
    {:else}
      <LeaderTable
        rows={data.topLeaders}
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
  </section>
</main>

<footer class="k-site-footer">
  <div class="k-site-footer-top">
    <div class="k-site-footer-brand">
      <div class="k-site-footer-brand-row">
        <span class="k-site-footer-brand-name">Swash</span>
      </div>
      <p class="k-site-footer-tagline">The right traders. Mirrored to your wallet.</p>
      <span class="k-site-footer-copyright">© 2026 Swash</span>
    </div>

    <div class="k-site-footer-col">
      <h3 class="k-site-footer-col-title">Product</h3>
      <a href="/" class="k-site-footer-link">Leaderboard</a>
    </div>

    <div class="k-site-footer-col">
      <h3 class="k-site-footer-col-title">Resources</h3>
      <a href="/methodology" class="k-site-footer-link">Methodology</a>
      <a href="/about" class="k-site-footer-link">About</a>
    </div>
  </div>

  <div class="k-site-footer-bottom"></div>
</footer>
