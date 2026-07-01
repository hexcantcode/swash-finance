<script lang="ts">
  // Vaults — live showcase (data stage): each vault's current positioning, what
  // it would hold, and the breadth behind it. No invest contracts yet.
  // See docs/plans/2026-07-01-vaults-showcase-design.md.
  import { onMount } from 'svelte';
  import { getVaults, type VaultSummary } from '$lib/api/vaults';
  import { coinDisplayName, coinIconUrl, coinIconBg } from '$lib/utils/coin';

  let vaults = $state<VaultSummary[]>([]);
  let loading = $state(true);
  let errorMsg = $state<string | null>(null);

  onMount(async () => {
    try {
      vaults = await getVaults();
    } catch (err) {
      errorMsg = (err as Error).message || 'Failed to load vaults';
    } finally {
      loading = false;
    }
  });

  /** Concrete position a $1,000 vault would hold: |skew| × 1000, signed by direction. */
  function heldLine(v: VaultSummary): string {
    if (v.direction === 'flat' || v.skew === null) return 'In cash — no clear lean';
    const amt = Math.round(Math.abs(v.skew) * 1000);
    return `$${amt.toLocaleString('en-US')} ${v.direction} per $1,000`;
  }
  function skewPct(v: VaultSummary): string {
    return v.skew === null ? '—' : `${Math.round(Math.abs(v.skew) * 100)}%`;
  }
</script>

<svelte:head>
  <title>Vaults · Swash</title>
</svelte:head>

<main id="main-content" class="m-page">
  <header class="m-vaults-head safe-x">
    <h1 class="m-vaults-h1">Vaults</h1>
    <span class="m-vaults-badge">Live preview · paper</span>
  </header>
  <p class="m-vaults-intro safe-x">
    Each vault follows the smart money on one market — long or short, sized to how convinced
    they are. Here's what they'd be holding right now.
  </p>

  {#if loading}
    <ul class="m-card-list" aria-busy="true">
      {#each Array(8) as _, i (i)}
        <li class="m-skeleton-row">
          <span class="m-skeleton m-skeleton-avatar"></span>
          <span class="m-skeleton-main">
            <span class="m-skeleton m-skeleton-line"></span>
            <span class="m-skeleton m-skeleton-line-sm"></span>
          </span>
        </li>
      {/each}
    </ul>
  {:else if errorMsg}
    <div class="m-empty safe-x" role="alert">{errorMsg}</div>
  {:else if vaults.length === 0}
    <div class="m-empty safe-x">No vaults to show yet.</div>
  {:else}
    <ul class="m-vault-list safe-x">
      {#each vaults as v (v.coin)}
        <li>
          <a class="m-vault-row tappable-row" href={`/vaults/${encodeURIComponent(v.coin)}`}>
            <span class="m-vault-icon" style:background-color={coinIconBg(v.coin)} style:padding={coinIconBg(v.coin) ? '4px' : null}>
              {#if coinIconUrl(v.coin)}
                <img src={coinIconUrl(v.coin)} alt="" loading="lazy" />
              {/if}
            </span>
            <div class="m-vault-copy">
              <span class="m-vault-name">{coinDisplayName(v.coin)}</span>
              <span class="m-vault-sub">{heldLine(v)} · {v.contributors ?? v.traders} pros</span>
            </div>
            <div class="m-vault-call is-{v.direction}">
              <span class="m-vault-dir">{v.direction === 'flat' ? 'FLAT' : v.direction.toUpperCase()}</span>
              {#if v.direction !== 'flat'}
                <span class="m-vault-skew">{skewPct(v)}</span>
              {/if}
            </div>
          </a>
        </li>
      {/each}
    </ul>
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

  .m-vaults-head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: var(--space-2);
    margin-bottom: var(--space-1);
  }
  .m-vaults-h1 {
    margin: 0;
    font-family: var(--font-sans);
    font-size: var(--type-title);
    font-weight: 700;
    color: var(--stripe-text-primary);
  }
  .m-vaults-badge {
    font-family: var(--font-mono);
    font-size: var(--type-caption);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--stripe-accent);
    white-space: nowrap;
  }
  .m-vaults-intro {
    margin: 0 0 var(--space-3);
    font-size: var(--type-footnote);
    line-height: 1.5;
    color: var(--stripe-text-secondary);
  }

  .m-vault-list {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .m-vault-row {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    min-height: var(--touch-comfortable);
    padding: var(--space-2) var(--space-1);
    color: inherit;
    text-decoration: none;
    border-bottom: 1px solid var(--stripe-border);
  }
  .m-vault-row:last-child {
    border-bottom: none;
  }
  .m-vault-icon {
    flex: 0 0 32px;
    width: 32px;
    height: 32px;
    border-radius: var(--radius-full);
    overflow: hidden;
    background: var(--stripe-bg-secondary);
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }
  .m-vault-icon img {
    width: 100%;
    height: 100%;
    object-fit: contain;
  }
  .m-vault-copy {
    flex: 1 1 auto;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .m-vault-name {
    font-family: var(--font-sans);
    font-size: var(--type-callout);
    font-weight: 600;
    color: var(--stripe-text-primary);
  }
  .m-vault-sub {
    font-family: var(--font-mono);
    font-size: var(--type-footnote);
    color: var(--stripe-text-secondary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .m-vault-call {
    flex: 0 0 auto;
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 2px;
    font-family: var(--font-mono);
  }
  .m-vault-dir {
    font-size: var(--type-footnote);
    font-weight: 700;
    letter-spacing: 0.04em;
  }
  .m-vault-skew {
    font-size: var(--type-caption);
    color: var(--stripe-text-tertiary);
    font-variant-numeric: tabular-nums;
  }
  .m-vault-call.is-long .m-vault-dir {
    color: var(--stripe-success);
  }
  .m-vault-call.is-short .m-vault-dir {
    color: var(--stripe-danger);
  }
  .m-vault-call.is-flat .m-vault-dir {
    color: var(--stripe-text-tertiary);
  }
</style>
