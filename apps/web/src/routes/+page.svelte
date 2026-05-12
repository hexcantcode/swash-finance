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

  // Profile archetype filter options (the "Profile" column dropdown).
  const PROFILE_OPTIONS: Array<{ value: string; label: string }> = [
    { value: 'alpha', label: 'Alpha' },
    { value: 'veteran', label: 'Veteran' },
    { value: 'rising_star', label: 'Rising Star' },
    { value: 'specialist', label: 'Specialist' },
    { value: 'allrounder', label: 'All-Rounder' },
  ];

  function setParam(key: string, value: string | undefined): void {
    const params = new URLSearchParams($page.url.searchParams);
    if (value === undefined || value === '') params.delete(key);
    else params.set(key, value);
    if (key !== 'page') params.delete('page');
    const qs = params.toString();
    goto(qs ? `?${qs}` : '/', { keepFocus: true, noScroll: true });
  }

  function setSort(key: SortKey) {
    setParam('sort', key);
  }

  const totalPages = $derived(Math.max(1, Math.ceil(data.total / data.limit)));
</script>

<svelte:head>
  <title>Swash — The right traders. Mirrored to your wallet.</title>
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
      <span class="stripe-text-tertiary stripe-body-sm">ranked by composite score</span>
    </div>

    <LeaderTable
      rows={data.topLeaders}
      serverSorted
      sort={data.sort as SortKey}
      onSortChange={setSort}
      tagOptions={PROFILE_OPTIONS}
      activeTag={data.appliedFilters.profileTag}
      onTagChange={(v) => setParam('tag', v)}
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
