<script lang="ts">
  import type { LeaderRow } from '$lib/api/leaders';
  import { effigyUrl, traderName, formatPnl, formatRelativeTime, pnlSignClass } from '$lib/utils/format';
  import { coinIconUrl, coinIconBg } from '$lib/utils/coin';
  import { appSheet } from '$lib/ui/sheets.svelte';
  import MobileSparkline from './MobileSparkline.svelte';

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
  const relTime = $derived(formatRelativeTime(row.last_active_at));
  const holdingsLabel = $derived(
    `${row.holdings.total} open positions: ` +
      shownHoldings.map((h) => `${h.coin}${h.side ? ` ${h.side}` : ''}`).join(', ') +
      (extraHoldings > 0 ? ` and ${extraHoldings} more` : ''),
  );
  const sparkPoints = $derived(row.pnl_curve_30d.map((v, i) => ({ t: i, c: v })));
</script>

<!-- The card is a div with a stretched link overlay: a button can't legally
     nest inside an <a>, and the score / Mirror buttons must stay independently
     tappable. Buttons sit above the overlay via z-index. -->
<article class="m-trader-card">
  <a
    class="m-trader-card-link"
    href={`/trader/${row.address}`}
    aria-label={`Trader ${traderName(row.display_name, row.address)}, score ${scoreText}`}
  ></a>

  <div class="m-trader-head">
    <img
      class="m-trader-avatar"
      src={effigyUrl(row.address)}
      alt=""
      loading="lazy"
    />
    <div class="m-trader-id">
      <span class="m-trader-addr">
        {traderName(row.display_name, row.address, 6, 4)}
        {#if row.heat === 'hot'}<span class="m-hot-chip">Hot</span>{/if}
      </span>
      {#if shownHoldings.length > 0}
        <span class="m-trader-holdings" aria-label={holdingsLabel}>
          {#each shownHoldings as h (h.coin)}
            <img
              class="m-trader-hold-icon"
              class:is-long={h.side === 'long'}
              class:is-short={h.side === 'short'}
              src={coinIconUrl(h.coin)}
              style:background-color={coinIconBg(h.coin)}
              style:padding={coinIconBg(h.coin) ? '2px' : null}
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
        <span class="m-trader-fig-label">Profit 30D</span>
      </div>
      <div class="m-trader-fig">
        <span class="m-trader-fig-val">{formatPnl(row.account_value)}</span>
        <span class="m-trader-fig-label">Account value</span>
      </div>
    </div>
    <div class="m-trader-spark">
      <MobileSparkline candles={sparkPoints} height={60} label="Profit trend, last 30 days" />
    </div>
  </div>

  <div class="m-trader-foot">
    <button
      type="button"
      class="m-trader-score tap-hit"
      aria-label={`Score ${scoreText} out of 100 — what does this mean?`}
      onclick={() => appSheet.open('score')}
    >
      <span class="m-trader-score-val">{scoreText}</span>
      <span class="m-trader-score-of">/100</span>
      <span class="m-trader-score-bars" aria-hidden="true">
        {#each Array(10) as _, i (i)}
          <span class="m-trader-score-bar" class:is-on={i < scoreFilled}></span>
        {/each}
      </span>
      <svg
        class="m-trader-score-info"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="1.8"
        stroke-linecap="round"
        aria-hidden="true"
      >
        <circle cx="12" cy="12" r="9" />
        <path d="M12 11v5 M12 8h.01" />
      </svg>
    </button>
    <button
      type="button"
      class="m-trader-mirror m-cta-primary"
      onclick={() => appSheet.open('mirror')}
    >
      Mirror
    </button>
  </div>
</article>

<style>
  .m-trader-card {
    position: relative;
    display: flex;
    flex-direction: column;
    color: inherit;
    background: var(--glass-bg);
    -webkit-backdrop-filter: var(--glass-blur);
    backdrop-filter: var(--glass-blur);
    border-radius: var(--radius-lg);
    box-shadow: var(--glass-highlight), var(--glass-shadow);
    overflow: hidden;
  }

  /* Stretched link — covers the whole card; the score and Mirror buttons
     sit above it. */
  .m-trader-card-link {
    position: absolute;
    inset: 0;
    z-index: 1;
    border-radius: inherit;
  }

  /* ── Header row ───────────────────────────────────────── */
  .m-trader-head {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-4);
  }

  .m-trader-avatar {
    width: 32px;
    height: 32px;
    flex: 0 0 32px;
    border-radius: var(--radius-full);
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
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-family: var(--font-sans);
    font-size: var(--type-subhead);
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
    text-transform: uppercase;
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

  /* Fixed 60px tall so the card height stays predictable regardless of the
     trace's amplitude; the SVG stretches to the available width. */
  .m-trader-spark {
    width: 100%;
    height: 60px;
  }

  /* ── Footer row — score + Mirror ──────────────────────── */
  .m-trader-foot {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-4);
    border-top: 1px solid var(--stripe-border);
  }

  /* Tappable: opens the score-explainer sheet. Sits above the stretched
     card link. */
  .m-trader-score {
    position: relative;
    z-index: 2;
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    padding: 0;
    border: 0;
    background: transparent;
    cursor: pointer;
    font-family: var(--font-mono);
    font-variant-numeric: tabular-nums;
  }
  .m-trader-score-val {
    font-size: var(--type-subhead);
    font-weight: 600;
    color: var(--stripe-text-primary);
    line-height: 1;
  }
  .m-trader-score-of {
    font-size: 11px;
    color: var(--stripe-text-tertiary);
  }
  /* Ten thin bars, lit by composite score. Monochrome accent — green is
     reserved for profit/long everywhere else. */
  .m-trader-score-bars {
    display: inline-flex;
    gap: 2px;
    align-items: flex-end;
    margin-left: var(--space-1);
  }
  .m-trader-score-bar {
    display: inline-block;
    width: 2px;
    height: 8px;
    background: var(--stripe-accent-muted);
    border-radius: 1px;
  }
  .m-trader-score-bar.is-on {
    background: var(--stripe-accent);
  }
  /* Small ⓘ — signals the score is tappable / explainable. */
  .m-trader-score-info {
    width: 13px;
    height: 13px;
    color: var(--stripe-text-tertiary);
  }

  .m-trader-mirror {
    position: relative;
    z-index: 2;
    padding: 6px 14px;
  }
</style>
