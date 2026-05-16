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

  // ── Live prices via HL WS `allMids` ─────────────────────────────────
  // Browser subscribes to HL's `allMids` channel — pushes a fresh mark
  // price for every coin on every tick (~hundreds of ms). On each tick we
  // mutate `assets[].price` in place for the matching coin and add a
  // brief green/red flash to the row whose price moved.
  let livePrices = $state<Record<string, number>>({});
  /** Row-flash signals keyed by coin — `n` ticks up on each price change
   *  so the CSS animation restarts even when consecutive ticks share
   *  direction. */
  let rowFlashes = $state<Record<string, { dir: 'up' | 'down'; n: number }>>({});

  // 12s REST fallback — refreshes the slow-moving fields (24h volume, open
  // interest, funding rate) that `allMids` doesn't carry. Stays as-is.
  onMount(() => {
    const pollId = setInterval(async () => {
      try {
        const r = await fetch('/api/assets');
        if (!r.ok) return;
        const j = await r.json();
        if (j?.ok && Array.isArray(j.assets)) assets = j.assets as AssetRow[];
      } catch {
        /* ignore transient poll failures */
      }
    }, 12_000);

    let ws: WebSocket | null = null;
    const lastTick = new Map<string, number>();
    const flashTimers = new Map<string, ReturnType<typeof setTimeout>>();

    function connect() {
      ws = new WebSocket('wss://api.hyperliquid.xyz/ws');
      ws.onopen = () => {
        ws?.send(JSON.stringify({ method: 'subscribe', subscription: { type: 'allMids' } }));
      };
      ws.onmessage = (ev) => {
        let msg: unknown;
        try {
          msg = JSON.parse(typeof ev.data === 'string' ? ev.data : '');
        } catch {
          return;
        }
        if (
          typeof msg !== 'object' ||
          msg === null ||
          (msg as { channel?: unknown }).channel !== 'allMids'
        ) {
          return;
        }
        const data = (msg as { data?: { mids?: Record<string, string> } }).data;
        const mids = data?.mids;
        if (!mids) return;

        // Pick up only the coins we actually display. Skip the rest of
        // the ~180-coin mids dict.
        const nextLive: Record<string, number> = { ...livePrices };
        const flashUpdates: Record<string, { dir: 'up' | 'down'; n: number }> = {};
        for (const a of assets) {
          const raw = mids[a.coin];
          if (typeof raw !== 'string') continue;
          const px = Number.parseFloat(raw);
          if (!Number.isFinite(px)) continue;
          const prev = lastTick.get(a.coin);
          if (prev !== undefined && px !== prev) {
            const dir: 'up' | 'down' = px > prev ? 'up' : 'down';
            const cur = rowFlashes[a.coin];
            flashUpdates[a.coin] = { dir, n: (cur?.n ?? 0) + 1 };
            const t = flashTimers.get(a.coin);
            if (t) clearTimeout(t);
            const coin = a.coin;
            flashTimers.set(
              coin,
              setTimeout(() => {
                const { [coin]: _drop, ...rest } = rowFlashes;
                rowFlashes = rest;
              }, 700),
            );
          }
          lastTick.set(a.coin, px);
          nextLive[a.coin] = px;
        }
        livePrices = nextLive;
        if (Object.keys(flashUpdates).length > 0) {
          rowFlashes = { ...rowFlashes, ...flashUpdates };
        }
      };
      ws.onclose = () => {
        setTimeout(() => {
          if (ws && ws.readyState === WebSocket.CLOSED) connect();
        }, 2_000);
      };
      ws.onerror = () => {
        try { ws?.close(); } catch { /* ignore */ }
      };
    }
    connect();

    return () => {
      clearInterval(pollId);
      for (const t of flashTimers.values()) clearTimeout(t);
      try {
        if (ws) {
          ws.onclose = null;
          ws.close();
        }
      } catch {
        /* ignore */
      }
    };
  });

  /** Live mark price for a coin, falling back to the polled `AssetRow.price`. */
  function priceOf(a: AssetRow): number | null {
    return livePrices[a.coin] ?? a.price;
  }
  /** Live 24h change recomputed from the live price + prev-day reference. */
  function change24hOf(a: AssetRow): number | null {
    const live = livePrices[a.coin];
    if (live === undefined || a.price === null || a.change24h === null) return a.change24h;
    // prevDayPx = price / (1 + change24h)
    const prevDayPx = a.price / (1 + a.change24h);
    if (!Number.isFinite(prevDayPx) || prevDayPx === 0) return a.change24h;
    return (live - prevDayPx) / prevDayPx;
  }

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
  <h1 class="sr-only">Assets</h1>
  <section class="k-trader-section" style="margin-top: 0; margin-bottom: var(--space-6);">
    <TradeTicker trades={data.recentTrades} />
  </section>

  <section class="k-trader-section">
    <div class="k-winners-losers">
      <div class="k-mini-table">
        <div class="k-mini-table-head k-mini-table-head-row">
          <span class="k-mini-table-head-title">Top gainers · 24h</span>
          <span class="k-mini-table-head-label k-mini-table-price">Price</span>
          <span class="k-mini-table-head-label k-mini-table-chg">24h</span>
        </div>
        {#each winners as a (a.coin)}
          {@const f = rowFlashes[a.coin]}
          <a
            class="k-mini-table-row"
            class:k-row-flash-up={f?.dir === 'up'}
            class:k-row-flash-down={f?.dir === 'down'}
            data-flash-tick={f?.n ?? 0}
            href="/assets/{a.coin}"
          >
            <img
              src={coinIconUrl(a.coin)}
              alt=""
              loading="lazy"
              onerror={hideBrokenAvatar}
              class="k-coin-icon"
              class:is-white-bg={coinNeedsWhiteBg(a.coin)}
            />
            <span class="k-coin-sym">{a.symbol}</span>
            <span class="k-mini-table-price">{fmtPrice(priceOf(a))}</span>
            <span class="k-mini-table-chg {pnlSignClass(change24hOf(a))}">{fmtPct(change24hOf(a))}</span>
          </a>
        {/each}
      </div>
      <div class="k-mini-table">
        <div class="k-mini-table-head k-mini-table-head-row">
          <span class="k-mini-table-head-title">Top losers · 24h</span>
          <span class="k-mini-table-head-label k-mini-table-price">Price</span>
          <span class="k-mini-table-head-label k-mini-table-chg">24h</span>
        </div>
        {#each losers as a (a.coin)}
          {@const f = rowFlashes[a.coin]}
          <a
            class="k-mini-table-row"
            class:k-row-flash-up={f?.dir === 'up'}
            class:k-row-flash-down={f?.dir === 'down'}
            data-flash-tick={f?.n ?? 0}
            href="/assets/{a.coin}"
          >
            <img
              src={coinIconUrl(a.coin)}
              alt=""
              loading="lazy"
              onerror={hideBrokenAvatar}
              class="k-coin-icon"
              class:is-white-bg={coinNeedsWhiteBg(a.coin)}
            />
            <span class="k-coin-sym">{a.symbol}</span>
            <span class="k-mini-table-price">{fmtPrice(priceOf(a))}</span>
            <span class="k-mini-table-chg {pnlSignClass(change24hOf(a))}">{fmtPct(change24hOf(a))}</span>
          </a>
        {/each}
      </div>
    </div>
  </section>

  <section class="k-trader-section">
    <div class="k-section-head">
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
            <th scope="col" class="stripe-table-trader">Asset</th>
            <th scope="col" class="stripe-table-numeric">Price</th>
            <th scope="col" class="stripe-table-numeric">24h</th>
            <th scope="col" class="stripe-table-numeric">24h volume</th>
            <th scope="col" class="stripe-table-numeric">Open interest</th>
            <th scope="col" class="stripe-table-numeric">Funding · 1h</th>
          </tr>
        </thead>
        <tbody>
          {#each visibleByVolume as a (a.coin)}
            {@const f = rowFlashes[a.coin]}
            <tr
              class:k-row-flash-up={f?.dir === 'up'}
              class:k-row-flash-down={f?.dir === 'down'}
              data-flash-tick={f?.n ?? 0}
            >
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
              <td class="stripe-table-numeric">{fmtPrice(priceOf(a))}</td>
              <td class="stripe-table-numeric {pnlSignClass(change24hOf(a))}">{fmtPct(change24hOf(a))}</td>
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
