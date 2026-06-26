<script lang="ts">
  import { TRAIT_EXPLAINERS } from '@copytrade/shared';
  import MobileSheet from './MobileSheet.svelte';
  import { appSheet } from '$lib/ui/sheets.svelte';

  const trait = $derived(appSheet.trait ? TRAIT_EXPLAINERS[appSheet.trait] : null);
</script>

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
</style>
