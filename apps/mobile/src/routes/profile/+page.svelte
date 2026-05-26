<script lang="ts">
  // Profile balance screen. Numbers are static placeholders for now — wallet
  // connect + mirrored positions land later (see the Capacitor wrap plan), at
  // which point these read from the canonical balance source.
  //
  // Balance is split into currency / whole / cents so the significant digits
  // can dominate typographically (dimmed symbol + cents).
  const balanceCur = '$';
  const balanceWhole = '27,547';
  const balanceCents = '.89';
  const todayChange = '+$2,845.53';
  const changePct = '30%';
  const changePositive = true;

  // Action bar — wallet exchange features aren't built yet, so these are inert
  // placeholders matching the design. Wire to the wallet provider later.
  function noop() {}
</script>

<svelte:head>
  <title>Profile · Swash</title>
</svelte:head>

<main id="main-content" class="m-page">
  <section class="m-balance-hero">
    <div class="m-hero-right">
      <button type="button" class="m-bell m-btn tappable" aria-label="Notifications" onclick={noop}>
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9 M13.73 21a2 2 0 0 1-3.46 0" />
        </svg>
        <span class="m-bell-dot" aria-hidden="true"></span>
      </button>
      <span class="m-change-pill" class:is-up={changePositive} class:is-down={!changePositive}>
        <svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor" aria-hidden="true">
          <path d={changePositive ? 'M12 6l7 12H5z' : 'M12 18 5 6h14z'} />
        </svg>
        {changePct}
      </span>
    </div>

    <span class="m-balance-label">Balance</span>
    <span class="m-balance-amount">
      <span class="m-amount-cur">{balanceCur}</span>{balanceWhole}<span class="m-amount-frac">{balanceCents}</span>
    </span>

    <div class="m-change-row">
      <svg class="m-change-icon" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M23 6l-9.5 9.5-5-5L1 18 M17 6h6v6" />
      </svg>
      <span class="m-change-amount">{todayChange}</span>
      <span class="m-change-caption">Today's change</span>
    </div>

    <div class="m-actions">
      <button type="button" class="m-action tappable" onclick={noop}>
        <svg class="m-action-icon" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M12 3v12 M7 10l5 5 5-5 M5 21h14" />
        </svg>
        <span class="m-action-label">Withdraw</span>
      </button>
      <button type="button" class="m-action tappable" onclick={noop}>
        <svg class="m-action-icon" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M12 15V3 M7 8l5-5 5 5 M5 21h14" />
        </svg>
        <span class="m-action-label">Deposit</span>
      </button>
      <button type="button" class="m-action tappable" onclick={noop}>
        <svg class="m-action-icon" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M3 3v5h5 M3.05 13a9 9 0 1 0 2.6-7.36L3 8 M12 7v5l3 2" />
        </svg>
        <span class="m-action-label">History</span>
      </button>
    </div>
  </section>
</main>

<style>
  .m-page {
    display: flex;
    flex-direction: column;
    min-height: 100vh;
    padding-top: var(--space-3);
    padding-bottom: calc(var(--safe-bottom) + 80px);
  }

  /* Balance hero — translates the mockup's vivid-blue panel into the app's
     monochrome glass: a navy gradient lit from two soft sources (top-left key,
     bottom-right fill) for depth, with a faint grain overlay (::after) for a
     tactile, premium surface rather than a flat fill. */
  .m-balance-hero {
    position: relative;
    margin: 0 max(var(--safe-left), var(--space-4));
    padding: var(--space-6) var(--space-5) var(--space-5);
    border-radius: var(--radius-xl);
    /* The two radial washes use --stripe-accent-muted so depth tracks the
       theme: a soft white wash on dark, a soft dark wash on light. The base
       gradient between two elevated tones gives subtle planarity in both. */
    background:
      radial-gradient(130% 120% at 0% -10%, var(--stripe-accent-muted), transparent 52%),
      radial-gradient(120% 130% at 100% 110%, var(--stripe-accent-muted), transparent 50%),
      linear-gradient(165deg, var(--stripe-bg-elevated), var(--stripe-bg-secondary));
    box-shadow: var(--glass-shadow), var(--glass-white-highlight);
    overflow: hidden;
  }
  /* Fine grain — kept very low so it reads as texture, not noise. Sits above
     the gradient; pointer-events:none so it never intercepts taps. */
  .m-balance-hero::after {
    content: '';
    position: absolute;
    inset: 0;
    border-radius: inherit;
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='140' height='140'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E");
    opacity: 0.035;
    mix-blend-mode: overlay;
    pointer-events: none;
  }

  /* Bell + change pill share one right-anchored column so their right edges
     line up exactly at the hero's --space-5 inset (was: bell absolute, pill in
     flow — two layout systems that drifted apart). */
  .m-hero-right {
    position: absolute;
    top: var(--space-5);
    right: var(--space-5);
    z-index: 1;
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: var(--space-3);
  }

  /* Notification bell — inherits the lifted-glass surface + recessed press
     from .m-btn. Only the circle shape, fixed size, and grid centering are
     specific to this button. */
  .m-bell {
    position: relative;
    display: grid;
    place-items: center;
    width: 40px;
    height: 40px;
    border-radius: var(--radius-full);
  }
  .m-bell-dot {
    position: absolute;
    top: 9px;
    right: 10px;
    width: 7px;
    height: 7px;
    border-radius: var(--radius-full);
    background: var(--stripe-danger);
    border: 1.5px solid var(--stripe-bg-elevated);
  }

  /* Content sits above the grain overlay. */
  .m-balance-label,
  .m-balance-amount,
  .m-change-row,
  .m-actions {
    position: relative;
    z-index: 1;
  }

  .m-balance-label {
    display: block;
    font-family: var(--font-mono);
    font-size: var(--type-footnote);
    color: var(--stripe-text-tertiary);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    margin-bottom: var(--space-2);
  }

  /* Amount — the hero element. Significant digits at full weight/contrast; the
     currency symbol and cents are dimmed + smaller so the eye lands on the
     number first. Faint glow gives it presence without a hard shadow. */
  .m-balance-amount {
    display: block;
    font-family: var(--font-sans);
    font-variant-numeric: tabular-nums;
    font-size: var(--type-display);
    font-weight: 700;
    letter-spacing: -0.015em;
    line-height: 1.05;
    color: var(--stripe-text-primary);
    text-shadow: 0 1px 24px rgba(255, 255, 255, 0.08);
  }
  .m-amount-cur {
    font-size: 0.62em;
    font-weight: 600;
    color: var(--stripe-text-tertiary);
    margin-right: 2px;
    vertical-align: baseline;
  }
  .m-amount-frac {
    font-size: 0.6em;
    font-weight: 600;
    color: var(--stripe-text-tertiary);
    vertical-align: baseline;
  }

  /* ▲ 30% pill — glass chip, tinted by direction, with an inset sheen + soft
     directional glow so it lifts off the hero. */
  .m-change-pill {
    flex: 0 0 auto;
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 6px 12px;
    border-radius: var(--radius-full);
    font-family: var(--font-mono);
    font-variant-numeric: tabular-nums;
    font-size: var(--type-footnote);
    font-weight: 700;
  }
  .m-change-pill.is-up {
    background: var(--stripe-success-subtle);
    color: var(--stripe-success);
    box-shadow:
      inset 0 1px 0 rgba(255, 255, 255, 0.08),
      0 2px 12px rgba(22, 199, 132, 0.18);
  }
  .m-change-pill.is-down {
    background: var(--stripe-danger-subtle);
    color: var(--stripe-danger);
    box-shadow:
      inset 0 1px 0 rgba(255, 255, 255, 0.08),
      0 2px 12px rgba(255, 107, 107, 0.18);
  }

  .m-change-row {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    margin-top: var(--space-3);
  }
  .m-change-icon {
    color: var(--stripe-success);
  }
  .m-change-amount {
    font-family: var(--font-mono);
    font-variant-numeric: tabular-nums;
    font-size: var(--type-callout);
    font-weight: 700;
    color: var(--stripe-success);
  }
  .m-change-caption {
    font-family: var(--font-sans);
    font-size: var(--type-subhead);
    color: var(--stripe-text-tertiary);
  }

  /* Action bar — recessed-into-hero pocket. No second material layer (Apple:
     don't nest glass): the inset shadow alone darkens the well, and the hero's
     gradient shows through. */
  .m-actions {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: var(--space-2);
    margin-top: var(--space-6);
    padding: var(--space-3) var(--space-2);
    border-radius: var(--radius-lg);
    background: var(--glass-pressed-bg);
    box-shadow: var(--glass-pressed-inset);
  }
  .m-action {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: var(--space-2);
    padding: var(--space-2) 0;
    background: transparent;
    border: 0;
    border-radius: var(--radius-md);
    color: var(--stripe-text-primary);
    cursor: pointer;
    min-height: var(--touch-min);
    transition:
      background var(--motion-fast) var(--motion-ease),
      transform var(--motion-fast) var(--motion-ease);
  }
  .m-action-icon {
    transition: transform var(--motion-fast) var(--motion-ease);
  }
  /* Hover/press: brighten with the same lifted-glass wash other buttons use,
     so an action lifting out of the recessed pocket reads as the inverse of
     pressing a chip in. No accent-color wash — the chrome language stays
     monochrome and matches the menu pill's tap behavior. */
  .m-action:hover {
    background: var(--glass-white-bg);
  }
  .m-action:active {
    transform: scale(0.95);
    background: var(--glass-white-bg);
  }
  .m-action:active .m-action-icon {
    transform: translateY(1px);
  }
  .m-action-label {
    font-family: var(--font-sans);
    font-size: var(--type-footnote);
    font-weight: 500;
    color: var(--stripe-text-secondary);
    transition: color var(--motion-fast) var(--motion-ease);
  }
  .m-action:hover .m-action-label {
    color: var(--stripe-text-primary);
  }

  /* Staggered entrance — content rises + fades in top-to-bottom on load. One
     orchestrated reveal reads more deliberate than scattered micro-motion. */
  .m-hero-right,
  .m-balance-label,
  .m-balance-amount,
  .m-change-row,
  .m-actions {
    animation: m-rise 0.5s cubic-bezier(0.16, 1, 0.3, 1) both;
  }
  .m-balance-label {
    animation-delay: 0.04s;
  }
  .m-balance-amount {
    animation-delay: 0.1s;
  }
  .m-change-row {
    animation-delay: 0.16s;
  }
  .m-actions {
    animation-delay: 0.22s;
  }
  .m-hero-right {
    animation-delay: 0.28s;
  }

  @keyframes m-rise {
    from {
      opacity: 0;
      transform: translateY(8px);
    }
    to {
      opacity: 1;
      transform: none;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .m-hero-right,
    .m-balance-label,
    .m-balance-amount,
    .m-change-row,
    .m-actions {
      animation: none;
    }
  }
</style>
