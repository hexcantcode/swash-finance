<script lang="ts">
  import type { LeaderRow } from '$lib/api/leaders';
  import { effigyUrl, traderName, formatPnl, pnlSignClass } from '$lib/utils/format';
  import { coinIconUrl, coinIconBg } from '$lib/utils/coin';

  interface Props {
    row: LeaderRow;
    rank: number;
  }

  let { row, rank }: Props = $props();

  const pnlClass = $derived(pnlSignClass(row.pnl_usd));
  // `winrate_pct` is already 0–100, so format it directly.
  const winrateText = $derived(`${Math.round(row.winrate_pct)}%`);
</script>

<a
  class="m-leader-row tappable-row"
  href={`/trader/${row.address}`}
  aria-label={`Trader ${traderName(row.display_name, row.address)}`}
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
        <span class="m-leader-address">{traderName(row.display_name, row.address, 6, 4)}</span>
      </div>

      <div class="m-leader-line-2">
        {#if row.alfa_coin}
          <span class="m-leader-alfa" aria-label={`Best coin ${row.alfa_coin}`}>
            <img
              class="m-leader-alfa-icon"
              src={coinIconUrl(row.alfa_coin)}
              style:background-color={coinIconBg(row.alfa_coin)}
              style:padding={coinIconBg(row.alfa_coin) ? '2px' : null}
              alt=""
              loading="lazy"
            />
            {row.alfa_coin}
          </span>
        {/if}
      </div>
    </div>
  </div>

  <div class="m-leader-stats">
    <div class="m-leader-pnl {pnlClass}">
      {formatPnl(row.pnl_usd)}
    </div>
    <div class="m-leader-winrate">
      {winrateText} win
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

  .m-leader-line-2 {
    display: flex;
    align-items: center;
    min-height: 18px;
    line-height: 1;
  }

  .m-leader-alfa {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    font-family: var(--font-mono);
    font-size: 10px;
    color: var(--stripe-text-tertiary);
    white-space: nowrap;
  }
  .m-leader-alfa-icon {
    width: 14px;
    height: 14px;
    flex: 0 0 14px;
    border-radius: var(--radius-full);
    object-fit: cover;
    background: var(--stripe-bg-secondary);
  }

  .m-leader-stats {
    flex: 0 0 auto;
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    justify-content: center;
    gap: 2px;
    font-family: var(--font-mono);
    font-variant-numeric: tabular-nums;
    text-align: right;
  }

  .m-leader-pnl {
    font-size: var(--type-subhead);
    font-weight: 500;
    color: var(--stripe-text-primary);
    min-width: 60px;
  }

  .m-leader-winrate {
    font-size: var(--type-caption);
    color: var(--stripe-text-tertiary);
    min-width: 60px;
  }

  /* Mirrors the global PnL color rules from the shared design system. */
  .m-leader-pnl:global(.k-pnl-positive) {
    color: var(--stripe-success);
  }

  .m-leader-pnl:global(.k-pnl-negative) {
    color: var(--stripe-danger);
  }
</style>
