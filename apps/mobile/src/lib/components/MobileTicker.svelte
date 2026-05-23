<script lang="ts">
  /*
   * Live trade tape — a continuous marquee of the latest fills, mirroring the
   * web app's TradeTicker. Self-contained: fetches once on mount (it's
   * non-critical chrome, so failures stay silent and the bar just hides).
   */
  import { onMount } from 'svelte';
  import { getLatestFills, mergeFills, type LatestFill } from '$lib/api/feed';
  import { coinDisplayName } from '$lib/utils/coin';
  import { effigyUrl, formatRelativeTime, formatUsd } from '$lib/utils/format';

  let trades = $state<LatestFill[]>([]);

  function hideBrokenAvatar(e: Event) {
    (e.currentTarget as HTMLImageElement).style.visibility = 'hidden';
  }

  onMount(async () => {
    try {
      trades = mergeFills(await getLatestFills()).slice(0, 24);
    } catch {
      // Non-critical: leave trades empty so the ticker simply doesn't render.
    }
  });

  // Duplicate the list so the keyframe loop reads as a seamless tape.
  const doubled = $derived([...trades, ...trades]);
</script>

{#if trades.length > 0}
  <div class="m-ticker" role="region" aria-label="Recent trades">
    <span class="m-ticker-live">
      <span class="m-ticker-pulse" aria-hidden="true"></span>
      Live
    </span>
    <div class="m-ticker-mask">
      <div class="m-ticker-track">
        {#each doubled as t, i (i + '-' + t.key)}
          {@const dup = i >= trades.length}
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
              class="m-ticker-side {t.side === 'B' ? 'is-buy' : 'is-sell'}"
              aria-hidden="true"
            >
              {t.side === 'B' ? '↗' : '↘'}
            </span>
            <span class="m-ticker-coin">{coinDisplayName(t.coin)}</span>
            <span class="m-ticker-notional">{formatUsd(t.notionalUsd)}</span>
            <span class="m-ticker-time">{formatRelativeTime(new Date(t.blockTimeMs))}</span>
          </a>
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

  /* Doubled track shifted by -50% loops seamlessly (one full set width). */
  .m-ticker-track {
    display: inline-flex;
    align-items: center;
    gap: var(--space-5);
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
