<script lang="ts">
  import { coinDisplayName, coinIconUrl, coinNeedsWhiteBg } from '$lib/utils/coin';
  import {
    effigyUrl,
    formatPnl,
    formatRelativeTime,
    pnlSignClass,
    truncateAddress,
  } from '$lib/utils/format';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();

  function hideBrokenAvatar(e: Event) {
    const img = e.currentTarget as HTMLImageElement;
    img.style.visibility = 'hidden';
  }

  function fmtRoe(roe: number): string {
    const pct = roe * 100;
    if (!Number.isFinite(pct)) return '—';
    if (Math.abs(pct) >= 100) return pct.toFixed(0) + '%';
    return pct.toFixed(1) + '%';
  }

  /** Map cell's pct-of-book → matrix tint opacity. Clamp so a tiny position
   *  still shows up but the strongest cells peg at 1.0. */
  function cellOpacity(pctOfBook: number): number {
    if (!Number.isFinite(pctOfBook) || pctOfBook <= 0) return 0.25;
    return Math.max(0.25, Math.min(1, 0.25 + pctOfBook * 0.75));
  }

  function cellTitle(
    coin: string,
    c: { side: string; notionalUsd: number; pctOfBook: number; unrealizedPnlUsd: number },
  ): string {
    const pct = (c.pctOfBook * 100).toFixed(0);
    return `${coinDisplayName(coin)} · ${c.side} · ${formatPnl(c.notionalUsd)} · ${pct}% of book · uPnL ${formatPnl(c.unrealizedPnlUsd)}`;
  }

  function fmtPctInt(n: number): string {
    if (!Number.isFinite(n)) return '—';
    return Math.round(n) + '%';
  }

  // ── Top-of-page sentiment: server returns one CategoryPositionBreakdown
  // per category (`stocks` = Stock & Commodity + folded Index; `crypto`).
  // Translate notional + trader counts into long/short percentages for the
  // two stacked bars (Size + Traders). 50/50 fallback when nothing's open
  // so the empty track still reads as balanced rather than collapsed.
  const sentimentCards = $derived(
    data.categoryBreakdown.map((cb) => {
      const totalNot = cb.long.notionalUsd + cb.short.notionalUsd;
      const totalTr = cb.long.traders + cb.short.traders;
      const longNotPct = totalNot > 0 ? (cb.long.notionalUsd / totalNot) * 100 : 50;
      const shortNotPct = 100 - longNotPct;
      const longTrPct = totalTr > 0 ? (cb.long.traders / totalTr) * 100 : 50;
      const shortTrPct = 100 - longTrPct;
      return {
        category: cb.category,
        label: cb.category === 'stocks' ? 'Stock & Commodity' : 'Crypto',
        long: cb.long,
        short: cb.short,
        longNotPct,
        shortNotPct,
        longTrPct,
        shortTrPct,
        hasData: totalNot > 0 || totalTr > 0,
      };
    }),
  );
</script>

<svelte:head><title>Analytics — Swash</title></svelte:head>

<main id="main-content" class="stripe-content">
  <!-- 1. Tracked-trader sentiment ──────────────────────────────── -->
  <section class="k-trader-section" style="margin-top: var(--space-4);">
    <div class="k-section-head">
      <h2 class="k-section-title">
        Tracked sentiment
        <span class="k-section-sub">long vs short across every open position</span>
      </h2>
    </div>
    <div class="k-winners-losers">
      {#each sentimentCards as s (s.category)}
        <div class="k-mini-table k-sentiment-card">
          <div class="k-mini-table-head">{s.label}</div>
          {#if !s.hasData}
            <div class="k-empty">no open positions in this bucket yet</div>
          {:else}
            <div class="k-sentiment-stack">
              <div class="k-sentiment-bar">
                <div class="k-sentiment-label">Size</div>
                <div
                  class="k-sentiment-track"
                  role="img"
                  aria-label="{fmtPctInt(s.longNotPct)} long, {fmtPctInt(s.shortNotPct)} short by notional"
                >
                  <span class="k-sentiment-fill k-sentiment-long" style:width="{s.longNotPct}%"></span>
                  <span class="k-sentiment-fill k-sentiment-short" style:width="{s.shortNotPct}%"></span>
                </div>
                <div class="k-sentiment-foot">
                  <span class="k-sentiment-foot-left">
                    <span class="k-pnl-positive">{formatPnl(s.long.notionalUsd)}</span>
                    <span class="k-sentiment-foot-sub">{fmtPctInt(s.longNotPct)} LONG</span>
                  </span>
                  <span class="k-sentiment-foot-right">
                    <span class="k-sentiment-foot-sub">{fmtPctInt(s.shortNotPct)} SHORT</span>
                    <span class="k-pnl-negative">{formatPnl(s.short.notionalUsd)}</span>
                  </span>
                </div>
              </div>
              <div class="k-sentiment-bar">
                <div class="k-sentiment-label">Traders</div>
                <div
                  class="k-sentiment-track"
                  role="img"
                  aria-label="{s.long.traders} long, {s.short.traders} short"
                >
                  <span class="k-sentiment-fill k-sentiment-long" style:width="{s.longTrPct}%"></span>
                  <span class="k-sentiment-fill k-sentiment-short" style:width="{s.shortTrPct}%"></span>
                </div>
                <div class="k-sentiment-foot">
                  <span class="k-sentiment-foot-left">
                    <span class="k-pnl-positive">{s.long.traders}</span>
                    <span class="k-sentiment-foot-sub">{fmtPctInt(s.longTrPct)} LONG</span>
                  </span>
                  <span class="k-sentiment-foot-right">
                    <span class="k-sentiment-foot-sub">{fmtPctInt(s.shortTrPct)} SHORT</span>
                    <span class="k-pnl-negative">{s.short.traders}</span>
                  </span>
                </div>
              </div>
            </div>
          {/if}
        </div>
      {/each}
    </div>
  </section>

  <!-- 2. Latest trades + Top open positions (side-by-side) ─────── -->
  <section class="k-trader-section">
    <div class="k-winners-losers">
      <div class="k-mini-table">
        <div class="k-mini-table-head">Latest trades · {data.latestFills.length}</div>
        {#if data.latestFills.length === 0}
          <div class="k-empty">no recent trades from tracked wallets</div>
        {:else}
          {#each data.latestFills as f (f.key)}
            <a
              class="k-mini-table-row"
              href="/trader/{f.address}"
              title="{truncateAddress(f.address)} {f.side === 'B' ? 'bought' : 'sold'} {coinDisplayName(f.coin)} · {f.fillCount} fill{f.fillCount === 1 ? '' : 's'} · VWAP ${f.vwapUsd.toLocaleString('en-US', {maximumFractionDigits: f.vwapUsd >= 1 ? 2 : 6})} · total {formatPnl(f.notionalUsd)}"
            >
              <img
                src={effigyUrl(f.address)}
                alt=""
                loading="lazy"
                onerror={hideBrokenAvatar}
                class="k-coin-icon"
              />
              <span class="k-coin-sym k-mini-table-addr">{truncateAddress(f.address)}</span>
              <span class="k-mini-table-price">
                <span
                  class="k-side-arrow k-side-{f.side === 'B' ? 'long' : 'short'}"
                  aria-label={f.side === 'B' ? 'buy' : 'sell'}
                >{f.side === 'B' ? '↑' : '↓'}</span>
                <img
                  src={coinIconUrl(f.coin)}
                  alt=""
                  loading="lazy"
                  onerror={hideBrokenAvatar}
                  class="k-coin-icon"
                  class:is-white-bg={coinNeedsWhiteBg(f.coin)}
                />
                {coinDisplayName(f.coin)}  {formatPnl(f.notionalUsd)}
                {#if f.fillCount > 1}
                  <span class="k-mini-table-fillcount" aria-label="{f.fillCount} fills">{f.fillCount}×</span>
                {/if}
              </span>
              <span class="k-mini-table-chg k-mini-table-time">
                {formatRelativeTime(new Date(f.blockTimeMs))}
              </span>
            </a>
          {/each}
        {/if}
      </div>

      <div class="k-mini-table">
        <div class="k-mini-table-head">Top open positions · by uPnL</div>
        {#if data.topOpenPositions.length === 0}
          <div class="k-empty">no open positions across tracked traders right now</div>
        {:else}
          {#each data.topOpenPositions as p (`${p.address}|${p.coin}`)}
            <a class="k-mini-table-row" href="/trader/{p.address}">
              <img
                src={effigyUrl(p.address)}
                alt=""
                loading="lazy"
                onerror={hideBrokenAvatar}
                class="k-coin-icon"
              />
              <span class="k-coin-sym k-mini-table-addr">{truncateAddress(p.address)}</span>
              <span class="k-mini-table-price">
                <span class="k-side-arrow k-side-{p.side}" aria-label={p.side}
                  >{p.side === 'long' ? '↑' : '↓'}</span>
                <img
                  src={coinIconUrl(p.coin)}
                  alt=""
                  loading="lazy"
                  onerror={hideBrokenAvatar}
                  class="k-coin-icon"
                  class:is-white-bg={coinNeedsWhiteBg(p.coin)}
                />
                {coinDisplayName(p.coin)}  {formatPnl(p.notionalUsd)}
              </span>
              <span class="k-mini-table-chg {pnlSignClass(p.unrealizedPnlUsd)}">
                {formatPnl(p.unrealizedPnlUsd)}
                <span class="k-mini-table-sub {pnlSignClass(p.returnOnEquity)}">
                  {fmtRoe(p.returnOnEquity)}
                </span>
              </span>
            </a>
          {/each}
        {/if}
      </div>
    </div>
  </section>

  <!-- 2. Position matrix ───────────────────────────────────────── -->
  <section class="k-trader-section">
    <div class="k-section-head">
      <h2 class="k-section-title">
        Position matrix
        <span class="k-section-sub">
          {data.matrix.coins.length} coins (by 24h volume) × {data.matrix.traders.length} tracked traders
        </span>
      </h2>
    </div>
    {#if data.matrix.traders.length === 0 || data.matrix.coins.length === 0}
      <p class="k-empty">No tracked traders are currently holding overlapping positions.</p>
    {:else}
      <!-- Trader rows down the left (small avatar + truncated address + score
           badge), coin columns across the top (icon only, volume-ranked).
           Cell key: `${address}|${coin}`. -->
      <div class="k-matrix-wrap">
        <table class="k-matrix">
          <thead>
            <tr>
              <th class="k-matrix-rowhead"></th>
              {#each data.matrix.coins as c (c.coin)}
                <th
                  class="k-matrix-colhead"
                  title="{coinDisplayName(c.coin)} · {c.holders} {c.holders === 1 ? 'holder' : 'holders'} · net {formatPnl(c.netNotionalUsd)}"
                >
                  <a class="k-matrix-coinchip" href="/assets/{c.coin}" aria-label={coinDisplayName(c.coin)}>
                    <img
                      src={coinIconUrl(c.coin)}
                      alt=""
                      loading="lazy"
                      onerror={hideBrokenAvatar}
                      class="k-matrix-icon"
                      class:is-white-bg={coinNeedsWhiteBg(c.coin)}
                    />
                  </a>
                </th>
              {/each}
            </tr>
          </thead>
          <tbody>
            {#each data.matrix.traders as t (t.address)}
              <tr>
                <th class="k-matrix-rowhead">
                  <a class="k-matrix-traderrow" href="/trader/{t.address}">
                    <img
                      src={effigyUrl(t.address)}
                      alt=""
                      loading="lazy"
                      onerror={hideBrokenAvatar}
                      class="k-matrix-traderavatar"
                    />
                    <span class="k-matrix-traderaddr">{truncateAddress(t.address)}</span>
                    {#if t.score !== null}
                      <span class="k-matrix-traderscore">{t.score}</span>
                    {/if}
                  </a>
                </th>
                {#each data.matrix.coins as c (c.coin)}
                  {@const cell = data.matrix.cells[`${t.address}|${c.coin}`]}
                  <td
                    class="k-matrix-cell"
                    class:k-cell-long={cell?.side === 'long'}
                    class:k-cell-short={cell?.side === 'short'}
                    style={cell ? `--k-cell-opacity:${cellOpacity(cell.pctOfBook)}` : ''}
                    title={cell
                      ? `${truncateAddress(t.address)} · ${cellTitle(c.coin, cell)}`
                      : `${truncateAddress(t.address)} · ${coinDisplayName(c.coin)}: no position`}
                  ></td>
                {/each}
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {/if}
  </section>

</main>
