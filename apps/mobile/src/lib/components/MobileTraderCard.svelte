<script lang="ts">
  import type { LeaderRow } from '$lib/api/leaders';
  import { effigyUrl, shortAddress, formatPnl, pnlSignClass } from '$lib/utils/format';
  import { coinIconUrl } from '$lib/utils/coin';
  import MobileEquityCurve from './MobileEquityCurve.svelte';

  interface Props {
    row: LeaderRow;
  }
  let { row }: Props = $props();

  const scoreText = $derived(row.score === null ? '—' : Math.round(row.score).toString());
  const scoreFilled = $derived(row.score === null ? 0 : Math.max(0, Math.min(10, Math.round(row.score / 10))));
  const pnlClass = $derived(pnlSignClass(row.pnl_30d_usd));
  // Mock shows up to 5 holding pips before the +N overflow.
  const shownHoldings = $derived(row.holdings.top.slice(0, 5));
  const extraHoldings = $derived(Math.max(0, row.holdings.total - shownHoldings.length));
  const relTime = $derived(formatRelative(row.last_active_at));

  /** "3D AGO" / "5H AGO" / "12M AGO" from an ISO timestamp. Coarse buckets
   *  — minutes / hours / days / weeks / months — matching the mock. */
  function formatRelative(iso: string | null): string {
    if (!iso) return '—';
    const t = Date.parse(iso);
    if (!Number.isFinite(t)) return '—';
    const diffSec = (Date.now() - t) / 1000;
    if (diffSec < 60) return 'NOW';
    const mins = Math.floor(diffSec / 60);
    if (mins < 60) return `${mins}M AGO`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}H AGO`;
    const days = Math.floor(hours / 24);
    if (days < 7) return `${days}D AGO`;
    const weeks = Math.floor(days / 7);
    if (weeks < 5) return `${weeks}W AGO`;
    const months = Math.floor(days / 30);
    return `${months}MO AGO`;
  }
</script>

<a
  class="m-trader-card"
  href={`/trader/${row.address}`}
  aria-label={`Trader ${row.address}, score ${scoreText}`}
>
  <div class="m-trader-head">
    <img
      class="m-trader-avatar"
      src={effigyUrl(row.address)}
      alt=""
      loading="lazy"
    />
    <div class="m-trader-id">
      <span class="m-trader-addr">{shortAddress(row.address, 6, 4)}</span>
      {#if shownHoldings.length > 0}
        <span class="m-trader-holdings" aria-label={`${row.holdings.total} open holdings`}>
          {#each shownHoldings as h (h.coin)}
            <img
              class="m-trader-hold-icon"
              class:is-long={h.side === 'long'}
              class:is-short={h.side === 'short'}
              src={coinIconUrl(h.coin)}
              alt=""
              loading="lazy"
            />
          {/each}
          {#if extraHoldings > 0}
            <span class="m-trader-hold-more">+{extraHoldings}</span>
          {/if}
        </span>
      {/if}
    </div>
    <span class="m-trader-time" aria-label="Last active">
      {relTime}
      <svg
        viewBox="0 0 24 24"
        class="m-trader-time-icon"
        fill="none"
        stroke="currentColor"
        stroke-width="1.6"
        stroke-linecap="round"
        stroke-linejoin="round"
        aria-hidden="true"
      >
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7v5l3 2" />
      </svg>
    </span>
  </div>

  <div class="m-trader-body">
    <div class="m-trader-figs">
      <div class="m-trader-fig">
        <span class="m-trader-fig-val {pnlClass}">{formatPnl(row.pnl_30d_usd)}</span>
        <span class="m-trader-fig-label">PnL 30D</span>
      </div>
      <div class="m-trader-fig">
        <span class="m-trader-fig-val">{formatPnl(row.account_value)}</span>
        <span class="m-trader-fig-label">Equity</span>
      </div>
    </div>
    <div class="m-trader-spark">
      <MobileEquityCurve data={row.pnl_curve_30d} height={60} />
    </div>
  </div>

  <div class="m-trader-foot">
    <div class="m-trader-score" aria-label={`Score ${scoreText} out of 100`}>
      <span class="m-trader-score-val">{scoreText}</span>
      <span class="m-trader-score-of">/100</span>
      <span class="m-trader-score-bars" aria-hidden="true">
        {#each Array(10) as _, i (i)}
          <span class="m-trader-score-bar" class:is-on={i < scoreFilled}></span>
        {/each}
      </span>
    </div>
    <button
      type="button"
      class="m-trader-mirror m-btn"
      aria-disabled="true"
      tabindex="-1"
      onclick={(e) => e.preventDefault()}
    >
      Mirror
    </button>
  </div>
</a>

<style>
  .m-trader-card {
    display: flex;
    flex-direction: column;
    text-decoration: none;
    color: inherit;
    background: var(--glass-bg);
    -webkit-backdrop-filter: var(--glass-blur);
    backdrop-filter: var(--glass-blur);
    border-radius: var(--radius-lg);
    box-shadow: var(--glass-highlight), var(--glass-shadow);
    overflow: hidden;
  }

  /* ── Header row ───────────────────────────────────────── */
  .m-trader-head {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-3) var(--space-4);
  }

  .m-trader-avatar {
    width: 40px;
    height: 40px;
    flex: 0 0 40px;
    border-radius: var(--radius-md);
    background: var(--stripe-bg-secondary);
    object-fit: cover;
  }

  .m-trader-id {
    display: flex;
    flex-direction: column;
    gap: 4px;
    min-width: 0;
    flex: 1;
  }

  .m-trader-addr {
    font-family: var(--font-sans);
    font-size: var(--type-title);
    font-weight: 600;
    color: var(--stripe-text-primary);
    line-height: 1.1;
    letter-spacing: -0.01em;
  }

  .m-trader-holdings {
    display: inline-flex;
    align-items: center;
    min-width: 0;
  }

  .m-trader-hold-icon {
    width: 16px;
    height: 16px;
    flex: 0 0 16px;
    border-radius: var(--radius-full);
    object-fit: cover;
    background: var(--stripe-bg-secondary);
    /* Ring color encodes long/short, matching the existing top-trader card. */
    border: 1.5px solid var(--stripe-bg-secondary);
  }
  .m-trader-hold-icon.is-long {
    border-color: var(--stripe-success);
  }
  .m-trader-hold-icon.is-short {
    border-color: var(--stripe-danger);
  }
  .m-trader-hold-icon:not(:first-child) {
    margin-left: -6px;
  }

  .m-trader-hold-more {
    margin-left: 5px;
    font-family: var(--font-mono);
    font-variant-numeric: tabular-nums;
    font-size: 10px;
    color: var(--stripe-text-tertiary);
  }

  .m-trader-time {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    flex: 0 0 auto;
    padding: 4px 8px;
    border-radius: var(--radius-md);
    background: var(--stripe-accent-muted);
    font-family: var(--font-mono);
    font-size: 10px;
    letter-spacing: 0.06em;
    color: var(--stripe-text-tertiary);
  }
  .m-trader-time-icon {
    width: 12px;
    height: 12px;
  }

  /* ── Middle row — figures + sparkline ─────────────────── */
  .m-trader-body {
    display: grid;
    grid-template-columns: minmax(0, auto) 1fr;
    gap: var(--space-4);
    align-items: center;
    padding: var(--space-3) var(--space-4);
    border-top: 1px solid var(--stripe-border);
  }

  .m-trader-figs {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    min-width: 0;
  }
  .m-trader-fig {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .m-trader-fig-val {
    font-family: var(--font-mono);
    font-variant-numeric: tabular-nums;
    /* Hero metric in the card — sits between body and title scales so a
       6-figure dollar value still fits next to the sparkline without
       wrapping on 360px-wide phones. */
    font-size: 20px;
    font-weight: 600;
    color: var(--stripe-text-primary);
    line-height: 1.15;
  }
  .m-trader-fig-val:global(.k-pnl-positive) {
    color: var(--stripe-success);
  }
  .m-trader-fig-val:global(.k-pnl-negative) {
    color: var(--stripe-danger);
  }
  .m-trader-fig-label {
    font-family: var(--font-mono);
    font-size: var(--type-footnote);
    color: var(--stripe-text-tertiary);
    letter-spacing: 0.02em;
  }

  /* Wrapper for the lightweight-charts canvas sparkline. Fixed 60px tall
     so the card height stays predictable regardless of the trace's
     amplitude; the chart auto-fits to this height + the available width. */
  .m-trader-spark {
    width: 100%;
    height: 60px;
  }

  /* ── Footer row — score + Mirror ──────────────────────── */
  .m-trader-foot {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
    padding: var(--space-3) var(--space-4);
    border-top: 1px solid var(--stripe-border);
  }

  .m-trader-score {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    font-family: var(--font-mono);
    font-variant-numeric: tabular-nums;
  }
  .m-trader-score-val {
    font-size: var(--type-title);
    font-weight: 600;
    color: var(--stripe-text-primary);
    line-height: 1;
  }
  .m-trader-score-of {
    font-size: var(--type-footnote);
    color: var(--stripe-text-tertiary);
  }
  /* Ten thin bars, lit by composite score. Same accent as the desktop
     score meter; off-bars are a faint tone so the meter still reads
     against the glass surface. */
  .m-trader-score-bars {
    display: inline-flex;
    gap: 2px;
    align-items: flex-end;
    margin-left: var(--space-1);
  }
  .m-trader-score-bar {
    display: inline-block;
    width: 3px;
    height: 12px;
    background: var(--stripe-accent-muted);
    border-radius: 1px;
  }
  .m-trader-score-bar.is-on {
    background: var(--stripe-success);
  }

  /* Mirror button — visually a primary action, but inert: aria-disabled
     and a non-interactive style so screen readers and keyboard users
     understand it's not wired up yet. Click is captured by the parent
     <a>; preventDefault on the button stops the implicit form submit. */
  .m-trader-mirror {
    padding: 10px 18px;
    font-family: var(--font-sans);
    font-size: var(--type-subhead);
    font-weight: 600;
    letter-spacing: 0.01em;
    opacity: 0.7;
    cursor: not-allowed;
  }
</style>
