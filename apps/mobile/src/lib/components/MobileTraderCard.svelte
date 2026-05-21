<script lang="ts">
  import type { TopTrader } from '$lib/api/leaders-top';
  import { shortAddress, effigyUrl, formatPnl, formatPct, pnlSignClass } from '$lib/utils/format';

  interface Props {
    trader: TopTrader;
    /** Label for the PnL window shown on the card (e.g. "7d"). */
    windowLabel: string;
  }
  let { trader, windowLabel }: Props = $props();

  const pnlClass = $derived(pnlSignClass(trader.pnl_usd));
  const roiClass = $derived(pnlSignClass(trader.roi));
</script>

<a class="m-tcard tappable" href={`/trader/${trader.address}`} aria-label={`Trader ${trader.address}`}>
  <div class="m-tcard-top">
    <img class="m-tcard-avatar" src={effigyUrl(trader.address)} alt="" loading="lazy" />
    <div class="m-tcard-id">
      <span class="m-tcard-address">{shortAddress(trader.address, 4, 4)}</span>
      {#if trader.primary_tag}
        <span class="m-tcard-tag">{trader.primary_tag}</span>
      {/if}
    </div>
  </div>

  <div class="m-tcard-pnl {pnlClass}">{formatPnl(trader.pnl_usd)}</div>
  <div class="m-tcard-sub">
    <span class="m-tcard-roi {roiClass}">{formatPct(trader.roi)}</span>
    <span class="m-tcard-window">{windowLabel}</span>
  </div>
</a>

<style>
  .m-tcard {
    flex: 0 0 auto;
    width: 152px;
    scroll-snap-align: start;
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding: var(--space-3);
    text-decoration: none;
    color: inherit;
    background: var(--glass-bg);
    -webkit-backdrop-filter: var(--glass-blur);
    backdrop-filter: var(--glass-blur);
    border: 1px solid var(--stripe-border);
    border-radius: var(--radius-lg);
    box-shadow: var(--glass-highlight), var(--glass-shadow);
  }

  .m-tcard-top {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    min-width: 0;
  }

  .m-tcard-avatar {
    width: 32px;
    height: 32px;
    flex: 0 0 32px;
    border-radius: var(--radius-full);
    background: var(--stripe-bg-secondary);
    border: 1px solid var(--stripe-border-light);
    box-shadow: var(--glass-shadow);
  }

  .m-tcard-id {
    display: flex;
    flex-direction: column;
    gap: 1px;
    min-width: 0;
  }

  .m-tcard-address {
    font-family: var(--font-mono);
    font-size: var(--type-footnote);
    color: var(--stripe-text-primary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .m-tcard-tag {
    font-family: var(--font-mono);
    font-size: 10px;
    color: var(--stripe-text-tertiary);
    text-transform: capitalize;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .m-tcard-pnl {
    font-family: var(--font-mono);
    font-variant-numeric: tabular-nums;
    font-size: var(--type-headline);
    font-weight: 600;
    color: var(--stripe-text-primary);
    line-height: 1.1;
  }

  .m-tcard-sub {
    display: flex;
    align-items: baseline;
    gap: var(--space-2);
    font-family: var(--font-mono);
    font-variant-numeric: tabular-nums;
  }

  .m-tcard-roi {
    font-size: var(--type-footnote);
    color: var(--stripe-text-secondary);
  }

  .m-tcard-window {
    font-size: 10px;
    color: var(--stripe-text-muted);
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .m-tcard-pnl:global(.k-pnl-positive),
  .m-tcard-roi:global(.k-pnl-positive) {
    color: var(--stripe-success);
  }
  .m-tcard-pnl:global(.k-pnl-negative),
  .m-tcard-roi:global(.k-pnl-negative) {
    color: var(--stripe-danger);
  }
</style>
