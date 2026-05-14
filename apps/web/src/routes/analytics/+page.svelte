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
</script>

<svelte:head><title>Analytics — Swash</title></svelte:head>

<main id="main-content" class="stripe-content">
  <!-- 1. Latest trades ─────────────────────────────────────────── -->
  <section class="k-trader-section" style="margin-top: var(--space-4);">
    <div class="k-section-head">
      <h2 class="k-section-title">Latest trades</h2>
    </div>
    {#if data.latestFills.length === 0}
      <p class="k-empty">No recent trades from tracked wallets.</p>
    {:else}
      <div class="k-mini-table">
        <div class="k-mini-table-head">Last {data.latestFills.length} fills · tracked wallets</div>
        {#each data.latestFills as f (f.tid)}
          <a class="k-mini-table-row" href="/trader/{f.address}">
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
              {coinDisplayName(f.coin)}  {formatPnl(f.szBase * f.pxUsd)}
            </span>
            <span class="k-mini-table-chg k-mini-table-time">
              {formatRelativeTime(new Date(f.blockTimeMs))}
            </span>
          </a>
        {/each}
      </div>
    {/if}
  </section>

  <!-- 2. Position matrix ───────────────────────────────────────── -->
  <section class="k-trader-section">
    <div class="k-section-head">
      <h2 class="k-section-title">
        Position matrix
        <span class="k-section-sub">
          top {data.matrix.traders.length} by score · {data.matrix.coins.length} coins
        </span>
      </h2>
    </div>
    {#if data.matrix.traders.length === 0 || data.matrix.coins.length === 0}
      <p class="k-empty">No tracked traders are currently holding overlapping positions.</p>
    {:else}
      <div class="k-matrix-wrap">
        <table class="k-matrix">
          <thead>
            <tr>
              <th class="k-matrix-rowhead"></th>
              {#each data.matrix.coins as c (c.coin)}
                <th
                  class="k-matrix-colhead"
                  title="{coinDisplayName(c.coin)} · {c.holders} holders · net {formatPnl(c.netNotionalUsd)}"
                >
                  <img
                    src={coinIconUrl(c.coin)}
                    alt={coinDisplayName(c.coin)}
                    loading="lazy"
                    onerror={hideBrokenAvatar}
                    class="k-matrix-icon"
                    class:is-white-bg={coinNeedsWhiteBg(c.coin)}
                  />
                </th>
              {/each}
            </tr>
          </thead>
          <tbody>
            {#each data.matrix.traders as t (t.address)}
              <tr>
                <th class="k-matrix-rowhead">
                  <a class="k-matrix-traderlink" href="/trader/{t.address}">
                    <img
                      src={effigyUrl(t.address)}
                      alt=""
                      loading="lazy"
                      onerror={hideBrokenAvatar}
                      class="k-matrix-traderavatar"
                    />
                    <span>{truncateAddress(t.address)}</span>
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
                    title={cell ? cellTitle(c.coin, cell) : `${coinDisplayName(c.coin)}: no position`}
                  ></td>
                {/each}
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {/if}
  </section>

  <!-- 3. Top open positions ────────────────────────────────────── -->
  <section class="k-trader-section">
    <div class="k-section-head">
      <h2 class="k-section-title">
        Top open positions
        <span class="k-section-sub">by unrealized PnL · {data.topOpenPositions.length}</span>
      </h2>
    </div>
    {#if data.topOpenPositions.length === 0}
      <p class="k-empty">No open positions across tracked traders right now.</p>
    {:else}
      <div class="k-mini-table">
        <div class="k-mini-table-head">Top {data.topOpenPositions.length} · sorted by uPnL</div>
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
              {p.coin}  {formatPnl(p.notionalUsd)}
            </span>
            <span class="k-mini-table-chg {pnlSignClass(p.unrealizedPnlUsd)}">
              {formatPnl(p.unrealizedPnlUsd)}
              <span class="k-mini-table-sub {pnlSignClass(p.returnOnEquity)}">
                {fmtRoe(p.returnOnEquity)}
              </span>
            </span>
          </a>
        {/each}
      </div>
    {/if}
  </section>
</main>
