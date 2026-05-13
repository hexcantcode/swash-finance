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
        {#each doubled as t, i (i + '-' + t.tid)}
          <a
            class="k-ticker-item"
            href="/trader/{t.master_address}"
            aria-label="{truncateAddress(t.master_address)} {t.side === 'B' ? 'bought' : 'sold'} {coinDisplayName(t.coin)}"
          >
            <img
              src={effigyUrl(t.master_address)}
              alt=""
              loading="lazy"
              onerror={hideBrokenAvatar}
              class="k-ticker-avatar"
            />
            <span class="k-ticker-addr">{truncateAddress(t.master_address)}</span>
            <span class="k-ticker-side {t.side === 'B' ? 'buy' : 'sell'}">
              {t.side === 'B' ? '↗' : '↘'}
            </span>
            <span class="k-ticker-coin">{coinDisplayName(t.coin)}</span>
            <span class="k-ticker-notional">{formatUsd(t.notional)}</span>
            <span class="k-ticker-time">{formatRelativeTime(new Date(t.block_time_ms))}</span>
          </a>
        {/each}
      </div>
    </div>
  </div>
{/if}
