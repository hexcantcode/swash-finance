<script lang="ts">
  import { onMount } from 'svelte';
  import { coinCategory, coinIconUrl, coinNeedsWhiteBg, type CoinCategory } from '$lib/utils/coin';
  import { pnlSignClass } from '$lib/utils/format';
  import TradeTicker from '$lib/components/TradeTicker.svelte';
  import type { AssetRow } from '$lib/server/queries/assets';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();

  let assets = $state<AssetRow[]>(data.assets);
  // null = no filter (show all). Toggle on/off by clicking the active chip.
  let filter = $state<CoinCategory | null>(null);

  const byVolume = $derived(
    [...assets].sort((a, b) => (b.volume24h ?? 0) - (a.volume24h ?? 0)),
  );
  const visibleByVolume = $derived(
    filter === null
      ? byVolume
      : byVolume.filter((a) => coinCategory(a.coin, a.dex) === filter),
  );
  const cryptoCount = $derived(
    assets.filter((a) => coinCategory(a.coin, a.dex) === 'crypto').length,
  );
  const stocksCount = $derived(
    assets.filter((a) => coinCategory(a.coin, a.dex) === 'stocks').length,
  );
  const indexCount = $derived(
    assets.filter((a) => coinCategory(a.coin, a.dex) === 'index').length,
  );
  const withChange = $derived(assets.filter((a) => a.change24h !== null));
  const winners = $derived(
    [...withChange].sort((a, b) => (b.change24h ?? 0) - (a.change24h ?? 0)).slice(0, 5),
  );
  const losers = $derived(
    [...withChange].sort((a, b) => (a.change24h ?? 0) - (b.change24h ?? 0)).slice(0, 5),
  );

  // Near-real-time: re-pull asset contexts every 12s and swap them in.
  onMount(() => {
    const id = setInterval(async () => {
      try {
        const r = await fetch('/api/assets');
        if (!r.ok) return;
        const j = await r.json();
        if (j?.ok && Array.isArray(j.assets)) assets = j.assets as AssetRow[];
      } catch {
        /* ignore transient poll failures */
      }
    }, 12_000);
    return () => clearInterval(id);
  });

  function hideBrokenAvatar(e: Event) {
    const img = e.currentTarget as HTMLImageElement;
    img.style.visibility = 'hidden';
  }
  function fmtPrice(v: number | null): string {
    if (v === null || !Number.isFinite(v)) return '—';
    if (v === 0) return '$0';
    const abs = Math.abs(v);
    if (abs >= 1000) return '$' + v.toLocaleString('en-US', { maximumFractionDigits: 0 });
    if (abs >= 1) return '$' + v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    if (abs >= 0.01) return '$' + v.toFixed(4);
    return '$' + v.toFixed(8).replace(/0+$/, '');
  }
  function fmtBigUsd(v: number | null): string {
    if (v === null || !Number.isFinite(v)) return '—';
    const abs = Math.abs(v);
    if (abs >= 1e9) return '$' + (v / 1e9).toFixed(2) + 'B';
    if (abs >= 1e6) return '$' + (v / 1e6).toFixed(2) + 'M';
    if (abs >= 1e3) return '$' + (v / 1e3).toFixed(1) + 'K';
    return '$' + v.toFixed(0);
  }
  function fmtPct(v: number | null, frac = 2): string {
    if (v === null || !Number.isFinite(v)) return '—';
    const p = v * 100;
    const sign = p > 0 ? '+' : '';
    return `${sign}${p.toFixed(frac)}%`;
  }
</script>

<svelte:head>
  <title>Assets — Swash</title>
</svelte:head>

<main id="main-content" class="stripe-content">
  <section class="k-trader-section" style="margin-top: 0; margin-bottom: var(--space-6);">
    <TradeTicker trades={data.recentTrades} />
  </section>

  <section class="k-trader-section" style="margin-top: var(--space-4);">
    <div class="k-winners-losers">
      <div class="k-mini-table">
        <div class="k-mini-table-head">Top gainers · 24h</div>
        {#each winners as a (a.coin)}
          <a class="k-mini-table-row" href="/assets/{a.coin}">
            <img
              src={coinIconUrl(a.coin)}
              alt=""
              loading="lazy"
              onerror={hideBrokenAvatar}
              class="k-coin-icon"
              class:is-white-bg={coinNeedsWhiteBg(a.coin)}
            />
            <span class="k-coin-sym">{a.symbol}</span>
            <span class="k-mini-table-price">{fmtPrice(a.price)}</span>
            <span class="k-mini-table-chg {pnlSignClass(a.change24h)}">{fmtPct(a.change24h)}</span>
          </a>
        {/each}
      </div>
      <div class="k-mini-table">
        <div class="k-mini-table-head">Top losers · 24h</div>
        {#each losers as a (a.coin)}
          <a class="k-mini-table-row" href="/assets/{a.coin}">
            <img
              src={coinIconUrl(a.coin)}
              alt=""
              loading="lazy"
              onerror={hideBrokenAvatar}
              class="k-coin-icon"
              class:is-white-bg={coinNeedsWhiteBg(a.coin)}
            />
            <span class="k-coin-sym">{a.symbol}</span>
            <span class="k-mini-table-price">{fmtPrice(a.price)}</span>
            <span class="k-mini-table-chg {pnlSignClass(a.change24h)}">{fmtPct(a.change24h)}</span>
          </a>
        {/each}
      </div>
    </div>
  </section>

  <section class="k-trader-section">
    <div class="k-section-head">
      <h2 class="k-section-title">All assets</h2>
      <div class="k-asset-filters" role="group" aria-label="Filter assets by category">
        <button
          type="button"
          class="k-filter-chip"
          class:is-active={filter === 'stocks'}
          aria-pressed={filter === 'stocks'}
          onclick={() => (filter = filter === 'stocks' ? null : 'stocks')}
        >
          Stock &amp; Commodity <span class="k-filter-chip-count">{stocksCount}</span>
        </button>
        <button
          type="button"
          class="k-filter-chip"
          class:is-active={filter === 'index'}
          aria-pressed={filter === 'index'}
          onclick={() => (filter = filter === 'index' ? null : 'index')}
        >
          Index <span class="k-filter-chip-count">{indexCount}</span>
        </button>
        <button
          type="button"
          class="k-filter-chip"
          class:is-active={filter === 'crypto'}
          aria-pressed={filter === 'crypto'}
          onclick={() => (filter = filter === 'crypto' ? null : 'crypto')}
        >
          Crypto <span class="k-filter-chip-count">{cryptoCount}</span>
        </button>
      </div>
    </div>
    <div class="k-table-wrap">
      <table class="stripe-table" aria-label="Hyperliquid perp assets by 24h volume">
        <thead>
          <tr>
            <th class="stripe-table-trader">Asset</th>
            <th class="stripe-table-numeric">Price</th>
            <th class="stripe-table-numeric">24h</th>
            <th class="stripe-table-numeric">24h volume</th>
            <th class="stripe-table-numeric">Open interest</th>
            <th class="stripe-table-numeric">Funding · 1h</th>
          </tr>
        </thead>
        <tbody>
          {#each visibleByVolume as a (a.coin)}
            <tr>
              <td class="stripe-table-trader">
                <a class="k-trader-link" href="/assets/{a.coin}">
                  <img
                    src={coinIconUrl(a.coin)}
                    alt=""
                    loading="lazy"
                    onerror={hideBrokenAvatar}
                    class="k-coin-icon"
                    class:is-white-bg={coinNeedsWhiteBg(a.coin)}
                  />
                  <span>{a.symbol}</span>
                </a>
              </td>
              <td class="stripe-table-numeric">{fmtPrice(a.price)}</td>
              <td class="stripe-table-numeric {pnlSignClass(a.change24h)}">{fmtPct(a.change24h)}</td>
              <td class="stripe-table-numeric">{fmtBigUsd(a.volume24h)}</td>
              <td class="stripe-table-numeric">{fmtBigUsd(a.openInterestUsd)}</td>
              <td class="stripe-table-numeric">{fmtPct(a.funding, 4)}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  </section>
</main>
