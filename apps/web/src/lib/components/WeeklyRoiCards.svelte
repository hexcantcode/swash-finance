<script lang="ts">
  import type { WeeklyLeaderRow } from '$lib/server/queries/weekly-leaders';
  import {
    compositeScoreClass,
    effigyUrl,
    formatPct,
    formatPnl,
    pnlSignClass,
    truncateAddress,
  } from '$lib/utils/format';

  interface Props {
    rows: WeeklyLeaderRow[];
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
      <div class="k-roi-card-head">
        <img
          src={effigyUrl(row.address)}
          alt=""
          loading="lazy"
          onerror={hideBrokenAvatar}
          class="stripe-avatar stripe-avatar-ring k-roi-card-avatar"
        />
        <span class="k-roi-card-addr">{truncateAddress(row.address)}</span>
      </div>

      <div class="k-roi-card-stats">
        <div class="k-roi-card-stat">
          <span class="k-roi-card-stat-val {pnlSignClass(row.roi_7d)}">{formatRoi(row.roi_7d)}</span>
          <span class="k-roi-card-stat-label">7d ROI</span>
        </div>
        <div class="k-roi-card-stat">
          <span class="k-roi-card-stat-val {pnlSignClass(row.pnl_7d_usd)}">{formatPnl(row.pnl_7d_usd)}</span>
          <span class="k-roi-card-stat-label">7d PnL</span>
        </div>
        <div class="k-roi-card-stat">
          <span class="k-roi-card-stat-val">{formatPct(row.win_rate, 0)}</span>
          <span class="k-roi-card-stat-label">Win rate</span>
        </div>
        <div class="k-roi-card-stat">
          <span class="k-roi-card-stat-val {compositeScoreClass(row.composite_score)}">
            {row.composite_score ?? '—'}
          </span>
          <span class="k-roi-card-stat-label">Score</span>
        </div>
      </div>
    </a>
  {/each}
</div>
