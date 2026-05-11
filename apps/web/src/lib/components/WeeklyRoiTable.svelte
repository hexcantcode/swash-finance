<script lang="ts">
  import type { WeeklyLeaderRow } from '$lib/server/queries/weekly-leaders';
  import {
    effigyUrl,
    formatPnl,
    formatRelativeTime,
    pnlSignClass,
    truncateAddress,
  } from '$lib/utils/format';
  import { mainTagClass, mainTagLabel } from '$lib/utils/tags';

  interface Props {
    rows: WeeklyLeaderRow[];
    rankOffset?: number;
  }
  let { rows = [], rankOffset = 0 }: Props = $props();

  function hideBrokenAvatar(e: Event) {
    const img = e.currentTarget as HTMLImageElement;
    img.style.visibility = 'hidden';
  }

  function formatRoi(value: number | null): string {
    if (value === null || value === undefined || !Number.isFinite(value)) return '—';
    const pct = value * 100;
    const sign = pct > 0 ? '+' : '';
    if (Math.abs(pct) >= 1000) return `${sign}${(pct / 100).toFixed(1)}x`;
    if (Math.abs(pct) >= 100) return `${sign}${pct.toFixed(0)}%`;
    return `${sign}${pct.toFixed(1)}%`;
  }
</script>

<div class="k-table-wrap">
  <table class="stripe-table" aria-label="Top traders by 7-day ROI">
    <thead>
      <tr>
        <th class="stripe-table-numeric"><span class="sr-only">Rank</span>#</th>
        <th class="stripe-table-trader">Trader</th>
        <th class="stripe-table-numeric">Tag</th>
        <th class="stripe-table-numeric">7d ROI ▼</th>
        <th class="stripe-table-numeric">7d PnL</th>
        <th class="stripe-table-numeric">Last active</th>
      </tr>
    </thead>
    <tbody>
      {#each rows as row, i (row.address)}
        <tr>
          <td class="stripe-table-numeric k-rank">{rankOffset + i + 1}</td>
          <td class="stripe-table-trader">
            <a class="k-trader-link" href="/trader/{row.address}">
              <img
                src={effigyUrl(row.address)}
                alt=""
                loading="lazy"
                onerror={hideBrokenAvatar}
                class="stripe-avatar stripe-avatar-sm stripe-avatar-ring"
              />
              <span>{truncateAddress(row.address)}</span>
            </a>
          </td>
          <td class="stripe-table-numeric">
            <span class="tag-chip {mainTagClass(row.primary_tag)}">
              {mainTagLabel(row.primary_tag)}
            </span>
          </td>
          <td class="stripe-table-numeric {pnlSignClass(row.roi_7d)}">
            {formatRoi(row.roi_7d)}
          </td>
          <td class="stripe-table-numeric {pnlSignClass(row.pnl_7d_usd)}">
            {formatPnl(row.pnl_7d_usd)}
          </td>
          <td class="stripe-table-numeric">{formatRelativeTime(row.last_active_at)}</td>
        </tr>
      {/each}
    </tbody>
  </table>
</div>
