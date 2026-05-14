<script lang="ts">
  import type { TickerTrade } from '$lib/server/queries/recent-trades';
  import { coinDisplayName } from '$lib/utils/coin';
  import { effigyUrl, formatRelativeTime, formatUsd, truncateAddress } from '$lib/utils/format';

  interface Props {
    trades: TickerTrade[];
  }
  let { trades }: Props = $props();

  function hideBrokenAvatar(e: Event) {
    const img = e.currentTarget as HTMLImageElement;
    img.style.visibility = 'hidden';
  }

  // Duplicate the list so the keyframe loop reads as a continuous tape.
  const doubled = $derived([...trades, ...trades]);
</script>

{#if trades.length > 0}
  <div class="k-ticker" role="region" aria-label="Recent trades">
    <span class="k-ticker-pulse" aria-hidden="true"></span>
    <span class="k-ticker-label">Live</span>
    <div class="k-ticker-mask">
      <div class="k-ticker-track">
        {#each doubled as t, i (i + '-' + t.key)}
          <a
            class="k-ticker-item"
            href="/trader/{t.address}"
            aria-label="{truncateAddress(t.address)} {t.side === 'B' ? 'bought' : 'sold'} {coinDisplayName(t.coin)}"
          >
            <img
              src={effigyUrl(t.address)}
              alt=""
              loading="lazy"
              onerror={hideBrokenAvatar}
              class="k-ticker-avatar"
            />
            <span class="k-ticker-addr">{truncateAddress(t.address)}</span>
            <span class="k-ticker-side {t.side === 'B' ? 'buy' : 'sell'}">
              {t.side === 'B' ? '↗' : '↘'}
            </span>
            <span class="k-ticker-coin">{coinDisplayName(t.coin)}</span>
            <span class="k-ticker-notional">{formatUsd(t.notionalUsd)}</span>
            <span class="k-ticker-time">{formatRelativeTime(new Date(t.blockTimeMs))}</span>
          </a>
        {/each}
      </div>
    </div>
  </div>
{/if}
