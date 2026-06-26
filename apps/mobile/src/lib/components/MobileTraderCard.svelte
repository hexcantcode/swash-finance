<script lang="ts">
  import type { LeaderRow } from '$lib/api/leaders';
  import { effigyUrl, traderName, formatPnl, formatNumber, pnlSignClass } from '$lib/utils/format';
  import { coinIconUrl, coinIconBg } from '$lib/utils/coin';

  interface Props {
    row: LeaderRow;
  }
  let { row }: Props = $props();

  const pnlClass = $derived(pnlSignClass(row.pnl_usd));
  // `winrate_pct` is already 0–100, so format it directly (formatPct would ×100).
  const winrateText = $derived(`${Math.round(row.winrate_pct)}%`);
</script>

<article class="m-trader-card">
  <a
    class="m-trader-card-link"
    href={`/trader/${row.address}`}
    aria-label={`Trader ${traderName(row.display_name, row.address)}`}
  ></a>

  <div class="m-trader-head">
    <img
      class="m-trader-avatar"
      src={effigyUrl(row.address)}
      alt=""
      loading="lazy"
    />
    <div class="m-trader-id">
      <span class="m-trader-addr">
        {traderName(row.display_name, row.address, 6, 4)}
      </span>
    </div>
    {#if row.alfa_coin}
      <span class="m-trader-alfa" aria-label={`Best coin ${row.alfa_coin}`}>
        <img
          class="m-trader-alfa-icon"
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

  <div class="m-trader-body">
    <div class="m-trader-fig">
      <span class="m-trader-fig-val {pnlClass}">{formatPnl(row.pnl_usd)}</span>
      <span class="m-trader-fig-label">All-time profit</span>
    </div>
    <div class="m-trader-fig">
      <span class="m-trader-fig-val">{winrateText}</span>
      <span class="m-trader-fig-label">Win rate</span>
    </div>
    <div class="m-trader-fig">
      <span class="m-trader-fig-val">{formatNumber(row.total_trades, 0)}</span>
      <span class="m-trader-fig-label">Trades</span>
    </div>
  </div>
</article>

<style>
  .m-trader-card {
    position: relative;
    display: flex;
    flex-direction: column;
    color: inherit;
    background: var(--glass-bg);
    -webkit-backdrop-filter: var(--glass-blur);
    backdrop-filter: var(--glass-blur);
    border-radius: var(--radius-lg);
    box-shadow: var(--glass-highlight), var(--glass-shadow);
    overflow: hidden;
  }

  .m-trader-card-link {
    position: absolute;
    inset: 0;
    z-index: 1;
    border-radius: inherit;
  }

  /* ── Header row ───────────────────────────────────────── */
  .m-trader-head {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-4);
  }

  .m-trader-avatar {
    width: 32px;
    height: 32px;
    flex: 0 0 32px;
    border-radius: var(--radius-full);
    background: var(--stripe-bg-secondary);
    object-fit: cover;
  }

  .m-trader-id {
    display: flex;
    flex-direction: column;
    gap: 4px;
    min-width: 0;
    flex: 1;
  }

  .m-trader-addr {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-family: var(--font-sans);
    font-size: var(--type-subhead);
    font-weight: 600;
    color: var(--stripe-text-primary);
    line-height: 1.1;
    letter-spacing: -0.01em;
  }

  /* "Alfa" coin chip — the trader's best coin by PnL. */
  .m-trader-alfa {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    flex: 0 0 auto;
    padding: 4px 8px;
    border-radius: var(--radius-md);
    background: var(--stripe-accent-muted);
    font-family: var(--font-mono);
    font-size: var(--type-footnote);
    color: var(--stripe-text-secondary);
  }
  .m-trader-alfa-icon {
    width: 16px;
    height: 16px;
    flex: 0 0 16px;
    border-radius: var(--radius-full);
    object-fit: cover;
    background: var(--stripe-bg-secondary);
  }

  /* ── Body row — figures ───────────────────────────────── */
  .m-trader-body {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-4);
    padding: var(--space-3) var(--space-4);
    border-top: 1px solid var(--stripe-border);
  }

  .m-trader-fig {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }
  .m-trader-fig-val {
    font-family: var(--font-mono);
    font-variant-numeric: tabular-nums;
    font-size: 20px;
    font-weight: 600;
    color: var(--stripe-text-primary);
    line-height: 1.15;
  }
  .m-trader-fig-val:global(.k-pnl-positive) {
    color: var(--stripe-success);
  }
  .m-trader-fig-val:global(.k-pnl-negative) {
    color: var(--stripe-danger);
  }
  .m-trader-fig-label {
    font-family: var(--font-mono);
    font-size: var(--type-footnote);
    color: var(--stripe-text-tertiary);
    letter-spacing: 0.02em;
  }
</style>
