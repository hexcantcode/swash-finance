<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { page } from '$app/stores';
  import TVChart from '$lib/components/TVChart.svelte';
  import { coinIconUrl, coinNeedsWhiteBg } from '$lib/utils/coin';
  import {
    effigyUrl,
    formatPnl,
    formatRelativeTime,
    pnlSignClass,
    truncateAddress,
  } from '$lib/utils/format';
  import {
    RANGE_KEYS,
    type CandlePoint,
    type OpenPosition,
    type RangeKey,
    type TopTrader,
    type TraderOpen,
  } from '$lib/utils/asset-ranges';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();

  let candles = $state<CandlePoint[]>(data.candles);
  let asset = $state(data.asset);
  let topTraders = $state<TopTrader[]>(data.topTraders);
  let traderOpens = $state<TraderOpen[]>(data.traderOpens);
  let openPositions = $state<OpenPosition[]>(data.openPositions);
  // When the URL changes (range tab → goto → loader re-runs), sync the local
  // state from the new server data. The 12s poll mutates `candles` directly
  // between loader runs.
  $effect(() => {
    candles = data.candles;
    asset = data.asset;
    topTraders = data.topTraders;
    traderOpens = data.traderOpens;
    openPositions = data.openPositions;
  });
  // Range is driven by the URL search param so it survives reloads + back/fwd.
  const range = $derived<RangeKey>(data.range);

  // 12s poll for fresh candles within the current range (doesn't re-run the
  // top-traders aggregation — that only updates on a range / page reload).
  async function pullCandles(r: RangeKey) {
    try {
      const u = new URL(`/api/assets/${asset.coin}/candles`, $page.url.origin);
      u.searchParams.set('range', r);
      const res = await fetch(u);
      if (!res.ok) return;
      const j = (await res.json()) as { ok: boolean; candles: CandlePoint[] };
      if (j.ok) candles = j.candles;
    } catch {
      /* ignore transient poll failures */
    }
  }

  function setRange(r: RangeKey) {
    if (r === range) return;
    const u = new URL($page.url);
    u.searchParams.set('range', r);
    // `replaceState` so the back button doesn't accumulate range flips.
    goto(u, { keepFocus: true, replaceState: true, noScroll: true });
  }

  onMount(() => {
    const id = setInterval(() => pullCandles(range), 12_000);
    return () => clearInterval(id);
  });

  // ── Formatting helpers (mirror the assets index page) ────────────────
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
  /** Trader-card ROI: decimal in → "+12.5%" / "−5.2%" / "—". */
  function formatRoi(value: number | null): string {
    if (value === null || value === undefined || !Number.isFinite(value)) return '—';
    const pct = value * 100;
    if (Math.abs(pct) >= 1000) return `${(pct / 100).toFixed(1)}x`;
    if (Math.abs(pct) >= 100) return `${pct.toFixed(0)}%`;
    return `${pct.toFixed(1)}%`;
  }
  function fmtPct(v: number | null, frac = 2): string {
    if (v === null || !Number.isFinite(v)) return '—';
    const p = v * 100;
    const sign = p > 0 ? '+' : '';
    return `${sign}${p.toFixed(frac)}%`;
  }

  function hideBrokenAvatar(e: Event) {
    const img = e.currentTarget as HTMLImageElement;
    img.style.visibility = 'hidden';
  }
</script>

<svelte:head>
  <title>{asset.dex ? `${asset.symbol} · ${asset.dex}` : asset.symbol} — Swash</title>
</svelte:head>

<main id="main-content" class="stripe-content">
  <section class="k-trader-section" style="margin-top: var(--space-4);">
    <header class="k-asset-header">
      <a class="k-asset-back" href="/assets" aria-label="Back to all assets">← Assets</a>
      <div class="k-asset-id">
        <img
          src={coinIconUrl(asset.coin)}
          alt=""
          loading="lazy"
          onerror={hideBrokenAvatar}
          class="k-asset-icon"
          class:is-white-bg={coinNeedsWhiteBg(asset.coin)}
        />
        <h1 class="k-asset-symbol">{asset.symbol}</h1>
        {#if asset.maxLeverage}
          <span class="k-asset-leverage">{asset.maxLeverage}×</span>
        {/if}
      </div>
      <div class="k-asset-quote">
        <span class="k-asset-price">{fmtPrice(asset.price)}</span>
        <span class="k-asset-change {pnlSignClass(asset.change24h)}">
          {fmtPct(asset.change24h)}
          <span class="k-asset-change-label">· 24h</span>
        </span>
      </div>
      <dl class="k-asset-meta">
        <div><dt>24h volume</dt><dd>{fmtBigUsd(asset.volume24h)}</dd></div>
        <div><dt>Open interest</dt><dd>{fmtBigUsd(asset.openInterestUsd)}</dd></div>
        <div><dt>Funding · 1h</dt><dd>{fmtPct(asset.funding, 4)}</dd></div>
      </dl>
    </header>
  </section>

  <section class="k-trader-section">
    <div class="k-section-head k-chart-head">
      <h2 class="k-section-title">Price</h2>
      <div class="k-range-tabs" role="tablist" aria-label="Chart range">
        {#each RANGE_KEYS as r (r)}
          <button
            type="button"
            role="tab"
            aria-selected={range === r}
            class="k-range-tab"
            class:is-active={range === r}
            onclick={() => setRange(r)}
          >
            {r}
          </button>
        {/each}
      </div>
    </div>
    <div class="k-chart">
      {#if candles.length < 2}
        <div class="k-chart-empty">No candle data for this range.</div>
      {:else}
        <TVChart {candles} markers={traderOpens} />
      {/if}
    </div>
  </section>

  <section class="k-trader-section">
    <div class="k-section-head">
      <h2 class="k-section-title">Best traders on {asset.symbol}</h2>
    </div>
    {#if topTraders.length === 0}
      <p class="k-empty">No tracked fills on {asset.symbol} yet.</p>
    {:else}
      <div class="k-card-scroll" aria-label="Top 5 traders by realized PnL on {asset.symbol}">
        {#each topTraders as t (t.address)}
          <a class="k-roi-card k-asset-trader-card" href="/trader/{t.address}">
            <div class="k-asset-trader-card-top">
              <img
                src={effigyUrl(t.address)}
                alt=""
                loading="lazy"
                onerror={hideBrokenAvatar}
                class="stripe-avatar stripe-avatar-ring k-roi-card-avatar"
              />
              <span class="k-roi-card-addr">{truncateAddress(t.address)}</span>
            </div>
            <div class="k-asset-trader-card-stats">
              <span class="k-asset-trader-card-pnl {pnlSignClass(t.totalPnlUsd)}">
                {formatPnl(t.totalPnlUsd)}
              </span>
              <span class="k-asset-trader-card-roi {pnlSignClass(t.roi)}">
                {formatRoi(t.roi)}
              </span>
            </div>
          </a>
        {/each}
      </div>
    {/if}
  </section>

  <section class="k-trader-section">
    <div class="k-section-head">
      <h2 class="k-section-title">Open positions on {asset.symbol}</h2>
    </div>
    {#if openPositions.length === 0}
      <p class="k-empty">No tracked trader is currently holding {asset.symbol}.</p>
    {:else}
      <div class="k-table-wrap">
        <table
          class="stripe-table k-open-positions"
          aria-label="Open {asset.symbol} positions of tracked traders, sorted by unrealized PnL"
        >
          <thead>
            <tr>
              <th class="stripe-table-trader">Trader</th>
              <th class="stripe-table-numeric">Side</th>
              <th class="stripe-table-numeric">Notional</th>
              <th class="stripe-table-numeric">Entry</th>
              <th class="stripe-table-numeric">Unrealized PnL</th>
              <th class="stripe-table-numeric">ROE</th>
              <th class="stripe-table-numeric">Lev</th>
              <th class="stripe-table-numeric">Refreshed</th>
            </tr>
          </thead>
          <tbody>
            {#each openPositions as p (p.address + ':' + p.entryPxUsd)}
              <tr>
                <td class="stripe-table-trader">
                  <a class="k-trader-link" href="/trader/{p.address}">
                    <img
                      src={effigyUrl(p.address)}
                      alt=""
                      loading="lazy"
                      onerror={hideBrokenAvatar}
                      class="stripe-avatar stripe-avatar-ring"
                    />
                    <span>{truncateAddress(p.address)}</span>
                  </a>
                </td>
                <td class="stripe-table-numeric">
                  <span class="k-side-pill k-side-{p.side}">{p.side}</span>
                </td>
                <td class="stripe-table-numeric">{formatPnl(p.notionalUsd)}</td>
                <td class="stripe-table-numeric">${p.entryPxUsd.toLocaleString('en-US', { maximumFractionDigits: p.entryPxUsd >= 1 ? 2 : 6 })}</td>
                <td class="stripe-table-numeric {pnlSignClass(p.unrealizedPnlUsd)}">
                  {formatPnl(p.unrealizedPnlUsd)}
                </td>
                <td class="stripe-table-numeric {pnlSignClass(p.returnOnEquity)}">
                  {(p.returnOnEquity * 100).toFixed(p.returnOnEquity >= 1 ? 0 : 1)}%
                </td>
                <td class="stripe-table-numeric">{p.leverage}×</td>
                <td class="stripe-table-numeric k-open-positions-refreshed">
                  {#if p.lastRefreshedAtMs !== null}
                    <span class:is-stale={Date.now() - p.lastRefreshedAtMs > 30 * 60 * 1000}>
                      {formatRelativeTime(new Date(p.lastRefreshedAtMs))}
                    </span>
                  {:else}
                    —
                  {/if}
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {/if}
  </section>
</main>
