<script lang="ts">
  import type { LeaderCard } from '$lib/server/queries/leaders';
  import ScoreBars from './ScoreBars.svelte';
  import {
    scoreClass,
    effigyUrl,
    formatPnl,
    formatTradesPerWeek,
    formatUsd,
    pnlSignClass,
    truncateAddress,
  } from '$lib/utils/format';

  interface Props {
    rows: LeaderCard[];
    serverSorted?: boolean;
    sort?: SortKey;
    onSortChange?: (key: SortKey) => void;
  }

  export type SortKey = 'score' | 'pnl' | 'equity' | 'frequency';

  let {
    rows = [],
    serverSorted = false,
    sort = 'score',
    onSortChange,
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
      case 'score':
        return row.score;
      case 'pnl':
        return row.metrics.total_pnl_usd;
      case 'equity':
        return row.account_value;
      case 'frequency':
        return row.metrics.trades_per_week;
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

  // Keep the table a constant height — pad short result sets with empty rows.
  const MIN_ROWS = 10;
  const ghostCount = $derived(Math.max(0, MIN_ROWS - displayed.length));
</script>

<div class="k-table-wrap">
  <table class="stripe-table" aria-label="Hyperliquid traders ranked by composite score">
    <thead>
      <tr>
        <th class="stripe-table-trader">Trader</th>
        <th class="stripe-table-numeric" aria-sort={ariaSort('pnl')}>
          <button
            type="button"
            class="k-th-sort-button"
            class:is-active={activeSort === 'pnl'}
            onclick={() => setSort('pnl')}
          >
            PnL<span class="stripe-th-sort-indicator">{indicator('pnl')}</span>
          </button>
        </th>
        <th class="stripe-table-numeric" aria-sort={ariaSort('equity')}>
          <button
            type="button"
            class="k-th-sort-button"
            class:is-active={activeSort === 'equity'}
            onclick={() => setSort('equity')}
          >
            Equity<span class="stripe-th-sort-indicator">{indicator('equity')}</span>
          </button>
        </th>
        <th class="stripe-table-numeric" aria-sort={ariaSort('score')}>
          <button
            type="button"
            class="k-th-sort-button"
            class:is-active={activeSort === 'score'}
            onclick={() => setSort('score')}
          >
            Score<span class="stripe-th-sort-indicator">{indicator('score')}</span>
          </button>
        </th>
        <th class="stripe-table-numeric" aria-sort={ariaSort('frequency')}>
          <button
            type="button"
            class="k-th-sort-button"
            class:is-active={activeSort === 'frequency'}
            onclick={() => setSort('frequency')}
            title="Weekly trade average"
          >
            Frequency<span class="stripe-th-sort-indicator">{indicator('frequency')}</span>
          </button>
        </th>
      </tr>
    </thead>
    <tbody>
      {#each displayed as row (row.address)}
        <tr>
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
          <td class="stripe-table-numeric {pnlSignClass(row.metrics.total_pnl_usd)}">
            {formatPnl(row.metrics.total_pnl_usd)}
          </td>
          <td class="stripe-table-numeric">{formatUsd(row.account_value)}</td>
          <td class="stripe-table-numeric">
            <span class="k-score-cell">
              <span class={scoreClass(row.score)}>{row.score ?? '—'}</span>
              <ScoreBars score={row.score} />
            </span>
          </td>
          <td class="stripe-table-numeric">{formatTradesPerWeek(row.metrics.trades_per_week)}</td>
        </tr>
      {/each}
      {#each Array(ghostCount) as _, i (`ghost-${i}`)}
        <tr class="k-row-ghost" aria-hidden="true">
          <td class="stripe-table-trader">
            <span class="k-trader-link">
              <span class="stripe-avatar stripe-avatar-sm k-avatar-ghost"></span>
              <span>—</span>
            </span>
          </td>
          <td class="stripe-table-numeric">—</td>
          <td class="stripe-table-numeric">—</td>
          <td class="stripe-table-numeric">—</td>
          <td class="stripe-table-numeric">—</td>
        </tr>
      {/each}
    </tbody>
  </table>
</div>
