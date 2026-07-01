<script lang="ts">
  /*
   * Trade tape — a continuous marquee of the EP cohort's recent closed trades,
   * the same source as the feed's Trades tab. Self-contained: fetches once on
   * mount (it's non-critical chrome, so failures stay silent and the bar hides).
   */
  import { onMount } from 'svelte';
  import { getHyperdashTrades, type SmartTrade } from '$lib/api/feed';
  import { coinDisplayName } from '$lib/utils/coin';
  import { effigyUrl, formatRelativeTime, formatUsd } from '$lib/utils/format';

  let trades = $state<SmartTrade[]>([]);
  // Track first-load completion so we can hold the bar's space with a skeleton
  // until data arrives — avoids the tape popping in late and shoving the page
  // content below it down.
  let loaded = $state(false);

  function hideBrokenAvatar(e: Event) {
    (e.currentTarget as HTMLImageElement).style.visibility = 'hidden';
  }

  onMount(async () => {
    try {
      trades = (await getHyperdashTrades()).slice(0, 24);
    } catch {
      // Non-critical: leave trades empty so the ticker simply doesn't render.
    } finally {
      loaded = true;
    }
  });

  // Duplicate the list so the keyframe loop reads as a seamless tape.
  const doubled = $derived([...trades, ...trades]);
</script>

{#if trades.length > 0}
  <div class="m-ticker" role="region" aria-label="Recent trades">
    <span class="m-ticker-live">
      <span class="m-ticker-pulse" aria-hidden="true"></span>
    </span>
    <div class="m-ticker-mask">
      <div class="m-ticker-track">
        {#each doubled as t, i (i + '-' + t.address + t.coin + t.closedAtMs)}
          {@const dup = i >= trades.length}
          {@const isLong = t.direction.toLowerCase() === 'long'}
          <a
            class="m-ticker-item"
            href={`/trader/${t.address}`}
            aria-hidden={dup ? 'true' : undefined}
            tabindex={dup ? -1 : undefined}
          >
            <img
              src={effigyUrl(t.address)}
              alt=""
              loading="lazy"
              onerror={hideBrokenAvatar}
              class="m-ticker-avatar"
            />
            <span
              class="m-ticker-side {isLong ? 'is-buy' : 'is-sell'}"
              aria-hidden="true"
            >
              {isLong ? '↗' : '↘'}
            </span>
            <span class="m-ticker-coin">{coinDisplayName(t.coin)}</span>
            <span class="m-ticker-notional">{formatUsd(t.notionalUsd)}</span>
            <span class="m-ticker-time">{formatRelativeTime(new Date(t.closedAtMs))}</span>
          </a>
        {/each}
      </div>
    </div>
  </div>
{:else if !loaded}
  <!-- Placeholder while the first fetch is in flight: holds the 36px bar so
       the layout doesn't shift when the real tape arrives. -->
  <div class="m-ticker" aria-hidden="true">
    <span class="m-ticker-live">
      <span class="m-ticker-pulse"></span>
    </span>
    <div class="m-ticker-mask">
      <div class="m-ticker-track m-ticker-track-skeleton">
        {#each Array(8) as _, i (i)}
          <span class="m-ticker-skel">
            <span class="m-skeleton m-ticker-skel-avatar"></span>
            <span class="m-skeleton m-ticker-skel-line"></span>
          </span>
        {/each}
      </div>
    </div>
  </div>
{/if}

<style>
  .m-ticker {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    height: 36px;
    margin-bottom: var(--space-3);
    padding-left: max(var(--safe-left), var(--space-4));
    border-bottom: 1px solid var(--stripe-border);
    overflow: hidden;
  }

  .m-ticker-live {
    flex: 0 0 auto;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-family: var(--font-mono);
    font-size: var(--type-caption);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--stripe-text-tertiary);
  }
  .m-ticker-pulse {
    width: 6px;
    height: 6px;
    border-radius: var(--radius-full);
    background: var(--stripe-success);
    box-shadow: 0 0 8px var(--stripe-success);
    animation: m-ticker-blink 1.6s ease-in-out infinite;
  }

  /* Mask fades both edges so items slide in/out instead of hard-clipping. */
  .m-ticker-mask {
    flex: 1 1 auto;
    min-width: 0;
    overflow: hidden;
    -webkit-mask-image: linear-gradient(
      to right,
      transparent 0,
      #000 20px,
      #000 calc(100% - 20px),
      transparent 100%
    );
    mask-image: linear-gradient(
      to right,
      transparent 0,
      #000 20px,
      #000 calc(100% - 20px),
      transparent 100%
    );
  }

  /* Doubled track shifted by -50% loops seamlessly (one full set width).
     Wide gap so one trade's "…ago" has clear air before the next item. */
  .m-ticker-track {
    display: inline-flex;
    align-items: center;
    gap: var(--space-8);
    white-space: nowrap;
    animation: m-ticker-scroll 60s linear infinite;
    will-change: transform;
  }

  .m-ticker-item {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    text-decoration: none;
    color: var(--stripe-text-secondary);
  }
  .m-ticker-avatar {
    width: 18px;
    height: 18px;
    border-radius: var(--radius-full);
    background: var(--stripe-bg-tertiary);
  }
  .m-ticker-side {
    font-family: var(--font-mono);
    font-weight: 700;
  }
  .m-ticker-side.is-buy {
    color: var(--stripe-success);
  }
  .m-ticker-side.is-sell {
    color: var(--stripe-danger);
  }
  .m-ticker-coin {
    font-family: var(--font-sans);
    font-size: var(--type-caption);
    font-weight: 600;
    color: var(--stripe-text-primary);
  }
  .m-ticker-notional {
    font-family: var(--font-mono);
    font-variant-numeric: tabular-nums;
    font-size: var(--type-caption);
    color: var(--stripe-text-secondary);
  }
  .m-ticker-time {
    font-family: var(--font-mono);
    font-size: 10px;
    color: var(--stripe-text-muted);
  }

  /* Skeleton placeholder — static (no marquee) row of shimmer pills that
     occupies the same height as the live tape. */
  .m-ticker-track-skeleton {
    animation: none;
  }
  .m-ticker-skel {
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }
  .m-ticker-skel-avatar {
    width: 18px;
    height: 18px;
    border-radius: var(--radius-full);
  }
  .m-ticker-skel-line {
    width: 92px;
    height: 10px;
    border-radius: var(--radius-sm);
  }

  @keyframes m-ticker-scroll {
    from {
      transform: translateX(0);
    }
    to {
      transform: translateX(-50%);
    }
  }
  @keyframes m-ticker-blink {
    0%,
    100% {
      opacity: 1;
    }
    50% {
      opacity: 0.35;
    }
  }

  /* Reduced motion: stop the marquee + pulse, let the user scroll manually. */
  @media (prefers-reduced-motion: reduce) {
    .m-ticker-track {
      animation: none;
    }
    .m-ticker-pulse {
      animation: none;
    }
    .m-ticker-mask {
      overflow-x: auto;
      scrollbar-width: none;
    }
    .m-ticker-mask::-webkit-scrollbar {
      display: none;
    }
  }
</style>
