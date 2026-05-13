<script lang="ts">
  import { coinIconUrl, coinNeedsWhiteBg } from '$lib/utils/coin';
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

  function fmtPrice(v: number | null): string {
    if (v === null || !Number.isFinite(v)) return '—';
    if (v === 0) return '$0';
    const abs = Math.abs(v);
    if (abs >= 1000) return '$' + v.toLocaleString('en-US', { maximumFractionDigits: 0 });
    if (abs >= 1) return '$' + v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    if (abs >= 0.01) return '$' + v.toFixed(4);
    return '$' + v.toFixed(8).replace(/0+$/, '');
  }
  function fmtRoe(roe: number): string {
    const pct = roe * 100;
    if (!Number.isFinite(pct)) return '—';
    if (Math.abs(pct) >= 100) return pct.toFixed(0) + '%';
    return pct.toFixed(1) + '%';
  }

  /** Map a cell's pct-of-book (0..∞) to a 0..1 opacity for the matrix tint.
   *  Clamp so a 5%-of-book "tiny" position still shows up at ~0.2 opacity
   *  but the strongest cells (full-book) peg at 1.0. */
  function cellOpacity(pctOfBook: number): number {
    if (!Number.isFinite(pctOfBook) || pctOfBook <= 0) return 0.25;
    return Math.max(0.25, Math.min(1, 0.25 + pctOfBook * 0.75));
  }

  /** "$1.2M short · 18% of book" tooltip line for matrix cells. */
  function cellTitle(coin: string, c: { side: string; notionalUsd: number; pctOfBook: number; unrealizedPnlUsd: number }): string {
    const pct = (c.pctOfBook * 100).toFixed(0);
    return `${coin} · ${c.side} · ${formatPnl(c.notionalUsd)} · ${pct}% of book · uPnL ${formatPnl(c.unrealizedPnlUsd)}`;
  }
</script>

<svelte:head>
  <title>Analytics — Swash</title>
</svelte:head>

<main id="main-content" class="stripe-content">
  <!-- 1. Latest trades ─────────────────────────────────────────── -->
  <section class="k-trader-section" style="margin-top: var(--space-4);">
    <div class="k-section-head">
      <h2 class="k-section-title">Latest trades</h2>
    </div>
    {#if data.latestFills.length === 0}
      <p class="k-empty">No recent trades from tracked wallets.</p>
    {:else}
      <div class="k-table-wrap">
        <table class="stripe-table" aria-label="Most recent 10 fills from tracked traders">
          <thead>
            <tr>
              <th class="stripe-table-trader">Trader</th>
              <th class="stripe-table-numeric">Side</th>
              <th class="stripe-table-numeric">Coin</th>
              <th class="stripe-table-numeric">Price</th>
              <th class="stripe-table-numeric">Size</th>
              <th class="stripe-table-numeric">Closed PnL</th>
              <th class="stripe-table-numeric">When</th>
            </tr>
          </thead>
          <tbody>
            {#each data.latestFills as f (f.address + ':' + f.blockTimeMs)}
              <tr>
                <td class="stripe-table-trader">
                  <a class="k-trader-link" href="/trader/{f.address}">
                    <img
                      src={effigyUrl(f.address)}
                      alt=""
                      loading="lazy"
                      onerror={hideBrokenAvatar}
                      class="stripe-avatar stripe-avatar-ring"
                    />
                    <span>{truncateAddress(f.address)}</span>
                  </a>
                </td>
                <td class="stripe-table-numeric">
                  <span class="k-side-arrow k-side-{f.side === 'B' ? 'long' : 'short'}">
                    {f.side === 'B' ? '↑' : '↓'}
                  </span>
                </td>
                <td class="stripe-table-numeric">
                  <a class="k-trader-link" href="/assets/{f.coin}" style="gap: 6px">
                    <img
                      src={coinIconUrl(f.coin)}
                      alt=""
                      loading="lazy"
                      onerror={hideBrokenAvatar}
                      class="k-coin-icon"
                      class:is-white-bg={coinNeedsWhiteBg(f.coin)}
                    />
                    <span>{f.coin}</span>
                  </a>
                </td>
                <td class="stripe-table-numeric">{fmtPrice(f.pxUsd)}</td>
                <td class="stripe-table-numeric">{formatPnl(f.szBase * f.pxUsd)}</td>
                <td class="stripe-table-numeric {f.closedPnlUsd === 0 ? '' : pnlSignClass(f.closedPnlUsd)}">
                  {f.closedPnlUsd === 0 ? '—' : formatPnl(f.closedPnlUsd)}
                </td>
                <td class="stripe-table-numeric k-open-positions-refreshed">
                  {formatRelativeTime(new Date(f.blockTimeMs))}
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {/if}
  </section>

  <!-- 2. Position matrix ───────────────────────────────────────── -->
  <section class="k-trader-section">
    <div class="k-section-head">
      <h2 class="k-section-title">
        Position matrix
        <span class="k-section-sub">top {data.matrix.traders.length} by score · {data.matrix.coins.length} coins</span>
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
                <th class="k-matrix-colhead" title="{c.coin} · {c.holders} holders · net {formatPnl(c.netNotionalUsd)}">
                  <img
                    src={coinIconUrl(c.coin)}
                    alt={c.coin}
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
                    title={cell ? cellTitle(c.coin, cell) : `${c.coin}: no position`}
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
      <div class="k-table-wrap">
        <table class="stripe-table" aria-label="Top 25 currently-open positions across tracked traders, sorted by unrealized PnL">
          <thead>
            <tr>
              <th class="stripe-table-trader">Trader</th>
              <th class="stripe-table-numeric">Coin</th>
              <th class="stripe-table-numeric">Side</th>
              <th class="stripe-table-numeric">Notional</th>
              <th class="stripe-table-numeric">Entry</th>
              <th class="stripe-table-numeric">Unrealized</th>
              <th class="stripe-table-numeric">ROE</th>
              <th class="stripe-table-numeric">Refreshed</th>
            </tr>
          </thead>
          <tbody>
            {#each data.topOpenPositions as p (p.address + ':' + p.coin + ':' + p.entryPxUsd)}
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
                  <a class="k-trader-link" href="/assets/{p.coin}" style="gap: 6px">
                    <img
                      src={coinIconUrl(p.coin)}
                      alt=""
                      loading="lazy"
                      onerror={hideBrokenAvatar}
                      class="k-coin-icon"
                      class:is-white-bg={coinNeedsWhiteBg(p.coin)}
                    />
                    <span>{p.coin}</span>
                  </a>
                </td>
                <td class="stripe-table-numeric">
                  <span class="k-side-arrow k-side-{p.side}">{p.side === 'long' ? '↑' : '↓'}</span>
                </td>
                <td class="stripe-table-numeric">{formatPnl(p.notionalUsd)}</td>
                <td class="stripe-table-numeric">{fmtPrice(p.entryPxUsd)}</td>
                <td class="stripe-table-numeric {pnlSignClass(p.unrealizedPnlUsd)}">
                  {formatPnl(p.unrealizedPnlUsd)}
                </td>
                <td class="stripe-table-numeric {pnlSignClass(p.returnOnEquity)}">
                  {fmtRoe(p.returnOnEquity)}
                </td>
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
