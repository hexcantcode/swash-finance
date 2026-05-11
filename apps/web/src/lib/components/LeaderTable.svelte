<script lang="ts">
  import type { LeaderCard } from '$lib/server/queries/leaders';
  import {
    compositeScoreClass,
    effigyUrl,
    formatRelativeTime,
    pnlSignClass,
    truncateAddress,
  } from '$lib/utils/format';
  import { mainTagClass, mainTagLabel } from '$lib/utils/tags';

  interface Props {
    rows: LeaderCard[];
    serverSorted?: boolean;
    sort?: SortKey;
    onSortChange?: (key: SortKey) => void;
    rankOffset?: number;
  }

  export type SortKey = 'composite_score' | 'roi' | 'last_active';

  let {
    rows = [],
    serverSorted = false,
    sort = 'composite_score',
    onSortChange,
    rankOffset = 0,
  }: Props = $props();

  let localSort = $state<SortKey>(sort);
  let localDir = $state<'asc' | 'desc'>('desc');

  const activeSort = $derived(serverSorted ? sort : localSort);

  function setSort(key: SortKey) {
    if (serverSorted) {
      onSortChange?.(key);
      return;
    }
    if (localSort === key) {
      localDir = localDir === 'asc' ? 'desc' : 'asc';
    } else {
      localSort = key;
      localDir = 'desc';
    }
  }

  function compareValues(a: number | string | null, b: number | string | null): number {
    if (a === null || a === undefined) return 1;
    if (b === null || b === undefined) return -1;
    if (typeof a === 'number' && typeof b === 'number') return a - b;
    return String(a).localeCompare(String(b));
  }

  function getSortValue(row: LeaderCard, key: SortKey): number | string | null {
    switch (key) {
      case 'composite_score':
        return row.composite_score;
      case 'roi':
        return row.metrics.roi;
      case 'last_active':
        return row.last_active_at ? new Date(row.last_active_at).getTime() : null;
    }
  }

  const displayed = $derived.by(() => {
    if (serverSorted) return rows;
    return [...rows].sort((a, b) => {
      const av = getSortValue(a, localSort);
      const bv = getSortValue(b, localSort);
      const cmp = compareValues(av, bv);
      return localDir === 'asc' ? cmp : -cmp;
    });
  });

  function indicator(key: SortKey): string {
    if (activeSort !== key) return '';
    if (serverSorted) return '▼';
    return localDir === 'asc' ? '▲' : '▼';
  }

  function ariaSort(key: SortKey): 'ascending' | 'descending' | 'none' {
    if (activeSort !== key) return 'none';
    if (serverSorted) return 'descending';
    return localDir === 'asc' ? 'ascending' : 'descending';
  }

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

<div class="k-table-wrap">
  <table class="stripe-table" aria-label="Hyperliquid traders ranked by composite score">
    <thead>
      <tr>
        <th class="stripe-table-numeric"><span class="sr-only">Rank</span>#</th>
        <th class="stripe-table-trader">Trader</th>
        <th class="stripe-table-numeric">Tag</th>
        <th class="stripe-table-numeric" aria-sort={ariaSort('composite_score')}>
          <button
            type="button"
            class="k-th-sort-button"
            class:is-active={activeSort === 'composite_score'}
            onclick={() => setSort('composite_score')}
          >
            Score<span class="stripe-th-sort-indicator">{indicator('composite_score')}</span>
          </button>
        </th>
        <th class="stripe-table-numeric" aria-sort={ariaSort('roi')}>
          <button
            type="button"
            class="k-th-sort-button"
            class:is-active={activeSort === 'roi'}
            onclick={() => setSort('roi')}
          >
            ROI<span class="stripe-th-sort-indicator">{indicator('roi')}</span>
          </button>
        </th>
        <th class="stripe-table-numeric" aria-sort={ariaSort('last_active')}>
          <button
            type="button"
            class="k-th-sort-button"
            class:is-active={activeSort === 'last_active'}
            onclick={() => setSort('last_active')}
          >
            Last active<span class="stripe-th-sort-indicator">{indicator('last_active')}</span>
          </button>
        </th>
      </tr>
    </thead>
    <tbody>
      {#each displayed as row, i (row.address)}
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
            <span class="tag-chip {mainTagClass(row.primary_tag)}">{mainTagLabel(row.primary_tag)}</span>
          </td>
          <td class="stripe-table-numeric {compositeScoreClass(row.composite_score)}">
            {row.composite_score ?? '—'}
          </td>
          <td class="stripe-table-numeric {pnlSignClass(row.metrics.roi)}">
            {formatRoi(row.metrics.roi)}
          </td>
          <td class="stripe-table-numeric">{formatRelativeTime(row.last_active_at)}</td>
        </tr>
      {/each}
    </tbody>
  </table>
</div>
