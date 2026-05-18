<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import LeaderTable, { type SortKey } from '$lib/components/LeaderTable.svelte';
  import TradeTicker from '$lib/components/TradeTicker.svelte';
  import { goto } from '$app/navigation';
  import { page } from '$app/stores';
  import { coinDisplayName, coinIconUrl, coinNeedsWhiteBg } from '$lib/utils/coin';
  import {
    effigyUrl,
    formatPnl,
    pnlSignClass,
  } from '$lib/utils/format';
  import type { HoldingsByAddress } from '$lib/server/queries/holdings';
  import type { PageData } from './$types';

  interface Props {
    data: PageData;
  }
  let { data }: Props = $props();

  // Live-refreshed holdings keyed by address. Seeded from the loader, then
  // refreshed every POLL_MS via /api/holdings so the column reads the same
  // leader_cache snapshot the trader page polls. Each rendered row reads
  // `liveHoldings.get(addr) ?? row.holdings` so a missing entry safely
  // falls back to the load-time value.
  function seedHoldings(d: PageData): Map<string, HoldingsByAddress> {
    const m = new Map<string, HoldingsByAddress>();
    for (const r of d.winners) m.set(r.address, r.holdings);
    for (const r of d.topMonthly) m.set(r.address, r.holdings);
    for (const r of d.topLeaders) m.set(r.address, r.holdings);
    return m;
  }
  let liveHoldings = $state<Map<string, HoldingsByAddress>>(seedHoldings(data));

  // Re-seed when the loader returns a new data set (navigation, sort change,
  // pagination). $effect runs on data changes; reassign the map so $derived
  // rows recompute.
  $effect(() => {
    liveHoldings = seedHoldings(data);
  });

  const POLL_MS = 8_000;
  let pollTimer: ReturnType<typeof setTimeout> | null = null;
  let pollStopped = false;

  function allDisplayedAddresses(): string[] {
    const set = new Set<string>();
    for (const r of data.winners) set.add(r.address);
    for (const r of data.topMonthly) set.add(r.address);
    for (const r of data.topLeaders) set.add(r.address);
    return [...set];
  }

  async function pollHoldings() {
    if (pollStopped) return;
    if (document.visibilityState !== 'visible') {
      pollTimer = setTimeout(pollHoldings, POLL_MS);
      return;
    }
    try {
      const addrs = allDisplayedAddresses();
      if (addrs.length > 0) {
        const qs = new URLSearchParams();
        for (const a of addrs) qs.append('address', a);
        const res = await fetch(`/api/holdings?${qs.toString()}`);
        if (res.ok) {
          const next = (await res.json()) as Record<string, HoldingsByAddress>;
          const m = new Map<string, HoldingsByAddress>();
          for (const [addr, h] of Object.entries(next)) m.set(addr, h);
          liveHoldings = m;
        }
      }
    } catch {
      // Network blip — keep last good map.
    }
    if (!pollStopped) pollTimer = setTimeout(pollHoldings, POLL_MS);
  }

  function onVisibilityChange() {
    if (document.visibilityState === 'visible') {
      if (pollTimer) clearTimeout(pollTimer);
      pollHoldings();
    }
  }

  onMount(() => {
    pollTimer = setTimeout(pollHoldings, POLL_MS);
    document.addEventListener('visibilitychange', onVisibilityChange);
  });
  onDestroy(() => {
    pollStopped = true;
    if (pollTimer) clearTimeout(pollTimer);
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', onVisibilityChange);
    }
  });

  function withLiveHoldings<T extends { address: string; holdings: HoldingsByAddress }>(rows: T[]): T[] {
    return rows.map((r) => ({ ...r, holdings: liveHoldings.get(r.address) ?? r.holdings }));
  }

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
  const winnerRows = $derived(withLiveHoldings(data.winners.slice(0, 5)));

  // Top 5 by HL 30d realized PnL → "1mo PnL". Already ranked by
  // `listTopMonthlyPnl` (tracked wallets only, ordered by hl_pnl_30d_usd desc).
  const monthlyRows = $derived(withLiveHoldings(data.topMonthly));

  // Main leaderboard rows with patched holdings.
  const topLeadersLive = $derived(withLiveHoldings(data.topLeaders));

  const totalPages = $derived(Math.max(1, Math.ceil(data.total / data.limit)));
</script>

<svelte:head>
  <title>Swash — The right traders. Mirrored to your wallet.</title>
</svelte:head>

<main id="main-content" class="stripe-content">
  <h1 class="sr-only">Traders</h1>
  <section class="k-trader-section" style="margin-top: 0; margin-bottom: var(--space-6);">
    <TradeTicker trades={data.recentTrades} />
  </section>

  <section class="k-trader-section">
    <div class="k-winners-losers">
      <div class="k-mini-table">
        <div class="k-mini-table-head k-mini-table-head--stacked">
          <h3 class="k-mini-table-head-title-line">Winners · 7d</h3>
          <div class="k-mini-table-head-colheads">
            <span class="k-mini-table-head-avatar-spacer" aria-hidden="true"></span>
            <span class="k-mini-table-head-label k-mini-table-holdings">Holdings</span>
            <span class="k-mini-table-head-label k-mini-table-alfa">Alfa</span>
            <span class="k-mini-table-head-label k-mini-table-price">7d PnL</span>
            <span class="k-mini-table-head-label k-mini-table-chg">ROI</span>
          </div>
        </div>
        {#if winnerRows.length === 0}
          <div class="k-empty">
            no top earners yet — run <code>pnpm leaderboard-poll</code>
          </div>
        {:else}
          {#each winnerRows as t (t.address)}
            <a class="k-mini-table-row" href="/trader/{t.address}" aria-label="View trader profile">
              <img
                src={effigyUrl(t.address)}
                alt=""
                loading="lazy"
                onerror={hideBrokenAvatar}
                class="stripe-avatar stripe-avatar-sm stripe-avatar-ring"
              />
              <span class="k-mini-table-holdings">
                {#if t.holdings.top.length === 0}
                  <span class="k-mini-table-holdings-empty">—</span>
                {:else}
                  {#each t.holdings.top as h (h.coin)}
                    <img
                      src={coinIconUrl(h.coin)}
                      alt=""
                      loading="lazy"
                      onerror={hideBrokenAvatar}
                      class="k-coin-icon k-mini-table-holdings-icon"
                      class:is-white-bg={coinNeedsWhiteBg(h.coin)}
                      class:is-long={h.side === 'long'}
                      class:is-short={h.side === 'short'}
                    />
                  {/each}
                  {#if t.holdings.total > t.holdings.top.length}
                    <span class="k-mini-table-holdings-more"
                      >+{t.holdings.total - t.holdings.top.length}</span>
                  {/if}
                {/if}
              </span>
              <span class="k-mini-table-alfa">
                {#if t.alfa_coin}
                  <img
                    src={coinIconUrl(t.alfa_coin)}
                    alt=""
                    loading="lazy"
                    onerror={hideBrokenAvatar}
                    class="k-coin-icon"
                    class:is-white-bg={coinNeedsWhiteBg(t.alfa_coin)}
                  />
                  {coinDisplayName(t.alfa_coin)}
                {:else}
                  —
                {/if}
              </span>
              <span class="k-mini-table-price {pnlSignClass(t.pnl_7d_usd)}">
                {formatPnl(t.pnl_7d_usd)}
              </span>
              <span class="k-mini-table-chg {pnlSignClass(t.roi_7d)}">{formatRoi(t.roi_7d)}</span>
            </a>
          {/each}
        {/if}
      </div>
      <div class="k-mini-table">
        <div class="k-mini-table-head k-mini-table-head--stacked">
          <h3 class="k-mini-table-head-title-line">1mo PnL</h3>
          <div class="k-mini-table-head-colheads">
            <span class="k-mini-table-head-avatar-spacer" aria-hidden="true"></span>
            <span class="k-mini-table-head-label k-mini-table-holdings">Holdings</span>
            <span class="k-mini-table-head-label k-mini-table-alfa">Alfa</span>
            <span class="k-mini-table-head-label k-mini-table-price">30d PnL</span>
            <span class="k-mini-table-head-label k-mini-table-chg">ROI</span>
          </div>
        </div>
        {#if monthlyRows.length === 0}
          <div class="k-empty">no scored traders yet</div>
        {:else}
          {#each monthlyRows as t (t.address)}
            <a class="k-mini-table-row" href="/trader/{t.address}" aria-label="View trader profile">
              <img
                src={effigyUrl(t.address)}
                alt=""
                loading="lazy"
                onerror={hideBrokenAvatar}
                class="stripe-avatar stripe-avatar-sm stripe-avatar-ring"
              />
              <span class="k-mini-table-holdings">
                {#if t.holdings.top.length === 0}
                  <span class="k-mini-table-holdings-empty">—</span>
                {:else}
                  {#each t.holdings.top as h (h.coin)}
                    <img
                      src={coinIconUrl(h.coin)}
                      alt=""
                      loading="lazy"
                      onerror={hideBrokenAvatar}
                      class="k-coin-icon k-mini-table-holdings-icon"
                      class:is-white-bg={coinNeedsWhiteBg(h.coin)}
                      class:is-long={h.side === 'long'}
                      class:is-short={h.side === 'short'}
                    />
                  {/each}
                  {#if t.holdings.total > t.holdings.top.length}
                    <span class="k-mini-table-holdings-more"
                      >+{t.holdings.total - t.holdings.top.length}</span>
                  {/if}
                {/if}
              </span>
              <span class="k-mini-table-alfa">
                {#if t.alfa_coin}
                  <img
                    src={coinIconUrl(t.alfa_coin)}
                    alt=""
                    loading="lazy"
                    onerror={hideBrokenAvatar}
                    class="k-coin-icon"
                    class:is-white-bg={coinNeedsWhiteBg(t.alfa_coin)}
                  />
                  {coinDisplayName(t.alfa_coin)}
                {:else}
                  —
                {/if}
              </span>
              <span class="k-mini-table-price {pnlSignClass(t.pnl_30d_usd)}">
                {formatPnl(t.pnl_30d_usd)}
              </span>
              <span class="k-mini-table-chg {pnlSignClass(t.roi_30d)}">{formatRoi(t.roi_30d)}</span>
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
      rows={topLeadersLive}
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
