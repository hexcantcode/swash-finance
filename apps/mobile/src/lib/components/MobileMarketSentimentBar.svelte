<script lang="ts">
  import type { MarketSentiment, CohortBias } from '$lib/api/feed';
  import { formatUsd } from '$lib/utils/format';
  import { coinDisplayName, coinIconUrl, coinIconBg } from '$lib/utils/coin';

  // `coin` heads the bar with that market's icon + name (the feed's per-asset
  // list); otherwise `label` shows a plain text caption (the asset page, where
  // the coin is already in the header).
  let {
    m,
    label = 'Smart money',
    coin = null,
  }: { m: MarketSentiment; label?: string; coin?: string | null } = $props();

  /** Cohort bias → display label, arrow, and tone class. Bullish leans long
   *  (the crowd buying), bearish leans short. Mirrors the feed's Sentiment tab
   *  so the same signal reads identically wherever it appears. */
  function biasDisplay(b: CohortBias): { label: string; arrow: string; tone: 'bull' | 'bear' | 'flat' } {
    switch (b) {
      case 'very_bullish':
        return { label: 'Very Bullish', arrow: '↗', tone: 'bull' };
      case 'bullish':
        return { label: 'Bullish', arrow: '↗', tone: 'bull' };
      case 'slightly_bullish':
        return { label: 'Slightly Bullish', arrow: '↗', tone: 'bull' };
      case 'slightly_bearish':
        return { label: 'Slightly Bearish', arrow: '↘', tone: 'bear' };
      case 'bearish':
        return { label: 'Bearish', arrow: '↘', tone: 'bear' };
      case 'very_bearish':
        return { label: 'Very Bearish', arrow: '↘', tone: 'bear' };
      default:
        return { label: 'Neutral', arrow: '→', tone: 'flat' };
    }
  }

  /** Green-segment width % — long notional as a share of total directional
   *  notional. Falls back to 50/50 when both sides are 0. */
  function longPct(r: { longNotionalUsd: number; shortNotionalUsd: number }): number {
    const total = r.longNotionalUsd + r.shortNotionalUsd;
    return total > 0 ? (r.longNotionalUsd / total) * 100 : 50;
  }

  const b = $derived(biasDisplay(m.bias));
  const lp = $derived(longPct(m));
</script>

<div class="m-asset-sent">
  <div class="m-sent-top">
    {#if coin}
      <span class="m-sent-coin">
        {#if coinIconUrl(coin)}
          <img
            src={coinIconUrl(coin)}
            style:background-color={coinIconBg(coin)}
            style:padding={coinIconBg(coin) ? '2px' : null}
            alt=""
            loading="lazy"
          />
        {/if}
        {coinDisplayName(coin)}
      </span>
    {:else}
      <span class="m-asset-sent-label">{label}</span>
    {/if}
    <span class="m-cohort-bias is-{b.tone}">
      {b.label}
      <span class="m-cohort-arrow" aria-hidden="true">{b.arrow}</span>
    </span>
  </div>
  <div
    class="m-sent-bar"
    role="img"
    aria-label={`${formatUsd(m.longNotionalUsd)} long vs ${formatUsd(m.shortNotionalUsd)} short, by ${m.longTraders} long and ${m.shortTraders} short traders`}
  >
    <span class="m-sent-bar-long" style:width={`${lp}%`}></span>
    <span class="m-sent-bar-short" style:width={`${100 - lp}%`}></span>
  </div>
  <div class="m-sent-notionals">
    <span class="is-long">{formatUsd(m.longNotionalUsd)} long</span>
    <span class="is-short">{formatUsd(m.shortNotionalUsd)} short</span>
  </div>
  <div class="m-sent-foot">
    <span>{m.longTraders} {m.longTraders === 1 ? 'trader' : 'traders'} long</span>
    <span>{m.shortTraders} {m.shortTraders === 1 ? 'trader' : 'traders'} short</span>
  </div>
</div>

<style>
  .m-asset-sent {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .m-sent-top {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
  }
  .m-asset-sent-label {
    font-family: var(--font-mono);
    font-size: var(--type-footnote);
    color: var(--stripe-text-tertiary);
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }
  /* Coin heading for the feed's per-asset list — icon + display name. */
  .m-sent-coin {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    min-width: 0;
    font-family: var(--font-mono);
    font-size: var(--type-callout);
    color: var(--stripe-text-primary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .m-sent-coin img {
    width: 14px;
    height: 14px;
    border-radius: var(--radius-full);
    flex: 0 0 auto;
  }

  /* Bias pill — matches the feed's Sentiment tab. */
  .m-cohort-bias {
    flex: 0 0 auto;
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 4px 10px;
    border-radius: var(--radius-sm);
    font-family: var(--font-sans);
    font-size: var(--type-footnote);
    font-weight: 600;
    white-space: nowrap;
  }
  .m-cohort-bias.is-bull {
    color: var(--stripe-success);
    background: color-mix(in srgb, var(--stripe-success) 15%, transparent);
  }
  .m-cohort-bias.is-bear {
    color: var(--stripe-danger);
    background: color-mix(in srgb, var(--stripe-danger) 15%, transparent);
  }
  .m-cohort-bias.is-flat {
    color: var(--stripe-text-secondary);
    background: var(--stripe-accent-muted);
  }
  .m-cohort-arrow {
    font-size: var(--type-callout);
    line-height: 1;
  }

  /* Dollar-weighted long/short bar — green | red, proportional to notional. */
  .m-sent-bar {
    display: flex;
    height: 8px;
    border-radius: var(--radius-full);
    overflow: hidden;
    background: var(--stripe-bg-secondary);
  }
  .m-sent-bar-long {
    background: var(--stripe-success);
  }
  .m-sent-bar-short {
    background: var(--stripe-danger);
  }

  /* Dollar notional behind each side, tinted to match the bar segments. */
  .m-sent-notionals {
    display: flex;
    align-items: center;
    justify-content: space-between;
    font-family: var(--font-mono);
    font-variant-numeric: tabular-nums;
    font-size: var(--type-footnote);
    font-weight: 600;
  }
  .m-sent-notionals .is-long {
    color: var(--stripe-success);
  }
  .m-sent-notionals .is-short {
    color: var(--stripe-danger);
  }

  .m-sent-foot {
    display: flex;
    align-items: center;
    justify-content: space-between;
    font-family: var(--font-mono);
    font-variant-numeric: tabular-nums;
    font-size: var(--type-caption);
    color: var(--stripe-text-tertiary);
  }
</style>
