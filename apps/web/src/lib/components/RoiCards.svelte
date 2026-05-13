<script lang="ts">
  import { effigyUrl, formatPnl, pnlSignClass, truncateAddress } from '$lib/utils/format';

  interface Props {
    /** Top earners over the last 7 days, ordered by `pnl_7d_usd` desc; the
     *  ROI is shown alongside as context but never used for ranking. */
    rows: Array<{ address: string; pnl_7d_usd: number | null; roi_7d: number | null }>;
  }
  let { rows = [] }: Props = $props();

  function hideBrokenAvatar(e: Event) {
    const img = e.currentTarget as HTMLImageElement;
    img.style.visibility = 'hidden';
  }

  function formatRoi(value: number | null): string {
    if (value === null || value === undefined || !Number.isFinite(value)) return '—';
    const pct = value * 100;
    if (Math.abs(pct) >= 1000) return `${(pct / 100).toFixed(1)}x`;
    if (Math.abs(pct) >= 100) return `${pct.toFixed(0)}%`;
    return `${pct.toFixed(1)}%`;
  }
</script>

<div class="k-card-scroll" aria-label="Top earners — last 7 days realized PnL">
  {#each rows as row (row.address)}
    <a class="k-roi-card" href="/trader/{row.address}">
      <img
        src={effigyUrl(row.address)}
        alt=""
        loading="lazy"
        onerror={hideBrokenAvatar}
        class="stripe-avatar stripe-avatar-ring k-roi-card-avatar"
      />
      <span class="k-roi-card-addr">{truncateAddress(row.address)}</span>
      <span class="k-roi-card-pnl {pnlSignClass(row.pnl_7d_usd)}">{formatPnl(row.pnl_7d_usd)}</span>
      <span class="k-roi-card-roi-sub {pnlSignClass(row.roi_7d)}">{formatRoi(row.roi_7d)}</span>
    </a>
  {/each}
</div>

<style>
  /* PnL is the primary number; ROI gets a thin secondary line below. */
  :global(.k-roi-card-pnl) {
    flex: 0 0 auto;
    font-size: 14px;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
    letter-spacing: -0.01em;
  }
  :global(.k-roi-card-roi-sub) {
    flex: 0 0 auto;
    margin-left: 6px;
    font-size: 11px;
    font-weight: 500;
    font-variant-numeric: tabular-nums;
    opacity: 0.7;
  }
</style>
