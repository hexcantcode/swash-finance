<script lang="ts">
  import type { Asset } from '$lib/api/assets';
  import { coinDisplayName, coinIconUrl, coinNeedsWhiteBg, coinIconBg } from '$lib/utils/coin';
  import { formatUsd, formatPct, pnlSignClass } from '$lib/utils/format';
  import { liveFeed, liveChange24h } from '$lib/live/live-feed.svelte';

  interface Props {
    asset: Asset;
    /** Home-screen table hides volume (just leverage in the meta line). */
    showVolume?: boolean;
  }
  let { asset, showVolume = true }: Props = $props();

  const name = $derived(coinDisplayName(asset.coin));
  const icon = $derived(coinIconUrl(asset.coin));
  const whiteBg = $derived(coinNeedsWhiteBg(asset.coin));
  const iconBg = $derived(coinIconBg(asset.coin));

  // Live mid (from the shared HL `allMids` feed) overlays the loaded price;
  // 24h change is recomputed off it. The `flash` signal tints the row.
  const livePrice = $derived(liveFeed.prices[asset.coin]);
  const price = $derived(livePrice ?? asset.price);
  const change = $derived(liveChange24h(asset.price, asset.change24h, livePrice));
  const changeClass = $derived(pnlSignClass(change));
  const flash = $derived(liveFeed.flashes[asset.coin]);
</script>

<a
  class="m-asset-row tappable-row"
  class:m-row-flash-up={flash?.dir === 'up'}
  class:m-row-flash-down={flash?.dir === 'down'}
  data-flash-tick={flash?.n ?? 0}
  href={`/assets/${encodeURIComponent(asset.coin)}`}
  aria-label={`${name} market detail`}
>
  <div class="m-asset-icon" class:is-white={whiteBg} style:background-color={iconBg} style:padding={iconBg ? '4px' : null}>
    {#if icon}
      <img src={icon} alt="" loading="lazy" />
    {:else}
      <span class="m-asset-icon-fallback">{name.slice(0, 2)}</span>
    {/if}
  </div>

  <div class="m-asset-main">
    <div class="m-asset-name">{name}</div>
    <div class="m-asset-meta">
      {#if showVolume}
        Vol {formatUsd(asset.volume24h)}
        {#if asset.maxLeverage}
          <span class="m-asset-sep">·</span>
          <span>{asset.maxLeverage}x</span>
        {/if}
      {:else if asset.maxLeverage}
        <span>{asset.maxLeverage}x</span>
      {/if}
    </div>
  </div>

  <div class="m-asset-stats">
    <div class="m-asset-price">{formatUsd(price, { precise: (price ?? 0) < 100 })}</div>
    <div class="m-asset-change {changeClass}">{formatPct(change)}</div>
  </div>
</a>

<style>
  .m-asset-row {
    min-height: var(--touch-comfortable);
    padding: var(--space-3) var(--space-4);
    gap: var(--space-3);
    color: inherit;
    text-decoration: none;
    background: var(--glass-bg);
    border-radius: var(--radius-md);
  }

  .m-asset-icon {
    flex: 0 0 36px;
    width: 36px;
    height: 36px;
    border-radius: var(--radius-full);
    background: var(--stripe-bg-secondary);
    box-shadow: var(--glass-shadow);
    overflow: hidden;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .m-asset-icon.is-white {
    background: #fff;
  }

  .m-asset-icon img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .m-asset-icon-fallback {
    font-family: var(--font-mono);
    font-size: var(--type-caption);
    color: var(--stripe-text-tertiary);
  }

  .m-asset-main {
    flex: 1 1 auto;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .m-asset-name {
    font-family: var(--font-mono);
    font-size: var(--type-body);
    color: var(--stripe-text-primary);
    font-weight: 500;
    line-height: var(--line-body);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .m-asset-meta {
    font-family: var(--font-mono);
    font-size: var(--type-caption);
    color: var(--stripe-text-tertiary);
    line-height: var(--line-caption);
  }

  .m-asset-sep {
    margin: 0 4px;
    color: var(--stripe-text-muted);
  }

  .m-asset-stats {
    flex: 0 0 auto;
    text-align: right;
    font-family: var(--font-mono);
    font-variant-numeric: tabular-nums;
  }

  .m-asset-price {
    font-size: var(--type-body);
    color: var(--stripe-text-primary);
  }

  .m-asset-change {
    font-size: var(--type-caption);
    color: var(--stripe-text-tertiary);
    margin-top: 2px;
  }

  .m-asset-change:global(.k-pnl-positive) {
    color: var(--stripe-success);
  }
  .m-asset-change:global(.k-pnl-negative) {
    color: var(--stripe-danger);
  }

  /* Per-row flash on each live price tick — a subtle green/red tint that fades
     out, mirroring the desktop web table. The `data-flash-tick` attribute
     changes each tick so the animation can retrigger across consecutive
     same-direction ticks. */
  @keyframes m-row-flash-up {
    0% { background: var(--stripe-success-subtle); }
    100% { background: var(--glass-bg); }
  }
  @keyframes m-row-flash-down {
    0% { background: var(--stripe-danger-subtle); }
    100% { background: var(--glass-bg); }
  }
  .m-asset-row.m-row-flash-up {
    animation: m-row-flash-up 700ms ease-out;
  }
  .m-asset-row.m-row-flash-down {
    animation: m-row-flash-down 700ms ease-out;
  }
  @media (prefers-reduced-motion: reduce) {
    .m-asset-row.m-row-flash-up,
    .m-asset-row.m-row-flash-down {
      animation: none;
    }
  }
</style>
