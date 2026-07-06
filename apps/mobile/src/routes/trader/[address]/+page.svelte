<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { page } from '$app/stores';
  import { getLeaderDetail, subscribeLiveSlice, type LeaderDetail } from '$lib/api/leader-detail';
  import {
    shortAddress,
    traderName,
    effigyUrl,
    formatPnl,
    formatUsd,
    formatPct,
    formatDuration,
    formatRelativeTime,
    pnlSignClass,
  } from '$lib/utils/format';
  import { coinDisplayName } from '$lib/utils/coin';
  import CoinIcon from '$lib/components/CoinIcon.svelte';
  import MobilePriceChart from '$lib/components/MobilePriceChart.svelte';
  import { appSheet } from '$lib/ui/sheets.svelte';
  import { profileTagClass, profileTagLabel } from '$lib/utils/tags';
  import {
    traderBio,
    TRAIT_EXPLAINERS,
    type HeatTag,
    type ProfileTag,
    type SizeTag,
    type TraitKey,
  } from '@copytrade/shared';

  const address = $derived($page.params['address'] ?? '');

  let detail = $state<LeaderDetail | null>(null);
  let loading = $state(true);
  let errorMsg = $state<string | null>(null);
  let abortCtrl: AbortController | null = null;
  let mounted = false;

  async function load() {
    if (!address) return;
    abortCtrl?.abort();
    abortCtrl = new AbortController();
    loading = true;
    errorMsg = null;
    try {
      detail = await getLeaderDetail(address);
    } catch (err) {
      errorMsg = (err as Error).message || 'Failed to load trader';
    } finally {
      loading = false;
    }
  }

  onMount(() => {
    mounted = true;
    void load();
  });

  onDestroy(() => abortCtrl?.abort());

  $effect(() => {
    if (!mounted) return;
    void address;
    void load();
  });

  // Live positions + fills: subscribe per address and patch `detail` in place
  // as the trader's slice changes. Re-subscribes when the address changes; the
  // returned teardown closes the previous stream.
  $effect(() => {
    const addr = address;
    if (!addr) return;
    return subscribeLiveSlice(addr, (slice) => {
      if (detail) detail = { ...detail, ...slice };
    });
  });

  function copyAddress() {
    if (!address) return;
    void navigator.clipboard?.writeText(address);
  }

  // Crosshair readout for the equity curve: the cumulative PnL value under the
  // pointer and its date. Null when not hovering — heading shows Net PnL then.
  let hovered = $state<{ price: number; time: number } | null>(null);
  function formatHoverDate(seconds: number): string {
    return new Date(seconds * 1000).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
    });
  }

  // ── Traits: bio line + chips, composed from the classifier output the
  //    detail payload already carries. Every input optional — absence means
  //    a dropped clause / missing chip, never a "—".
  const profileTag = $derived((detail?.primary_tag ?? null) as ProfileTag | null);
  const sizeTag = $derived(
    (detail?.tags.find((t) => t.type === 'size')?.value ?? null) as SizeTag | null,
  );
  const heatTag = $derived(
    (detail?.tags.find((t) => t.type === 'heat')?.value ?? null) as HeatTag | null,
  );
  /** Display label of the dominant market — only when one coin truly
   *  dominates lifetime volume (top share ≥ 0.4). */
  const marketLabel = $derived.by(() => {
    const top = detail?.primary_asset_breakdown?.[0];
    return top && top.share >= 0.4 ? coinDisplayName(top.coin) : null;
  });
  const bio = $derived(
    detail
      ? traderBio({
          profile: profileTag,
          size: sizeTag,
          heat: heatTag,
          decay: (detail.scoring?.decay_flag ?? null) as 'green' | 'yellow' | 'red' | null,
          avgHoldSeconds: detail.scoring?.avg_hold_seconds ?? null,
          market: marketLabel,
        })
      : null,
  );
  const cooled = $derived(
    detail?.scoring?.decay_flag === 'yellow' ||
      detail?.scoring?.decay_flag === 'red' ||
      heatTag === 'cooling',
  );
  const traitChips = $derived.by(() => {
    const chips: { trait: TraitKey; label: string; cls: string }[] = [];
    if (profileTag) {
      chips.push({ trait: profileTag, label: profileTagLabel(profileTag), cls: profileTagClass(profileTag) });
    }
    if (sizeTag) chips.push({ trait: sizeTag, label: TRAIT_EXPLAINERS[sizeTag].title, cls: 'tag-neutral' });
    if (marketLabel) chips.push({ trait: 'market', label: marketLabel, cls: 'tag-neutral' });
    if (cooled) chips.push({ trait: 'cooling', label: 'Cooled lately', cls: 'is-cooling' });
    else if (heatTag === 'hot') chips.push({ trait: 'hot', label: 'Hot streak', cls: 'is-hot' });
    return chips;
  });

  /** Collapse the recent fill-by-fill list into one row per coin: total
   *  notional traded, net realized PnL, fill count, and the most recent
   *  fill time. Ordered most-recently-active first. */
  const aggregatedTrades = $derived.by(() => {
    const byCoin = new Map<
      string,
      { coin: string; notional: number; pnl: number; lastMs: number; count: number }
    >();
    for (const f of detail?.recent_fills ?? []) {
      const e =
        byCoin.get(f.coin) ??
        { coin: f.coin, notional: 0, pnl: 0, lastMs: 0, count: 0 };
      e.notional += f.notional ?? 0;
      e.pnl += f.closed_pnl ?? 0;
      e.lastMs = Math.max(e.lastMs, f.block_time_ms);
      e.count += 1;
      byCoin.set(f.coin, e);
    }
    return [...byCoin.values()].sort((a, b) => b.lastMs - a.lastMs);
  });
</script>

<svelte:head>
  <title>{detail ? traderName(detail.display_name, detail.address) : 'Trader'} · Swash</title>
</svelte:head>

<main id="main-content" class="m-page">
  <h1 class="sr-only">Trader detail</h1>

  {#if loading}
    <section class="m-detail-hero safe-x">
      <div class="m-skeleton m-skeleton-avatar"></div>
      <div class="m-skeleton m-skeleton-title"></div>
      <div class="m-skeleton m-skeleton-subtitle"></div>
    </section>
  {:else if errorMsg}
    <div class="m-error safe-x" role="alert">
      <p>{errorMsg}</p>
      <button type="button" class="m-error-retry m-btn tappable" onclick={() => load()}>Retry</button>
    </div>
  {:else if detail}
    <section class="m-detail-hero safe-x">
      <div class="m-detail-top">
      <div class="m-detail-id">
        <img class="m-detail-avatar" src={effigyUrl(detail.address)} alt="" />
        <div class="m-detail-meta">
          <button type="button" class="m-detail-address tappable" onclick={copyAddress} aria-label="Copy address">
            {traderName(detail.display_name, detail.address, 6, 4)}
          </button>
          {#if detail.display_name}
            <span class="m-detail-subaddr">{shortAddress(detail.address, 6, 4)}</span>
          {/if}
        </div>
      </div>
      <!-- Composite score — the same number the leaderboard ranks by; tapping
           opens the plain-language explainer. -->
      <button
        type="button"
        class="m-detail-score tap-hit"
        aria-label={`Score ${detail.score === null ? 'unknown' : Math.round(detail.score)} out of 100 — what does this mean?`}
        onclick={() => appSheet.open('score')}
      >
        <span class="m-detail-score-num">
          <span class="m-detail-score-val">{detail.score === null ? '—' : Math.round(detail.score)}</span>
          <span class="m-detail-score-of">/100</span>
          <svg
            class="m-detail-score-info"
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
        </span>
        <span class="m-detail-score-bars" aria-hidden="true">
          {#each Array(10) as _, i (i)}
            <span
              class="m-detail-score-bar"
              class:is-on={detail.score !== null && i < Math.max(0, Math.min(10, Math.round(detail.score / 10)))}
            ></span>
          {/each}
        </span>
      </button>
      </div>

      {#if bio}
        <p class="m-detail-bio">{bio}</p>
      {/if}
      {#if traitChips.length > 0}
        <div class="m-detail-traits">
          {#each traitChips as c (c.trait)}
            <button
              type="button"
              class="tag-chip m-trait-chip tap-hit {c.cls}"
              onclick={() => appSheet.openTrait(c.trait)}
              aria-label={`${c.label} — what does this mean?`}
            >
              {c.label}
            </button>
          {/each}
        </div>
      {/if}
    </section>

    <!-- Floating Mirror CTA — fixed above the bottom-nav pill so the page's
         primary action sits in the thumb zone. Same insets and radius as the
         nav pill so the two floating chrome pieces read as one system. -->
    <button
      type="button"
      class="m-mirror-fab m-cta-primary"
      onclick={() => appSheet.open('mirror')}
    >
      Mirror this trader
    </button>

    {#if detail.equity_curve.length > 1}
      <section class="m-detail-section m-detail-chart safe-x" aria-label="Profit curve">
        <div class="m-chart-heading">
          <!-- The curve plots cumulative realized PnL, not account value —
               "profit" is both the accurate and the plain-language name. -->
          <h2 class="m-section-title">Profit curve · 90D</h2>
          {#if hovered}
            <div class="m-chart-netpnl {pnlSignClass(hovered.price)}">
              <span class="m-chart-netpnl-label">{formatHoverDate(hovered.time)}</span>
              <span class="m-chart-netpnl-value">{formatPnl(hovered.price)}</span>
            </div>
          {:else}
            <div class="m-chart-netpnl {pnlSignClass(detail.scoring?.net_pnl_usd)}">
              <span class="m-chart-netpnl-label">Net profit</span>
              <span class="m-chart-netpnl-value">{formatPnl(detail.scoring?.net_pnl_usd ?? null)}</span>
            </div>
          {/if}
        </div>
        <MobilePriceChart
          line={detail.equity_curve.map((p) => ({ t: p.ts, value: p.value }))}
          height={200}
          onhover={(h) => (hovered = h)}
        />
      </section>
    {/if}

    <section class="m-detail-stats safe-x" aria-label="Key metrics">
      <div class="m-stat">
        <div class="m-stat-label">Account value</div>
        <div class="m-stat-value">{formatUsd(detail.account_value)}</div>
      </div>
      <div class="m-stat">
        <div class="m-stat-label">Win rate</div>
        <div class="m-stat-value">
          {detail.scoring?.win_rate != null ? formatPct(detail.scoring.win_rate, 0) : '—'}
        </div>
      </div>
      <div class="m-stat">
        <div class="m-stat-label">Trades</div>
        <div class="m-stat-value">{detail.scoring?.total_trades ?? '—'}</div>
      </div>
      <div class="m-stat">
        <div class="m-stat-label">Avg hold</div>
        <div class="m-stat-value">{formatDuration(detail.scoring?.avg_hold_seconds ?? null)}</div>
      </div>
    </section>

    {#if detail.open_positions.length > 0}
      <section class="m-detail-section safe-x">
        <h2 class="m-section-title">Open positions ({detail.open_positions.length})</h2>
        <ul class="m-position-list">
          {#each detail.open_positions.slice(0, 10) as p, i (i + p.coin)}
            <li class="m-position-row">
              <div class="m-position-icon">
                <CoinIcon coin={p.coin} padding="4px" />
              </div>
              <div class="m-position-main">
                <div class="m-position-coin">{coinDisplayName(p.coin)}</div>
                <div class="m-position-side {p.side === 'long' ? 'is-long' : 'is-short'}">
                  {p.side ?? '—'} · {p.leverage ? `${p.leverage}x` : ''}
                </div>
              </div>
              <div class="m-position-stats">
                <div class="m-position-notional">{formatUsd(p.notionalUsd)}</div>
                <div class="m-position-pnl {pnlSignClass(p.unrealizedPnlUsd)}">
                  {formatPnl(p.unrealizedPnlUsd)}
                </div>
              </div>
            </li>
          {/each}
        </ul>
      </section>
    {/if}

    {#if aggregatedTrades.length > 0}
      <section class="m-detail-section safe-x">
        <h2 class="m-section-title">Recent trades · by coin</h2>
        <ul class="m-position-list">
          {#each aggregatedTrades.slice(0, 15) as t (t.coin)}
            <li class="m-position-row">
              <div class="m-position-icon">
                <CoinIcon coin={t.coin} padding="4px" />
              </div>
              <div class="m-position-main">
                <div class="m-position-coin">{coinDisplayName(t.coin)}</div>
                <div class="m-position-side">
                  {t.count} {t.count === 1 ? 'trade' : 'trades'}
                  · {formatRelativeTime(new Date(t.lastMs))}
                </div>
              </div>
              <div class="m-position-stats">
                <div class="m-position-notional">{formatUsd(t.notional)}</div>
                {#if t.pnl !== 0}
                  <div class="m-position-pnl {pnlSignClass(t.pnl)}">
                    {formatPnl(t.pnl)}
                  </div>
                {/if}
              </div>
            </li>
          {/each}
        </ul>
      </section>
    {/if}
  {/if}
</main>

<style>
  .m-page {
    display: flex;
    flex-direction: column;
    min-height: 100vh;
    /* Clearance for bottom nav + the floating Mirror CTA above it. */
    padding-bottom: calc(var(--safe-bottom) + 150px);
  }

  /* Floating Mirror CTA — full-width bar with the nav pill's insets and
     radius (--radius-xl), hovering one gap above it (nav bottom inset =
     safe-bottom + space-3; pill is 56px tall). Below the sheets layer
     (z 100), above the nav edge fade (z 19). */
  .m-mirror-fab {
    position: fixed;
    left: max(var(--safe-left), var(--space-4));
    right: max(var(--safe-right), var(--space-4));
    bottom: calc(var(--safe-bottom) + var(--space-3) + 56px + var(--space-3));
    z-index: 21;
    min-height: 52px;
    border-radius: var(--radius-xl);
  }

  /* Hero: identity row on top, then the plain-language bio + trait chips. */
  .m-detail-hero {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    padding-top: var(--space-3);
    padding-bottom: var(--space-4);
  }

  /* Avatar left, wallet beside it — mirrors the asset-page hero placement.
     The composite score sits on the right edge. */
  .m-detail-top {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
  }

  .m-detail-id {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    min-width: 0;
  }

  .m-detail-avatar {
    width: 56px;
    height: 56px;
    min-width: 56px;
    border-radius: var(--radius-full);
    background: var(--stripe-bg-secondary);
    border: 1.5px solid var(--stripe-border-light);
    box-shadow: var(--glass-shadow);
  }

  .m-detail-meta {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }

  .m-detail-address {
    font-family: var(--font-mono);
    font-size: var(--type-title);
    line-height: 1.15;
    color: var(--stripe-text-primary);
    background: transparent;
    border: none;
    padding: 0;
    text-align: left;
    cursor: pointer;
  }

  /* One-line plain-language read on who this trader is. */
  /* Short address caption under a display name — identity stays verifiable. */
  .m-detail-subaddr {
    font-family: var(--font-mono);
    font-variant-numeric: tabular-nums;
    font-size: var(--type-caption);
    color: var(--stripe-text-tertiary);
  }

  .m-detail-bio {
    margin: 0;
    font-family: var(--font-sans);
    font-size: var(--type-subhead);
    line-height: var(--line-body);
    color: var(--stripe-text-secondary);
  }

  /* Trait chips — every one taps open its explainer sheet. Builds on the
     global .tag-chip look; archetype keeps its tag-* tint, size/market are
     neutral, heat is the one expressive chip. */
  .m-detail-traits {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }
  .m-trait-chip {
    border: 0;
    cursor: pointer;
  }
  .m-trait-chip.is-hot {
    background: var(--stripe-accent-subtle);
    color: var(--stripe-accent);
  }
  .m-trait-chip.is-cooling {
    background: var(--stripe-warning-subtle);
    color: var(--stripe-warning);
  }

  /* Score block — right edge of the hero, tappable → explainer sheet. */
  .m-detail-score {
    flex: 0 0 auto;
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 5px;
    padding: 0;
    border: 0;
    background: transparent;
    cursor: pointer;
    font-family: var(--font-mono);
    font-variant-numeric: tabular-nums;
  }
  .m-detail-score-num {
    display: inline-flex;
    align-items: baseline;
    gap: 3px;
  }
  .m-detail-score-val {
    font-size: var(--type-title);
    font-weight: 700;
    line-height: 1;
    color: var(--stripe-text-primary);
  }
  .m-detail-score-of {
    font-size: var(--type-caption);
    color: var(--stripe-text-tertiary);
  }
  .m-detail-score-info {
    width: 13px;
    height: 13px;
    align-self: center;
    color: var(--stripe-text-tertiary);
  }
  .m-detail-score-bars {
    display: inline-flex;
    gap: 2px;
    align-items: flex-end;
  }
  .m-detail-score-bar {
    display: inline-block;
    width: 3px;
    height: 8px;
    background: var(--stripe-accent-muted);
    border-radius: 1px;
  }
  /* Monochrome accent — green stays reserved for profit/long. */
  .m-detail-score-bar.is-on {
    background: var(--stripe-accent);
  }

  .m-detail-stats {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: var(--space-3);
    padding-top: var(--space-2);
    padding-bottom: var(--space-5);
  }

  .m-stat {
    background: var(--glass-bg);
    -webkit-backdrop-filter: var(--glass-blur);
    backdrop-filter: var(--glass-blur);
    border: 1px solid var(--stripe-border);
    border-radius: var(--radius-md);
    box-shadow: var(--glass-highlight), var(--glass-shadow);
    padding: var(--space-3);
    min-height: 64px;
  }

  .m-stat-label {
    font-family: var(--font-mono);
    font-size: 10px;
    color: var(--stripe-text-tertiary);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  .m-stat-value {
    font-family: var(--font-mono);
    font-variant-numeric: tabular-nums;
    font-size: var(--type-headline);
    color: var(--stripe-text-primary);
    margin-top: 4px;
  }

  .m-stat-value:global(.k-pnl-positive) {
    color: var(--stripe-success);
  }
  .m-stat-value:global(.k-pnl-negative) {
    color: var(--stripe-danger);
  }

  .m-detail-section {
    padding-top: var(--space-4);
    padding-bottom: var(--space-5);
    border-top: 1px solid var(--stripe-border);
  }

  .m-section-title {
    font-family: var(--font-sans);
    font-size: var(--type-body);
    font-weight: 600;
    color: var(--stripe-text-primary);
    margin: 0 0 var(--space-3);
  }

  /* Equity-curve heading row: title left, Net PnL pinned right. */
  .m-chart-heading {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: var(--space-3);
    margin-bottom: var(--space-3);
  }
  .m-chart-heading .m-section-title {
    margin: 0;
  }

  .m-chart-netpnl {
    display: flex;
    align-items: baseline;
    gap: var(--space-2);
    font-family: var(--font-mono);
    font-variant-numeric: tabular-nums;
  }
  .m-chart-netpnl-label {
    font-size: 10px;
    color: var(--stripe-text-tertiary);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .m-chart-netpnl-value {
    font-size: var(--type-headline);
    color: var(--stripe-text-primary);
    font-weight: 600;
  }
  .m-chart-netpnl:global(.k-pnl-positive) .m-chart-netpnl-value {
    color: var(--stripe-success);
  }
  .m-chart-netpnl:global(.k-pnl-negative) .m-chart-netpnl-value {
    color: var(--stripe-danger);
  }

  .m-position-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    background: var(--glass-bg);
    -webkit-backdrop-filter: var(--glass-blur);
    backdrop-filter: var(--glass-blur);
    border: 1px solid var(--stripe-border);
    border-radius: var(--radius-lg);
    box-shadow: var(--glass-highlight), var(--glass-shadow);
    overflow: hidden;
  }
  .m-position-list > li + li {
    border-top: 1px solid var(--stripe-border);
  }

  .m-position-row {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-3) var(--space-4);
    min-height: var(--touch-comfortable);
  }

  .m-position-icon {
    flex: 0 0 32px;
    width: 32px;
    height: 32px;
    border-radius: var(--radius-full);
    background: var(--stripe-bg-secondary);
    box-shadow: var(--glass-shadow);
    overflow: hidden;
  }

  .m-position-main {
    flex: 1 1 auto;
    min-width: 0;
  }

  .m-position-coin {
    font-family: var(--font-mono);
    font-size: var(--type-body);
    color: var(--stripe-text-primary);
  }

  .m-position-side {
    font-family: var(--font-mono);
    font-size: var(--type-caption);
    color: var(--stripe-text-tertiary);
    text-transform: capitalize;
  }
  .m-position-side.is-long {
    color: var(--stripe-success);
  }
  .m-position-side.is-short {
    color: var(--stripe-danger);
  }

  .m-position-stats {
    flex: 0 0 auto;
    text-align: right;
    font-family: var(--font-mono);
    font-variant-numeric: tabular-nums;
  }

  .m-position-notional {
    font-size: var(--type-subhead);
    color: var(--stripe-text-primary);
  }

  .m-position-pnl {
    font-size: var(--type-caption);
    color: var(--stripe-text-tertiary);
    margin-top: 2px;
  }
  .m-position-pnl:global(.k-pnl-positive) {
    color: var(--stripe-success);
  }
  .m-position-pnl:global(.k-pnl-negative) {
    color: var(--stripe-danger);
  }

  .m-skeleton-avatar {
    width: 72px;
    height: 72px;
    border-radius: var(--radius-full);
  }
  .m-skeleton-title {
    width: 160px;
    height: 22px;
    margin-top: var(--space-2);
  }
  .m-skeleton-subtitle {
    width: 100px;
    height: 14px;
    margin-top: var(--space-1);
  }

  /* Error/empty states come from the shared layer in lib/styles/mobile.css. */
</style>
