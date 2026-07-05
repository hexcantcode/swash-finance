<script lang="ts">
  // Vault detail (data stage): current call, positioning-over-time, the paper
  // vault-vs-hold comparison, and the traders driving it. No invest contracts.
  // UI mirrors the asset page: mono hero, uppercase section labels, bordered rows.
  import { onMount } from 'svelte';
  import { page } from '$app/stores';
  import { getVaultDetail, type VaultDetail } from '$lib/api/vaults';
  import { coinDisplayName, coinIconUrl, coinIconBg } from '$lib/utils/coin';
  import { effigyUrl, shortAddress, formatUsd } from '$lib/utils/format';

  const coin = $derived($page.params['asset'] ?? '');
  let detail = $state<VaultDetail | null>(null);
  let loading = $state(true);
  let errorMsg = $state<string | null>(null);

  onMount(async () => {
    try {
      detail = await getVaultDetail(coin);
      if (!detail) errorMsg = `No vault for “${coin}”.`;
    } catch (err) {
      errorMsg = (err as Error).message || 'Failed to load vault';
    } finally {
      loading = false;
    }
  });

  const s = $derived(detail?.summary ?? null);
  const dir = $derived(s?.direction ?? 'flat');
  // Allocation: |skew| of NAV is deployed in the position, the rest idles in USDC.
  const openPct = $derived(dir === 'flat' || s?.skew == null ? 0 : Math.round(Math.abs(s.skew) * 100));

  const W = 320;
  const H = 72;
  const skewPath = $derived.by(() => {
    const h = detail?.skewHistory ?? [];
    if (h.length < 2) return '';
    return h
      .map((p, i) => `${i === 0 ? 'M' : 'L'}${((i / (h.length - 1)) * W).toFixed(1)} ${((1 - (p.skew + 1) / 2) * H).toFixed(1)}`)
      .join(' ');
  });

  // 24h positioning change in percentage points (skew is already ±100%-scaled);
  // + = moved toward long, − = toward short. Null until 24h of history exists.
  const skewDelta24h = $derived.by(() => {
    const h = detail?.skewHistory ?? [];
    if (h.length < 2) return null;
    const latest = h[h.length - 1]!;
    const target = latest.ts - 24 * 3600 * 1000;
    if (h[0]!.ts > target) return null;
    let ref = h[0]!;
    for (const p of h) {
      if (p.ts <= target) ref = p;
      else break;
    }
    return (latest.skew - ref.skew) * 100;
  });

  const NAV_GATE = 3;
  const navChart = $derived.by(() => {
    const h = detail?.navHistory ?? [];
    if (h.length < NAV_GATE) return null;
    const all = h.flatMap((p) => [p.vaultNav, p.assetNav]);
    const lo = Math.min(...all);
    const rng = Math.max(...all) - lo || 1;
    const line = (key: 'vaultNav' | 'assetNav') =>
      h.map((p, i) => `${i === 0 ? 'M' : 'L'}${((i / (h.length - 1)) * W).toFixed(1)} ${((1 - (p[key] - lo) / rng) * H).toFixed(1)}`).join(' ');
    const last = h[h.length - 1]!;
    return { vault: line('vaultNav'), asset: line('assetNav'), vaultLast: last.vaultNav, assetLast: last.assetNav };
  });
</script>

<svelte:head>
  <title>{coinDisplayName(coin)} vault · Swash</title>
</svelte:head>

<main id="main-content" class="m-page">
  {#if loading}
    <div class="m-empty safe-x" aria-busy="true">Loading…</div>
  {:else if errorMsg}
    <div class="m-empty safe-x" role="alert">{errorMsg}</div>
  {:else if detail && s}
    <!-- Hero — asset-page pattern -->
    <section class="m-vhero safe-x">
      <div class="m-vhero-id">
        <span class="m-vhero-icon" style:background-color={coinIconBg(coin)} style:padding={coinIconBg(coin) ? '8px' : null}>
          {#if coinIconUrl(coin)}<img src={coinIconUrl(coin)} alt="" />{/if}
        </span>
        <div class="m-vhero-meta">
          <div class="m-vhero-name">{coinDisplayName(coin)} vault</div>
        </div>
      </div>
      <div class="m-vhero-call is-{dir}">
        <span class="m-vhero-dir">{dir === 'flat' ? 'FLAT' : dir.toUpperCase()}</span>
      </div>
    </section>
    <!-- Allocation bar — open position vs idle USDC, same bar language as the
         asset page's smart-money bar. -->
    <div class="m-valloc safe-x">
      <div class="m-valloc-bar">
        {#if openPct > 0}
          <span class="m-valloc-pos is-{dir}" style:width={`${openPct}%`}></span>
        {/if}
      </div>
      <div class="m-valloc-labels">
        <span class="m-valloc-open is-{dir}">{openPct}% {dir === 'flat' ? 'open' : dir}</span>
        <span class="m-valloc-idle">{100 - openPct}% USD</span>
      </div>
    </div>

    <!-- Positioning over time -->
    <section class="m-vsec safe-x" aria-label="Positioning over time">
      <div class="m-vsec-head">
        <h2 class="m-vsec-h">Positioning over time</h2>
        {#if skewDelta24h !== null}
          <span
            class="m-vskew-delta"
            class:is-long={skewDelta24h > 0}
            class:is-short={skewDelta24h < 0}
            title="Positioning change over the last 24h"
          >
            {skewDelta24h > 0 ? '+' : ''}{skewDelta24h.toFixed(0)}%
            <span class="m-vskew-delta-t">24h</span>
          </span>
        {/if}
      </div>
      {#if skewPath}
        <span class="m-vchart-lab is-long">Long</span>
        <svg class="m-vchart" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true">
            <defs>
              <!-- Vertical long→short gradient in chart space: the line is green
                   while positioned long (top), red while short (bottom). -->
              <linearGradient id="skew-grad" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="0" y2={H}>
                <!-- Full color outside the near-flat band; neutral only at the midline. -->
                <stop offset="0" class="m-vgrad-long" />
                <stop offset="0.35" class="m-vgrad-long" />
                <stop offset="0.5" class="m-vgrad-mid" />
                <stop offset="0.65" class="m-vgrad-short" />
                <stop offset="1" class="m-vgrad-short" />
              </linearGradient>
            </defs>
            <line x1="0" y1={H / 2} x2={W} y2={H / 2} class="m-vchart-zero" />
            <path d={skewPath} class="m-vchart-line" stroke="url(#skew-grad)" fill="none" />
        </svg>
        <span class="m-vchart-lab is-short">Short</span>
      {:else}
        <p class="m-vsec-note">Builds as snapshots accrue — every 30 minutes.</p>
      {/if}
    </section>

    <!-- Vault vs. holding -->
    <section class="m-vsec safe-x" aria-label="Vault versus holding the asset">
      <div class="m-vsec-head">
        <h2 class="m-vsec-h">Vault vs. holding {coinDisplayName(coin)}</h2>
        {#if navChart}
          <div class="m-vchart-legend">
            <span class="is-vault">Vault {navChart.vaultLast.toFixed(1)}</span>
            <span class="is-asset">Hold {navChart.assetLast.toFixed(1)}</span>
          </div>
        {/if}
      </div>
      {#if navChart}
        <svg class="m-vchart" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true">
          <path d={navChart.asset} class="m-vchart-asset" fill="none" />
          <path d={navChart.vault} class="m-vchart-vault" fill="none" />
        </svg>
      {:else}
        <p class="m-vsec-note">The vault-vs-hold comparison builds as history accrues.</p>
      {/if}
    </section>

    <!-- Who's driving it — rows, asset-page pattern -->
    <section class="m-vsec safe-x" aria-label="Contributing traders">
      <h2 class="m-vsec-h">Who's driving it</h2>
      <ul class="m-vrows">
        {#each detail.contributors as c (c.address)}
          <li class="m-vrow">
            <img class="m-vrow-avatar" src={effigyUrl(c.address)} alt="" loading="lazy" />
            <div class="m-vrow-copy">
              <span class="m-vrow-name">{c.displayName || shortAddress(c.address, 4, 4)}</span>
              <span class="m-vrow-sub">{(c.convictionPct / 100).toFixed(1)}× book · {formatUsd(c.notionalUsd)}</span>
            </div>
            <span class="m-vrow-side is-{c.direction}">{c.direction}</span>
          </li>
        {/each}
      </ul>
    </section>

    <!-- Methodology -->
    <section class="m-vsec safe-x">
      <p class="m-vmethod">
        Follows the Extremely-Profitable cohort's net positioning on {coinDisplayName(coin)}, weighted by
        each trader's skill and how much of their own book they've committed — at 1×, no leverage.
      </p>
    </section>

    <!-- Floating Deposit CTA — fixed above the bottom-nav pill, same insets and
         radius as the trader page's Mirror FAB so the floating chrome reads as
         one system. Polished placeholder: no contracts wired yet. -->
    <button type="button" class="m-vdeposit-fab m-cta-primary">Deposit</button>
  {/if}
</main>

<style>
  .m-page {
    display: flex;
    flex-direction: column;
    min-height: 100vh;
    padding-top: var(--space-3);
    /* Clearance for the floating Deposit FAB + nav pill (matches trader page). */
    padding-bottom: calc(var(--safe-bottom) + 150px);
  }

  /* Hero — mirrors .m-asset-hero */
  .m-vhero {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: var(--space-3);
    padding-bottom: var(--space-4);
  }
  .m-vhero-id {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    min-width: 0;
  }
  .m-vhero-icon {
    width: 56px;
    height: 56px;
    min-width: 56px;
    border-radius: var(--radius-full);
    background: var(--stripe-bg-secondary);
    box-shadow: var(--glass-shadow);
    overflow: hidden;
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }
  .m-vhero-icon img { width: 100%; height: 100%; object-fit: contain; }
  .m-vhero-meta { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
  .m-vhero-name {
    font-family: var(--font-mono);
    font-size: var(--type-headline);
    line-height: 1.15;
    color: var(--stripe-text-primary);
  }
  .m-vhero-call { display: flex; flex-direction: column; align-items: flex-end; gap: 2px; font-family: var(--font-mono); }
  .m-vhero-dir { font-size: var(--type-callout); font-weight: 700; letter-spacing: 0.04em; }
  .m-vhero-call.is-long .m-vhero-dir { color: var(--stripe-success); }
  .m-vhero-call.is-short .m-vhero-dir { color: var(--stripe-danger); }
  .m-vhero-call.is-flat .m-vhero-dir { color: var(--stripe-text-tertiary); }
  /* Allocation bar — open position vs idle USDC (asset-page bar language). */
  .m-valloc { margin-bottom: var(--space-8); }
  .m-valloc-bar {
    display: flex;
    height: 8px;
    border-radius: var(--radius-full);
    overflow: hidden;
    background: var(--stripe-bg-secondary);
  }
  .m-valloc-pos.is-long { background: var(--stripe-success); }
  .m-valloc-pos.is-short { background: var(--stripe-danger); }
  .m-valloc-labels {
    display: flex;
    justify-content: space-between;
    margin-top: var(--space-1);
    font-family: var(--font-mono);
    font-size: var(--type-caption);
    font-variant-numeric: tabular-nums;
  }
  .m-valloc-open { text-transform: uppercase; letter-spacing: 0.04em; color: var(--stripe-text-tertiary); }
  .m-valloc-open.is-long { color: var(--stripe-success); }
  .m-valloc-open.is-short { color: var(--stripe-danger); }
  .m-valloc-idle { color: var(--stripe-text-tertiary); }

  /* Sections — uppercase label like .m-sent-head */
  .m-vsec { margin-bottom: var(--space-8); }
  .m-vsec-h {
    margin: 0 0 var(--space-2);
    font-family: var(--font-sans);
    font-size: var(--type-footnote);
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--stripe-text-secondary);
  }
  .m-vsec-note { margin: 0; font-size: var(--type-footnote); color: var(--stripe-text-tertiary); }
  .m-vsec-head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: var(--space-2);
    margin-bottom: var(--space-2);
  }
  .m-vsec-head .m-vsec-h { margin: 0; }
  .m-vskew-delta {
    font-family: var(--font-mono);
    font-size: var(--type-footnote);
    font-variant-numeric: tabular-nums;
    color: var(--stripe-text-tertiary);
  }
  .m-vskew-delta.is-long { color: var(--stripe-success); }
  .m-vskew-delta.is-short { color: var(--stripe-danger); }
  .m-vskew-delta-t { color: var(--stripe-text-tertiary); }

  /* Charts */
  .m-vchart { width: 100%; height: 72px; display: block; }
  .m-vchart-zero { stroke: var(--stripe-border); stroke-width: 1; stroke-dasharray: 3 3; }
  .m-vchart-line { stroke-width: 2; }
  /* Long→short vertical gradient stops (green top, red bottom, neutral mid). */
  .m-vgrad-long { stop-color: var(--stripe-success); }
  .m-vgrad-mid { stop-color: var(--stripe-text-tertiary); }
  .m-vgrad-short { stop-color: var(--stripe-danger); }
  /* Long above / Short below the chart — outside the plot so the line never
     collides with the labels. */
  .m-vchart-lab {
    display: block;
    font-family: var(--font-mono);
    font-size: var(--type-caption);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .m-vchart-lab.is-long { margin-bottom: 2px; color: var(--stripe-success); }
  .m-vchart-lab.is-short { margin-top: 2px; color: var(--stripe-danger); }
  .m-vchart-vault { stroke: var(--stripe-success); stroke-width: 2; }
  .m-vchart-asset { stroke: var(--stripe-accent); stroke-width: 1.5; }
  .m-vchart-legend {
    display: flex;
    justify-content: space-between;
    margin-top: 2px;
    font-family: var(--font-mono);
    font-size: var(--type-caption);
    color: var(--stripe-text-tertiary);
  }
  .m-vchart-legend { justify-content: flex-start; gap: var(--space-3); font-variant-numeric: tabular-nums; }
  .m-vchart-legend .is-vault { color: var(--stripe-success); }
  .m-vchart-legend .is-asset { color: var(--stripe-accent); }

  /* Contributor rows — mirror .m-trader-row */
  /* Contributor rows are glass cards, matching the app-wide .m-card-list /
     .m-feed-row row system (same as the vaults list page). */
  .m-vrows {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }
  .m-vrow {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    min-height: var(--touch-comfortable);
    padding: var(--space-3) var(--space-4);
    background: var(--glass-bg);
    border-radius: var(--radius-md);
  }
  .m-vrow-avatar { width: 32px; height: 32px; flex: 0 0 32px; border-radius: var(--radius-full); background: var(--stripe-bg-secondary); }
  .m-vrow-copy { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
  .m-vrow-name { font-family: var(--font-mono); font-size: var(--type-body); font-weight: 500; color: var(--stripe-text-primary); }
  .m-vrow-sub { font-family: var(--font-mono); font-size: var(--type-caption); color: var(--stripe-text-tertiary); }
  .m-vrow-side {
    flex: 0 0 auto;
    font-family: var(--font-mono);
    font-size: var(--type-caption);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .m-vrow-side.is-long { color: var(--stripe-success); }
  .m-vrow-side.is-short { color: var(--stripe-danger); }

  .m-vmethod { margin: 0; font-size: var(--type-footnote); line-height: 1.6; color: var(--stripe-text-secondary); }
  .m-vdeposit-fab {
    position: fixed;
    left: max(var(--safe-left), var(--space-4));
    right: max(var(--safe-right), var(--space-4));
    bottom: calc(var(--safe-bottom) + var(--space-3) + 56px + var(--space-3));
    z-index: 21;
    min-height: 52px;
    border-radius: var(--radius-xl);
  }

</style>
