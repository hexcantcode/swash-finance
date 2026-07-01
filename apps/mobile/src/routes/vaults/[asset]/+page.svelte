<script lang="ts">
  // Vault detail (data stage): current call, skew-over-time (the positioning
  // track record), and the traders driving it. No invest contracts.
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
  const heldLine = $derived(
    !s || dir === 'flat' || s.skew === null
      ? 'In cash — no clear lean'
      : `$${Math.round(Math.abs(s.skew) * 1000).toLocaleString('en-US')} ${dir} per $1,000`,
  );

  // Skew sparkline geometry: skew ∈ [-1,+1] → y (top = +1 long, bottom = −1 short).
  const W = 320;
  const H = 72;
  const skewPath = $derived.by(() => {
    const h = detail?.skewHistory ?? [];
    if (h.length < 2) return '';
    return h
      .map((p, i) => {
        const x = (i / (h.length - 1)) * W;
        const y = (1 - (p.skew + 1) / 2) * H;
        return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`;
      })
      .join(' ');
  });

  // Vault-vs-asset comparison (paper NAV, both indexed to 100). Gated on some history.
  const NAV_GATE = 3;
  const navChart = $derived.by(() => {
    const h = detail?.navHistory ?? [];
    if (h.length < NAV_GATE) return null;
    const all = h.flatMap((p) => [p.vaultNav, p.assetNav]);
    const lo = Math.min(...all);
    const rng = Math.max(...all) - lo || 1;
    const line = (key: 'vaultNav' | 'assetNav') =>
      h
        .map((p, i) => {
          const x = (i / (h.length - 1)) * W;
          const y = (1 - (p[key] - lo) / rng) * H;
          return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`;
        })
        .join(' ');
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
    <!-- Hero -->
    <section class="m-vd-hero safe-x">
      <span class="m-vd-icon" style:background-color={coinIconBg(coin)} style:padding={coinIconBg(coin) ? '5px' : null}>
        {#if coinIconUrl(coin)}<img src={coinIconUrl(coin)} alt="" />{/if}
      </span>
      <div class="m-vd-id">
        <h1 class="m-vd-name">{coinDisplayName(coin)} vault</h1>
        <span class="m-vd-badge">Live preview · paper</span>
      </div>
      <div class="m-vd-call is-{dir}">
        <span class="m-vd-dir">{dir === 'flat' ? 'FLAT' : dir.toUpperCase()}</span>
        {#if dir !== 'flat' && s.skew !== null}
          <span class="m-vd-skew">{Math.round(Math.abs(s.skew) * 100)}%</span>
        {/if}
      </div>
    </section>
    <p class="m-vd-held safe-x">{heldLine} · {s.contributors ?? s.traders} pro traders</p>

    <!-- Skew over time = the positioning track record -->
    <section class="m-vd-section safe-x">
      <h2 class="m-vd-h2">Positioning over time</h2>
      {#if skewPath}
        <svg class="m-vd-chart" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true">
          <line x1="0" y1={H / 2} x2={W} y2={H / 2} class="m-vd-zero" />
          <path d={skewPath} class="m-vd-line is-{dir}" fill="none" />
        </svg>
        <div class="m-vd-axis"><span>long</span><span>short</span></div>
      {:else}
        <p class="m-vd-thin">Track builds as snapshots accrue (every 30 min).</p>
      {/if}
    </section>

    <!-- Vault vs. holding the asset (paper NAV) -->
    <section class="m-vd-section safe-x">
      <h2 class="m-vd-h2">Vault vs. holding {coinDisplayName(coin)}</h2>
      {#if navChart}
        <svg class="m-vd-chart" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true">
          <path d={navChart.asset} class="m-vd-nav-asset" fill="none" />
          <path d={navChart.vault} class="m-vd-nav-vault" fill="none" />
        </svg>
        <div class="m-vd-legend">
          <span class="m-vd-leg is-vault">Vault {navChart.vaultLast.toFixed(1)}</span>
          <span class="m-vd-leg is-asset">Hold {navChart.assetLast.toFixed(1)}</span>
        </div>
        <p class="m-vd-thin">Paper · since inception, base 100 · observed, not a validated result.</p>
      {:else}
        <p class="m-vd-thin">The vault-vs-hold comparison builds as history accrues.</p>
      {/if}
    </section>

    <!-- Who's driving it -->
    <section class="m-vd-section safe-x">
      <h2 class="m-vd-h2">Who's driving it</h2>
      <ul class="m-vd-traders">
        {#each detail.contributors as c (c.address)}
          <li class="m-vd-trader">
            <img class="m-vd-avatar" src={effigyUrl(c.address)} alt="" loading="lazy" />
            <div class="m-vd-tmain">
              <span class="m-vd-taddr">{c.displayName || shortAddress(c.address, 4, 4)}</span>
              <span class="m-vd-tconv">{(c.convictionPct / 100).toFixed(1)}× book · {formatUsd(c.notionalUsd)}</span>
            </div>
            <span class="m-vd-tside is-{c.direction}">{c.direction}</span>
          </li>
        {/each}
      </ul>
    </section>

    <!-- Methodology -->
    <section class="m-vd-section safe-x">
      <p class="m-vd-method">
        The vault follows the Extremely-Profitable cohort's net positioning on {coinDisplayName(coin)},
        weighted by each trader's skill and how much of their own book they've committed — at 1×, no
        leverage. It's a live preview; deposits are not open yet.
      </p>
    </section>

    <div class="m-vd-cta safe-x">Deposits coming soon</div>
  {/if}
</main>

<style>
  .m-page {
    display: flex;
    flex-direction: column;
    min-height: 100vh;
    padding-top: var(--space-3);
    padding-bottom: calc(var(--safe-bottom) + 80px);
  }

  .m-vd-hero {
    display: flex;
    align-items: center;
    gap: var(--space-3);
  }
  .m-vd-icon {
    flex: 0 0 auto;
    width: 44px;
    height: 44px;
    border-radius: var(--radius-full);
    overflow: hidden;
    background: var(--stripe-bg-secondary);
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }
  .m-vd-icon img { width: 100%; height: 100%; object-fit: contain; }
  .m-vd-id { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
  .m-vd-name {
    margin: 0;
    font-family: var(--font-sans);
    font-size: var(--type-headline);
    font-weight: 700;
    color: var(--stripe-text-primary);
  }
  .m-vd-badge {
    font-family: var(--font-mono);
    font-size: var(--type-caption);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--stripe-accent);
  }
  .m-vd-call { display: flex; flex-direction: column; align-items: flex-end; font-family: var(--font-mono); }
  .m-vd-dir { font-size: var(--type-callout); font-weight: 700; letter-spacing: 0.04em; }
  .m-vd-skew { font-size: var(--type-footnote); color: var(--stripe-text-tertiary); }
  .m-vd-call.is-long .m-vd-dir { color: var(--stripe-success); }
  .m-vd-call.is-short .m-vd-dir { color: var(--stripe-danger); }
  .m-vd-call.is-flat .m-vd-dir { color: var(--stripe-text-tertiary); }
  .m-vd-held {
    margin: var(--space-2) 0 var(--space-4);
    font-family: var(--font-mono);
    font-size: var(--type-footnote);
    color: var(--stripe-text-secondary);
  }

  .m-vd-section { margin-bottom: var(--space-5); }
  .m-vd-h2 {
    margin: 0 0 var(--space-2);
    font-family: var(--font-sans);
    font-size: var(--type-footnote);
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--stripe-text-secondary);
  }
  .m-vd-chart { width: 100%; height: 72px; display: block; }
  .m-vd-zero { stroke: var(--stripe-border); stroke-width: 1; stroke-dasharray: 3 3; }
  .m-vd-line { stroke-width: 2; }
  .m-vd-line.is-long { stroke: var(--stripe-success); }
  .m-vd-line.is-short { stroke: var(--stripe-danger); }
  .m-vd-line.is-flat { stroke: var(--stripe-text-tertiary); }
  .m-vd-axis {
    display: flex;
    justify-content: space-between;
    font-size: var(--type-caption);
    color: var(--stripe-text-tertiary);
    margin-top: 2px;
  }
  .m-vd-thin { font-size: var(--type-footnote); color: var(--stripe-text-tertiary); margin: 0; }

  .m-vd-nav-vault { stroke: var(--stripe-accent); stroke-width: 2; }
  .m-vd-nav-asset { stroke: var(--stripe-text-tertiary); stroke-width: 1.5; stroke-dasharray: 4 3; }
  .m-vd-legend {
    display: flex;
    gap: var(--space-3);
    margin: var(--space-1) 0 2px;
    font-family: var(--font-mono);
    font-size: var(--type-caption);
    font-variant-numeric: tabular-nums;
  }
  .m-vd-leg.is-vault { color: var(--stripe-accent); }
  .m-vd-leg.is-asset { color: var(--stripe-text-tertiary); }

  .m-vd-traders { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: var(--space-2); }
  .m-vd-trader { display: flex; align-items: center; gap: var(--space-3); }
  .m-vd-avatar { width: 30px; height: 30px; border-radius: var(--radius-full); flex: 0 0 auto; }
  .m-vd-tmain { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 1px; }
  .m-vd-taddr { font-family: var(--font-mono); font-size: var(--type-footnote); color: var(--stripe-text-primary); }
  .m-vd-tconv { font-size: var(--type-caption); color: var(--stripe-text-tertiary); }
  .m-vd-tside {
    font-family: var(--font-mono);
    font-size: var(--type-caption);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .m-vd-tside.is-long { color: var(--stripe-success); }
  .m-vd-tside.is-short { color: var(--stripe-danger); }

  .m-vd-method { margin: 0; font-size: var(--type-footnote); line-height: 1.6; color: var(--stripe-text-secondary); }
  .m-vd-cta {
    text-align: center;
    padding: var(--space-3);
    font-family: var(--font-mono);
    font-size: var(--type-footnote);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--stripe-text-tertiary);
    border: 1px dashed var(--stripe-border);
    border-radius: var(--radius-lg);
    margin: 0 max(var(--safe-left), var(--space-4));
  }
</style>
