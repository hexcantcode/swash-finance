<script lang="ts">
  import { effigyUrl, pnlSignClass, truncateAddress } from '$lib/utils/format';

  interface Props {
    /** last-week ROI makers, ordered desc; `roi_7d` is a decimal (0.05 = 5%). */
    rows: Array<{ address: string; roi_7d: number | null }>;
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

<div class="k-card-scroll" aria-label="Top traders by 7-day ROI">
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
      <span class="k-roi-card-roi {pnlSignClass(row.roi_7d)}">{formatRoi(row.roi_7d)}</span>
    </a>
  {/each}
</div>
