<script lang="ts">
  import type { LeaderRow } from '$lib/api/leaders';
  import { effigyUrl, shortAddress, formatPnl, formatPct, pnlSignClass } from '$lib/utils/format';
  import { coinIconUrl, coinIconBg } from '$lib/utils/coin';

  interface Props {
    row: LeaderRow;
    rank: number;
  }

  let { row, rank }: Props = $props();

  const scoreText = $derived(row.score === null ? '—' : Math.round(row.score).toString());
  const pnlClass = $derived(pnlSignClass(row.pnl_30d_usd));
  const roiClass = $derived(pnlSignClass(row.roi));
  const shownHoldings = $derived(row.holdings.top.slice(0, 3));
  const extraHoldings = $derived(Math.max(0, row.holdings.total - shownHoldings.length));
</script>

<a
  class="m-leader-row tappable-row"
  href={`/trader/${row.address}`}
  aria-label={`Trader ${row.address}, score ${scoreText}`}
>
  <div
    class="m-leader-rank"
    class:is-medal={rank <= 3}
    class:is-gold={rank === 1}
    class:is-silver={rank === 2}
    class:is-bronze={rank === 3}
    aria-label={`Rank ${rank}`}
  >
    {#if rank <= 3}
      <span class="m-leader-medal" aria-hidden="true"></span>
    {:else}
      <span class="m-leader-rank-num">{rank}</span>
    {/if}
  </div>

  <div class="m-leader-main">
    <img class="m-leader-avatar" src={effigyUrl(row.address)} alt="" loading="lazy" />

    <div class="m-leader-copy">
      <div class="m-leader-line-1">
        <span class="m-leader-address">{shortAddress(row.address, 6, 4)}</span>
        {#if row.heat === 'hot'}<span class="m-hot-chip">Hot</span>{/if}
        {#if row.winner && row.winner_rank}
          <span class="m-leader-badge" aria-label="Top earner this week">★ {row.winner_rank}</span>
        {/if}
      </div>

      <div class="m-leader-line-2">
        {#if shownHoldings.length > 0}
          <span
            class="m-leader-holdings"
            aria-label={`${row.holdings.total} open positions: ${shownHoldings
              .map((h) => `${h.coin}${h.side ? ` ${h.side}` : ''}`)
              .join(', ')}`}
          >
            {#each shownHoldings as h (h.coin)}
              <img
                class="m-leader-hold-icon"
                class:is-long={h.side === 'long'}
                class:is-short={h.side === 'short'}
                src={coinIconUrl(h.coin)}
                style:background-color={coinIconBg(h.coin)}
                style:padding={coinIconBg(h.coin) ? '2px' : null}
                alt=""
                loading="lazy"
              />
            {/each}
            {#if extraHoldings > 0}
              <span class="m-leader-hold-more">+{extraHoldings}</span>
            {/if}
          </span>
        {:else}
          <span class="m-leader-holdings-empty">No holdings</span>
        {/if}
      </div>
    </div>
  </div>

  <div class="m-leader-stats">
    <div class="m-leader-score" aria-label={`Score ${scoreText}`}>
      {scoreText}
    </div>
    <div class="m-leader-pnl {pnlClass}">
      {formatPnl(row.pnl_30d_usd)}
    </div>
    <div class="m-leader-roi {roiClass}">
      {formatPct(row.roi)}
    </div>
  </div>
</a>

<style>
  .m-leader-row {
    color: inherit;
    text-decoration: none;
    background-color: transparent;
    min-height: var(--touch-comfortable);
    padding: var(--space-3) var(--space-4);
    gap: var(--space-3);
  }

  .m-leader-rank {
    flex: 0 0 28px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-family: var(--font-mono);
    color: var(--stripe-text-tertiary);
    font-size: var(--type-footnote);
  }

  .m-leader-rank-num {
    font-variant-numeric: tabular-nums;
  }

  .m-leader-rank.is-medal {
    flex: 0 0 28px;
  }

  .m-leader-medal {
    width: 24px;
    height: 24px;
    border-radius: var(--radius-full);
    border: 1px solid rgba(255, 255, 255, 0.18);
    box-shadow:
      inset 0 1px 0 rgba(255, 255, 255, 0.34),
      0 4px 12px rgba(0, 0, 0, 0.22);
  }

  .m-leader-rank.is-gold .m-leader-medal {
    background: linear-gradient(135deg, #f8d35c, #b97912);
  }

  .m-leader-rank.is-silver .m-leader-medal {
    background: linear-gradient(135deg, #edf1f6, #8d98a7);
  }

  .m-leader-rank.is-bronze .m-leader-medal {
    background: linear-gradient(135deg, #d99555, #8f5429);
  }

  .m-leader-main {
    flex: 1 1 auto;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }

  .m-leader-avatar {
    width: 30px;
    height: 30px;
    flex: 0 0 30px;
    border-radius: var(--radius-full);
    background: var(--stripe-bg-secondary);
  }

  .m-leader-copy {
    min-width: 0;
    display: flex;
    flex: 1 1 auto;
    flex-direction: column;
    gap: 3px;
  }

  .m-leader-line-1 {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    font-family: var(--font-mono);
    font-size: var(--type-body);
    color: var(--stripe-text-primary);
    font-weight: 500;
    line-height: var(--line-body);
    min-width: 0;
  }

  .m-leader-address {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .m-leader-badge {
    display: inline-flex;
    align-items: center;
    gap: 2px;
    background: var(--stripe-accent-subtle);
    color: var(--stripe-accent);
    padding: 1px 6px;
    border-radius: var(--radius-md);
    font-size: var(--type-caption);
    font-family: var(--font-mono);
    font-variant-numeric: tabular-nums;
  }

  .m-leader-line-2 {
    display: flex;
    align-items: center;
    min-height: 18px;
    line-height: 1;
  }

  .m-leader-holdings {
    display: flex;
    align-items: center;
    min-width: 0;
  }

  .m-leader-hold-icon {
    width: 18px;
    height: 18px;
    flex: 0 0 18px;
    border-radius: var(--radius-full);
    object-fit: cover;
    background: var(--stripe-bg-secondary);
    border: 2px solid var(--stripe-bg-secondary);
  }
  .m-leader-hold-icon.is-long {
    border-color: var(--stripe-success);
  }
  .m-leader-hold-icon.is-short {
    border-color: var(--stripe-danger);
  }
  .m-leader-hold-icon:not(:first-child) {
    margin-left: -7px;
  }

  .m-leader-hold-more {
    margin-left: 5px;
  }

  .m-leader-hold-more,
  .m-leader-holdings-empty {
    font-family: var(--font-mono);
    font-variant-numeric: tabular-nums;
    font-size: 10px;
    color: var(--stripe-text-tertiary);
    white-space: nowrap;
  }

  .m-leader-stats {
    flex: 0 0 auto;
    display: grid;
    grid-template-columns: auto;
    grid-template-rows: auto auto;
    grid-template-areas:
      'score pnl'
      'score roi';
    column-gap: var(--space-3);
    row-gap: 0;
    align-items: center;
    font-family: var(--font-mono);
    font-variant-numeric: tabular-nums;
    text-align: right;
  }

  .m-leader-score {
    grid-area: score;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 36px;
    height: 28px;
    padding: 0 8px;
    border-radius: var(--radius-md);
    background: rgba(255, 255, 255, 0.05);
    color: var(--stripe-text-primary);
    font-size: var(--type-subhead);
    font-weight: 600;
    line-height: 1;
  }

  .m-leader-pnl {
    grid-area: pnl;
    font-size: var(--type-subhead);
    font-weight: 500;
    color: var(--stripe-text-primary);
    min-width: 60px;
  }

  .m-leader-roi {
    grid-area: roi;
    font-size: var(--type-caption);
    color: var(--stripe-text-tertiary);
    min-width: 60px;
  }

  /* Mirrors the global PnL color rules from the shared design system. */
  .m-leader-pnl:global(.k-pnl-positive),
  .m-leader-roi:global(.k-pnl-positive) {
    color: var(--stripe-success);
  }

  .m-leader-pnl:global(.k-pnl-negative),
  .m-leader-roi:global(.k-pnl-negative) {
    color: var(--stripe-danger);
  }
</style>
