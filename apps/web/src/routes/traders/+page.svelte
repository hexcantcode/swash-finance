<script lang="ts">
  import LeaderTable, { type SortKey } from '$lib/components/LeaderTable.svelte';
  import TradeTicker from '$lib/components/TradeTicker.svelte';
  import { goto } from '$app/navigation';
  import { page } from '$app/stores';
  import {
    effigyUrl,
    formatPct,
    formatPnl,
    pnlSignClass,
    truncateAddress,
  } from '$lib/utils/format';
  import type { PageData } from './$types';

  interface Props {
    data: PageData;
  }
  let { data }: Props = $props();

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

  function hideBrokenAvatar(e: Event) {
    const img = e.currentTarget as HTMLImageElement;
    img.style.visibility = 'hidden';
  }

  function formatRoi(value: number | null | undefined): string {
    if (value === null || value === undefined || !Number.isFinite(value)) return '—';
    const pct = value * 100;
    const sign = pct > 0 ? '+' : '';
    if (Math.abs(pct) >= 1000) return `${sign}${(pct / 100).toFixed(1)}x`;
    if (Math.abs(pct) >= 100) return `${sign}${pct.toFixed(0)}%`;
    return `${sign}${pct.toFixed(1)}%`;
  }

  // Top 5 by 7d PnL desc → "Winners". The list comes pre-ranked by
  // `winnerRank` (= 7d PnL desc) from the loader.
  const winnerRows = $derived(data.winners.slice(0, 5));

  // Top 5 by win rate desc → "Win Rate". Already ranked + sample-floored
  // (≥ MIN_ROUND_TRIPS) by `listTopWinRate`.
  const winRateRows = $derived(data.topWinRate);

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
    <div class="k-winners-losers">
      <div class="k-mini-table">
        <div class="k-mini-table-head">Winners · 7d</div>
        {#if winnerRows.length === 0}
          <div class="k-empty">
            no top earners yet — run <code>pnpm leaderboard-poll</code>
          </div>
        {:else}
          {#each winnerRows as t (t.address)}
            <a class="k-mini-table-row" href="/trader/{t.address}">
              <img
                src={effigyUrl(t.address)}
                alt=""
                loading="lazy"
                onerror={hideBrokenAvatar}
                class="stripe-avatar stripe-avatar-sm stripe-avatar-ring"
              />
              <span class="k-coin-sym k-mini-table-addr">{truncateAddress(t.address)}</span>
              <span class="k-mini-table-price {pnlSignClass(t.pnl_7d_usd)}">
                {formatPnl(t.pnl_7d_usd)}
              </span>
              <span class="k-mini-table-chg {pnlSignClass(t.roi_7d)}">{formatRoi(t.roi_7d)}</span>
            </a>
          {/each}
        {/if}
      </div>
      <div class="k-mini-table">
        <div class="k-mini-table-head">Win Rate</div>
        {#if winRateRows.length === 0}
          <div class="k-empty">no scored traders yet</div>
        {:else}
          {#each winRateRows as t (t.address)}
            <a class="k-mini-table-row" href="/trader/{t.address}">
              <img
                src={effigyUrl(t.address)}
                alt=""
                loading="lazy"
                onerror={hideBrokenAvatar}
                class="stripe-avatar stripe-avatar-sm stripe-avatar-ring"
              />
              <span class="k-coin-sym k-mini-table-addr">{truncateAddress(t.address)}</span>
              <span class="k-mini-table-price k-pnl-positive">{formatPct(t.win_rate, 0)}</span>
              <span class="k-mini-table-chg">{t.total_round_trips} rt</span>
            </a>
          {/each}
        {/if}
      </div>
    </div>
  </section>

  <section class="k-trader-section">
    <div class="k-section-head">
      <h2 class="k-section-title">Leaderboard</h2>
    </div>

    <LeaderTable
      rows={data.topLeaders}
      serverSorted
      sort={data.sort as SortKey}
      onSortChange={setSort}
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
