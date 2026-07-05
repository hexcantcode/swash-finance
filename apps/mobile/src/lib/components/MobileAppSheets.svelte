<script lang="ts">
  import { TRAIT_EXPLAINERS } from '@copytrade/shared';
  import MobileSheet from './MobileSheet.svelte';
  import MobileTradeSheet from './MobileTradeSheet.svelte';
  import { appSheet } from '$lib/ui/sheets.svelte';

  const trait = $derived(appSheet.trait ? TRAIT_EXPLAINERS[appSheet.trait] : null);
</script>

<MobileTradeSheet />

<MobileSheet
  open={appSheet.active === 'score'}
  onclose={() => appSheet.close()}
  label="What the score means"
>
  <h2 class="m-sheet-title">The Swash score</h2>
  <p class="m-sheet-body">
    Every trader gets a 0–100 credibility score. It rewards steady, repeatable
    results — not one lucky trade.
  </p>
  <ul class="m-sheet-points">
    <li>
      <strong>Risk-adjusted returns</strong> — profit measured against the risk
      taken to earn it
    </li>
    <li><strong>Consistency</strong> — how steady the results are over time</li>
    <li>
      <strong>Track record</strong> — longer, busier histories earn more trust
    </li>
  </ul>
  <p class="m-sheet-hint">
    70+ is strong · 40–69 is solid · below 40 is unproven.
  </p>
  <a class="m-sheet-link tappable" href="/methodology" onclick={() => appSheet.close()}>
    How it's calculated →
  </a>
</MobileSheet>

<MobileSheet
  open={appSheet.active === 'mirror'}
  onclose={() => appSheet.close()}
  label="Mirror trading — coming soon"
>
  <div class="m-sheet-badge">Coming soon</div>
  <h2 class="m-sheet-title">Mirror this trader</h2>
  <p class="m-sheet-body">
    Mirroring copies a trader's moves to your own wallet automatically — with
    limits you control. We're putting the final pieces in place; until then,
    follow their open positions and trades right here.
  </p>
  <button
    type="button"
    class="m-sheet-cta m-cta-primary tappable"
    onclick={() => appSheet.close()}
  >
    Got it
  </button>
</MobileSheet>

{#if trait}
  <MobileSheet
    open={appSheet.active === 'trait'}
    onclose={() => appSheet.close()}
    label={`${trait.title} — what this trait means`}
  >
    <h2 class="m-sheet-title">{trait.title}</h2>
    <p class="m-sheet-body">{trait.body}</p>
    <p class="m-sheet-hint">{trait.takeaway}</p>
  </MobileSheet>
{/if}

<style>
  .m-sheet-title {
    font-family: var(--font-sans);
    font-size: var(--type-headline);
    font-weight: 600;
    color: var(--stripe-text-primary);
    margin: 0 0 var(--space-2);
  }

  .m-sheet-body {
    font-family: var(--font-sans);
    font-size: var(--type-callout);
    line-height: var(--line-body);
    color: var(--stripe-text-secondary);
    margin: 0 0 var(--space-3);
  }

  .m-sheet-points {
    list-style: none;
    margin: 0 0 var(--space-3);
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    font-family: var(--font-sans);
    font-size: var(--type-subhead);
    line-height: var(--line-body);
    color: var(--stripe-text-secondary);
  }
  .m-sheet-points strong {
    color: var(--stripe-text-primary);
    font-weight: 600;
  }

  .m-sheet-hint {
    font-family: var(--font-mono);
    font-variant-numeric: tabular-nums;
    font-size: var(--type-caption);
    color: var(--stripe-text-tertiary);
    margin: 0 0 var(--space-4);
  }

  .m-sheet-link {
    font-family: var(--font-sans);
    font-size: var(--type-callout);
    font-weight: 600;
    color: var(--stripe-accent);
    text-decoration: none;
  }

  .m-sheet-badge {
    display: inline-block;
    padding: 3px 10px;
    margin-bottom: var(--space-2);
    border-radius: var(--radius-full);
    background: var(--stripe-accent-subtle);
    color: var(--stripe-accent);
    font-family: var(--font-mono);
    font-size: var(--type-caption);
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }

  .m-sheet-cta {
    width: 100%;
    margin-top: var(--space-2);
  }
</style>
