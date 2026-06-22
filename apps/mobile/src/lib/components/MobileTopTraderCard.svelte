<script lang="ts">
  import type { TopTrader } from '$lib/api/leaders-top';
  import { effigyUrl, traderName, formatPnl, formatPct, pnlSignClass } from '$lib/utils/format';
  import { coinIconUrl, coinIconBg } from '$lib/utils/coin';

  interface Props {
    trader: TopTrader;
  }
  let { trader }: Props = $props();

  const pnlClass = $derived(pnlSignClass(trader.pnl_usd));
  const roiClass = $derived(pnlSignClass(trader.roi));
  // Holdings shown as a stack of coin avatars: first 3, then a +N overflow.
  const shownHoldings = $derived(trader.holdings.top.slice(0, 3));
  const extraHoldings = $derived(Math.max(0, trader.holdings.total - shownHoldings.length));
</script>

<a class="m-tcard tappable" href={`/trader/${trader.address}`} aria-label={`Trader ${traderName(trader.display_name, trader.address)}`}>
  <div class="m-tcard-top">
    <img class="m-tcard-avatar" src={effigyUrl(trader.address)} alt="" loading="lazy" />
    {#if shownHoldings.length > 0}
      <div
        class="m-tcard-holdings"
        aria-label={`${trader.holdings.total} open positions: ${shownHoldings
          .map((h) => `${h.coin}${h.side ? ` ${h.side}` : ''}`)
          .join(', ')}`}
      >
        {#each shownHoldings as h (h.coin)}
          <img
            class="m-tcard-hold-icon"
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
          <span class="m-tcard-hold-more">+{extraHoldings}</span>
        {/if}
      </div>
    {/if}
  </div>

  <div class="m-tcard-figs">
    <div class="m-tcard-fig">
      <span class="m-tcard-fig-label">Profit</span>
      <span class="m-tcard-pnl {pnlClass}">{formatPnl(trader.pnl_usd)}</span>
    </div>
    <div class="m-tcard-fig">
      <span class="m-tcard-fig-label">ROI</span>
      <span class="m-tcard-roi {roiClass}">{formatPct(trader.roi)}</span>
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

  .m-tcard-holdings {
    display: flex;
    align-items: center;
    min-width: 0;
  }

  .m-tcard-hold-icon {
    width: 18px;
    height: 18px;
    flex: 0 0 18px;
    border-radius: var(--radius-full);
    object-fit: cover;
    background: var(--stripe-bg-secondary);
    /* Ring colored by position side (long=green, short=red); the fallback
       in the row's tone keeps unknown-side icons reading as a clean stack. */
    border: 2px solid var(--stripe-bg-secondary);
  }
  .m-tcard-hold-icon.is-long {
    border-color: var(--stripe-success);
  }
  .m-tcard-hold-icon.is-short {
    border-color: var(--stripe-danger);
  }
  .m-tcard-hold-icon:not(:first-child) {
    margin-left: -7px;
  }

  .m-tcard-hold-more {
    margin-left: 5px;
    font-family: var(--font-mono);
    font-variant-numeric: tabular-nums;
    font-size: 10px;
    color: var(--stripe-text-tertiary);
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

  .m-tcard-roi {
    font-size: var(--type-footnote);
    color: var(--stripe-text-secondary);
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
