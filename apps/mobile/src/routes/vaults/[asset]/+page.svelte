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
  const heldLine = $derived(
    !s || dir === 'flat' || s.skew === null
      ? 'In cash — no clear lean'
      : `$${Math.round(Math.abs(s.skew) * 1000).toLocaleString('en-US')} ${dir} per $1,000`,
  );

  const W = 320;
  const H = 72;
  const skewPath = $derived.by(() => {
    const h = detail?.skewHistory ?? [];
    if (h.length < 2) return '';
    return h
      .map((p, i) => `${i === 0 ? 'M' : 'L'}${((i / (h.length - 1)) * W).toFixed(1)} ${((1 - (p.skew + 1) / 2) * H).toFixed(1)}`)
      .join(' ');
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
          <div class="m-vhero-tag">Live preview · paper</div>
        </div>
      </div>
      <div class="m-vhero-call is-{dir}">
        <span class="m-vhero-dir">{dir === 'flat' ? 'FLAT' : dir.toUpperCase()}</span>
        {#if dir !== 'flat' && s.skew !== null}
          <span class="m-vhero-skew">{Math.round(Math.abs(s.skew) * 100)}%</span>
        {/if}
      </div>
    </section>
    <p class="m-vhero-held safe-x">{heldLine} · {s.contributors ?? s.traders} pro traders</p>

    <!-- Positioning over time -->
    <section class="m-vsec safe-x" aria-label="Positioning over time">
      <h2 class="m-vsec-h">Positioning over time</h2>
      {#if skewPath}
        <svg class="m-vchart" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true">
          <line x1="0" y1={H / 2} x2={W} y2={H / 2} class="m-vchart-zero" />
          <path d={skewPath} class="m-vchart-line is-{dir}" fill="none" />
        </svg>
        <div class="m-vchart-axis"><span>long</span><span>short</span></div>
      {:else}
        <p class="m-vsec-note">Builds as snapshots accrue — every 30 minutes.</p>
      {/if}
    </section>

    <!-- Vault vs. holding -->
    <section class="m-vsec safe-x" aria-label="Vault versus holding the asset">
      <h2 class="m-vsec-h">Vault vs. holding {coinDisplayName(coin)}</h2>
      {#if navChart}
        <svg class="m-vchart" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true">
          <path d={navChart.asset} class="m-vchart-asset" fill="none" />
          <path d={navChart.vault} class="m-vchart-vault" fill="none" />
        </svg>
        <div class="m-vchart-legend">
          <span class="is-vault">Vault {navChart.vaultLast.toFixed(1)}</span>
          <span class="is-asset">Hold {navChart.assetLast.toFixed(1)}</span>
        </div>
        <p class="m-vsec-note">Paper, base 100 since inception · observed, not a validated result.</p>
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

    <div class="m-vcta safe-x">Deposits coming soon</div>
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

  /* Hero — mirrors .m-asset-hero */
  .m-vhero {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: var(--space-3);
    padding-bottom: var(--space-2);
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
  .m-vhero-tag {
    font-family: var(--font-mono);
    font-size: var(--type-footnote);
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--stripe-text-tertiary);
  }
  .m-vhero-call { display: flex; flex-direction: column; align-items: flex-end; gap: 2px; font-family: var(--font-mono); }
  .m-vhero-dir { font-size: var(--type-callout); font-weight: 700; letter-spacing: 0.04em; }
  .m-vhero-skew { font-size: var(--type-footnote); color: var(--stripe-text-tertiary); font-variant-numeric: tabular-nums; }
  .m-vhero-call.is-long .m-vhero-dir { color: var(--stripe-success); }
  .m-vhero-call.is-short .m-vhero-dir { color: var(--stripe-danger); }
  .m-vhero-call.is-flat .m-vhero-dir { color: var(--stripe-text-tertiary); }
  .m-vhero-held {
    margin: 0 0 var(--space-5);
    font-family: var(--font-mono);
    font-size: var(--type-footnote);
    color: var(--stripe-text-secondary);
  }

  /* Sections — uppercase label like .m-sent-head */
  .m-vsec { margin-bottom: var(--space-5); }
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

  /* Charts */
  .m-vchart { width: 100%; height: 72px; display: block; }
  .m-vchart-zero { stroke: var(--stripe-border); stroke-width: 1; stroke-dasharray: 3 3; }
  .m-vchart-line { stroke-width: 2; }
  .m-vchart-line.is-long { stroke: var(--stripe-success); }
  .m-vchart-line.is-short { stroke: var(--stripe-danger); }
  .m-vchart-line.is-flat { stroke: var(--stripe-text-tertiary); }
  .m-vchart-vault { stroke: var(--stripe-accent); stroke-width: 2; }
  .m-vchart-asset { stroke: var(--stripe-text-tertiary); stroke-width: 1.5; stroke-dasharray: 4 3; }
  .m-vchart-axis,
  .m-vchart-legend {
    display: flex;
    justify-content: space-between;
    margin-top: 2px;
    font-family: var(--font-mono);
    font-size: var(--type-caption);
    color: var(--stripe-text-tertiary);
  }
  .m-vchart-legend { justify-content: flex-start; gap: var(--space-3); font-variant-numeric: tabular-nums; }
  .m-vchart-legend .is-vault { color: var(--stripe-accent); }
  .m-vchart-legend .is-asset { color: var(--stripe-text-tertiary); }

  /* Contributor rows — mirror .m-trader-row */
  .m-vrows { list-style: none; margin: 0; padding: 0; }
  .m-vrow {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    min-height: var(--touch-comfortable);
    padding: var(--space-2) var(--space-1);
    border-bottom: 1px solid var(--stripe-border);
  }
  .m-vrow:last-child { border-bottom: none; }
  .m-vrow-avatar { width: 32px; height: 32px; flex: 0 0 32px; border-radius: var(--radius-full); background: var(--stripe-bg-secondary); }
  .m-vrow-copy { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
  .m-vrow-name { font-family: var(--font-mono); font-size: var(--type-footnote); color: var(--stripe-text-primary); }
  .m-vrow-sub { font-size: var(--type-caption); color: var(--stripe-text-tertiary); }
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
  .m-vcta {
    margin: 0 max(var(--safe-left), var(--space-4));
    padding: var(--space-3);
    text-align: center;
    font-family: var(--font-mono);
    font-size: var(--type-footnote);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--stripe-text-tertiary);
    border: 1px dashed var(--stripe-border);
    border-radius: var(--radius-lg);
  }
</style>
