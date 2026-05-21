<script lang="ts">
  import type { LeaderRow } from '$lib/api/leaders';
  import { shortAddress, formatPnl, formatPct, formatUsd, pnlSignClass } from '$lib/utils/format';
  import { coinDisplayName, coinIconUrl } from '$lib/utils/coin';

  interface Props {
    row: LeaderRow;
    rank: number;
  }

  let { row, rank }: Props = $props();

  const scoreText = $derived(row.score === null ? '—' : Math.round(row.score).toString());
  const pnlClass = $derived(pnlSignClass(row.total_pnl_usd));
  const roiClass = $derived(pnlSignClass(row.roi));
  const alfa = $derived(row.alfa_coin ? coinDisplayName(row.alfa_coin) : null);
  const alfaIcon = $derived(row.alfa_coin ? coinIconUrl(row.alfa_coin) : null);
</script>

<a
  class="m-leader-row tappable-row"
  href={`/trader/${row.address}`}
  aria-label={`Trader ${row.address}, score ${scoreText}`}
>
  <div class="m-leader-rank" class:is-top={rank <= 3}>
    <span class="m-leader-rank-num">{rank}</span>
  </div>

  <div class="m-leader-main">
    <div class="m-leader-line-1">
      <span class="m-leader-address">{shortAddress(row.address, 6, 4)}</span>
      {#if row.winner && row.winner_rank}
        <span class="m-leader-badge" aria-label="Top earner this week">★ {row.winner_rank}</span>
      {/if}
    </div>

    <div class="m-leader-line-2">
      {#if row.primary_tag}
        <span class="m-leader-tag">{row.primary_tag}</span>
      {/if}
      {#if alfa}
        <span class="m-leader-alfa">
          {#if alfaIcon}<img src={alfaIcon} alt="" class="m-leader-alfa-icon" />{/if}
          <span>{alfa}</span>
        </span>
      {/if}
    </div>
  </div>

  <div class="m-leader-stats">
    <div class="m-leader-score">
      <span class="m-leader-score-num">{scoreText}</span>
      <span class="m-leader-score-label">score</span>
    </div>
    <div class="m-leader-pnl {pnlClass}">
      {formatPnl(row.total_pnl_usd)}
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

  /* Top-3 ranks get a teal glass medallion. */
  .m-leader-rank.is-top {
    flex: 0 0 28px;
  }
  .m-leader-rank.is-top .m-leader-rank-num {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 24px;
    border-radius: var(--radius-full);
    background: var(--stripe-accent-subtle);
    border: 1px solid var(--stripe-border-focus);
    box-shadow: var(--glass-highlight);
    color: var(--stripe-accent-light);
    font-weight: 700;
  }

  .m-leader-main {
    flex: 1 1 auto;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
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
    gap: var(--space-2);
    font-size: var(--type-caption);
    color: var(--stripe-text-tertiary);
    line-height: var(--line-caption);
  }

  .m-leader-tag {
    text-transform: capitalize;
    color: var(--stripe-text-secondary);
  }

  .m-leader-alfa {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    color: var(--stripe-text-secondary);
  }

  .m-leader-alfa-icon {
    width: 14px;
    height: 14px;
    border-radius: var(--radius-full);
    object-fit: cover;
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
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    min-width: 44px;
    padding: 4px 8px;
    border-radius: var(--radius-md);
    background: var(--stripe-accent-subtle);
    border: 1px solid var(--stripe-border-focus);
    box-shadow: var(--glass-highlight);
  }

  .m-leader-score-num {
    font-size: var(--type-headline);
    color: var(--stripe-accent-light);
    font-weight: 700;
    line-height: 1;
  }

  .m-leader-score-label {
    font-size: 9px;
    color: var(--stripe-accent);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    margin-top: 2px;
    opacity: 0.8;
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
