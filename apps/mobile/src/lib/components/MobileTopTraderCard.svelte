<script lang="ts">
  import type { TopTrader } from '$lib/api/leaders-top';
  import { effigyUrl, traderName, formatPnl, pnlSignClass } from '$lib/utils/format';
  import { coinIconUrl, coinIconBg } from '$lib/utils/coin';

  interface Props {
    trader: TopTrader;
  }
  let { trader }: Props = $props();

  const pnlClass = $derived(pnlSignClass(trader.pnl_usd));
  const winrateText = $derived(`${Math.round(trader.winrate_pct)}%`);
</script>

<a class="m-tcard tappable" href={`/trader/${trader.address}`} aria-label={`Trader ${traderName(trader.display_name, trader.address)}`}>
  <div class="m-tcard-top">
    <img class="m-tcard-avatar" src={effigyUrl(trader.address)} alt="" loading="lazy" />
    {#if trader.alfa_coin}
      <span class="m-tcard-alfa" aria-label={`Best coin ${trader.alfa_coin}`}>
        <img
          class="m-tcard-alfa-icon"
          src={coinIconUrl(trader.alfa_coin)}
          style:background-color={coinIconBg(trader.alfa_coin)}
          style:padding={coinIconBg(trader.alfa_coin) ? '2px' : null}
          alt=""
          loading="lazy"
        />
        {trader.alfa_coin}
      </span>
    {/if}
  </div>

  <div class="m-tcard-figs">
    <div class="m-tcard-fig">
      <span class="m-tcard-fig-label">Profit</span>
      <span class="m-tcard-pnl {pnlClass}">{formatPnl(trader.pnl_usd)}</span>
    </div>
    <div class="m-tcard-fig">
      <span class="m-tcard-fig-label">Win</span>
      <span class="m-tcard-winrate">{winrateText}</span>
    </div>
  </div>
</a>

<style>
  .m-tcard {
    flex: 0 0 auto;
    width: 152px;
    scroll-snap-align: start;
    display: flex;
    flex-direction: column;
    /* Override .tappable's align/justify center so rows fill the full width
       (otherwise the filled top row is inset and shows side "padding"). */
    align-items: stretch;
    justify-content: flex-start;
    text-decoration: none;
    color: inherit;
    background: var(--glass-bg);
    border-radius: var(--radius-lg);
    overflow: hidden;
  }

  /* Header row — no separate material (would nest glass on glass). Sits on
     the card's own surface; padding alone separates it from the figs below. */
  .m-tcard-top {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
    min-width: 0;
    padding: 7px 10px;
  }

  .m-tcard-avatar {
    width: 22px;
    height: 22px;
    flex: 0 0 22px;
    border-radius: var(--radius-full);
    background: var(--stripe-bg-secondary);
  }

  .m-tcard-alfa {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    min-width: 0;
    font-family: var(--font-mono);
    font-size: 10px;
    color: var(--stripe-text-tertiary);
    white-space: nowrap;
  }
  .m-tcard-alfa-icon {
    width: 16px;
    height: 16px;
    flex: 0 0 16px;
    border-radius: var(--radius-full);
    object-fit: cover;
    background: var(--stripe-bg-secondary);
  }

  .m-tcard-figs {
    display: flex;
    gap: var(--space-4);
    padding: 8px 10px;
    font-family: var(--font-mono);
    font-variant-numeric: tabular-nums;
  }

  .m-tcard-fig {
    display: flex;
    flex-direction: column;
    gap: 1px;
    min-width: 0;
  }

  /* Small stat label — same compact scale as the timeframe filter buttons. */
  .m-tcard-fig-label {
    font-family: var(--font-mono);
    font-size: 9px;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--stripe-text-muted);
  }

  .m-tcard-pnl {
    font-family: var(--font-mono);
    font-variant-numeric: tabular-nums;
    font-size: var(--type-callout);
    font-weight: 600;
    color: var(--stripe-text-primary);
    line-height: 1.1;
  }

  .m-tcard-winrate {
    font-size: var(--type-footnote);
    color: var(--stripe-text-secondary);
  }

  .m-tcard-pnl:global(.k-pnl-positive) {
    color: var(--stripe-success);
  }
  .m-tcard-pnl:global(.k-pnl-negative) {
    color: var(--stripe-danger);
  }
</style>
