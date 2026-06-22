<script lang="ts">
  // Profile dashboard — design pass, mock data only (see
  // docs/plans/2026-06-10-profile-page-refresh-design.md). Everything below
  // renders from MOCK_PROFILE; wiring real endpoints later is a one-spot
  // swap. The hero carries a "Preview" chip as the honesty marker.
  import { browser } from '$app/environment';
  import { coinDisplayName, coinIconUrl, coinIconBg } from '$lib/utils/coin';
  import { effigyUrl, shortAddress, formatPnl, formatUsd, pnlSignClass } from '$lib/utils/format';
  import { appSheet } from '$lib/ui/sheets.svelte';

  // Light/dark toggle — flips data-theme on <html> (see app.css theme system)
  // and persists; app.html re-applies the saved choice before first paint.
  // Page-floor colors per theme — keeps the iOS status-bar tint (`theme-color`)
  // in sync with the surface the user is actually looking at.
  const THEME_COLOR = { dark: '#09151A', light: '#E3E7EE' } as const;
  let dark = $state(browser && document.documentElement.dataset.theme === 'dark');
  function toggleTheme() {
    dark = !dark;
    const root = document.documentElement;
    // Crossfade between palettes for the flip, then drop the class so it never
    // interferes with hover/press transitions.
    root.classList.add('theme-transition');
    window.setTimeout(() => root.classList.remove('theme-transition'), 320);

    if (dark) root.dataset.theme = 'dark';
    else delete root.dataset.theme;
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute('content', dark ? THEME_COLOR.dark : THEME_COLOR.light);
    try {
      localStorage.setItem('swash-theme', dark ? 'dark' : 'light');
    } catch {}
  }

  // Mirror addresses are real leaderboard wallets (taps genuinely navigate);
  // weights/contributions are fixtures. Times/details on fills are static
  // strings so the preview is deterministic.
  const MOCK_PROFILE = {
    balance: { currency: '$', whole: '27,547', cents: '.89' },
    todayChange: '+$2,845.53',
    changePct: '11.5%',
    changePositive: true,
    mirrors: [
      { address: '0xaf0fdd39e5d92499b0ed9f68693da99c0ec1e92e', weightPct: 50, contribution30dUsd: 1840 },
      { address: '0x8cc94dc843e1ea7a19805e0cca43001123512b6a', weightPct: 30, contribution30dUsd: 612 },
      { address: '0x2025137a136bea7446deba681cbfc7cf1970840e', weightPct: 20, contribution30dUsd: -208 },
    ],
    positions: [
      { coin: 'BTC', side: 'long', leverage: 3, sizeUsd: 18400, pnlUsd: 1212 },
      { coin: 'ETH', side: 'short', leverage: 2, sizeUsd: 9750, pnlUsd: -486 },
      { coin: 'SOL', side: 'long', leverage: 5, sizeUsd: 4200, pnlUsd: 318 },
      { coin: 'HYPE', side: 'long', leverage: 1, sizeUsd: 2300, pnlUsd: 94 },
    ],
    fills: [
      { coin: 'BTC', side: 'sell', when: '2h ago', detail: '0.12 @ $96,410', realizedPnlUsd: 1120 },
      { coin: 'SOL', side: 'buy', when: '5h ago', detail: '18.5 @ $227.40', realizedPnlUsd: null },
      { coin: 'ETH', side: 'sell', when: '9h ago', detail: '1.8 @ $3,412', realizedPnlUsd: null },
      { coin: 'HYPE', side: 'sell', when: '1d ago', detail: '40 @ $28.95', realizedPnlUsd: -57 },
      { coin: 'BTC', side: 'buy', when: '2d ago', detail: '0.12 @ $87,080', realizedPnlUsd: null },
      { coin: 'ETH', side: 'buy', when: '3d ago', detail: '2.4 @ $3,615', realizedPnlUsd: 284 },
    ],
  } as const;

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
      <div class="m-hero-btns">
        <button type="button" class="m-theme-switch tappable" role="switch" aria-checked={dark} aria-label="Dark mode" onclick={toggleTheme}>
          <span class="m-switch-thumb">
            {#if dark}
              <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
              </svg>
            {:else}
              <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <circle cx="12" cy="12" r="4" />
                <path d="M12 2v2 M12 20v2 M4.93 4.93l1.41 1.41 M17.66 17.66l1.41 1.41 M2 12h2 M20 12h2 M6.34 17.66l-1.41 1.41 M19.07 4.93l-1.41 1.41" />
              </svg>
            {/if}
          </span>
        </button>
        <button type="button" class="m-hero-btn m-btn tappable" aria-label="Notifications" onclick={noop}>
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9 M13.73 21a2 2 0 0 1-3.46 0" />
          </svg>
          <span class="m-bell-dot" aria-hidden="true"></span>
        </button>
      </div>
      <span class="m-change-pill" class:is-up={MOCK_PROFILE.changePositive} class:is-down={!MOCK_PROFILE.changePositive}>
        <svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor" aria-hidden="true">
          <path d={MOCK_PROFILE.changePositive ? 'M12 6l7 12H5z' : 'M12 18 5 6h14z'} />
        </svg>
        {MOCK_PROFILE.changePct}
      </span>
    </div>

    <div class="m-balance-label-row">
      <span class="m-balance-label">Balance</span>
      <span class="m-preview-chip">Preview</span>
    </div>
    <span class="m-balance-amount">
      <span class="m-amount-cur">{MOCK_PROFILE.balance.currency}</span>{MOCK_PROFILE.balance.whole}<span class="m-amount-frac">{MOCK_PROFILE.balance.cents}</span>
    </span>

    <div class="m-change-row">
      <svg class="m-change-icon" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <path d="M23 6l-9.5 9.5-5-5L1 18 M17 6h6v6" />
      </svg>
      <span class="m-change-amount">{MOCK_PROFILE.todayChange}</span>
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

  <!-- ── Your mirrors — coming-soon teaser. Designed for deletion: removing
       this section block (and its fixture key) yields the minimal variant. -->
  <section class="m-profile-section m-psec-1">
    <header class="m-psec-head safe-x">
      <h2 class="m-psec-title">Your mirrors</h2>
      <span class="m-soon-badge">Coming soon</span>
    </header>
    <ul class="m-panel">
      {#each MOCK_PROFILE.mirrors as m (m.address)}
        <li>
          <a class="m-mirror-row tappable-row" href={`/trader/${m.address}`}>
            <img class="m-mirror-avatar" src={effigyUrl(m.address)} alt="" loading="lazy" />
            <span class="m-mirror-main">
              <span class="m-mirror-addr">{shortAddress(m.address, 6, 4)}</span>
              <span class="m-mirror-weight">{m.weightPct}%</span>
            </span>
            <span class="m-mirror-stats">
              <span class="m-mirror-pnl {pnlSignClass(m.contribution30dUsd)}">{formatPnl(m.contribution30dUsd)}</span>
              <span class="m-mirror-pnl-cap">30D profit</span>
            </span>
          </a>
        </li>
      {/each}
      <li>
        <button type="button" class="m-panel-foot tappable" onclick={() => appSheet.open('mirror')}>
          Edit allocation →
        </button>
      </li>
    </ul>
  </section>

  <!-- ── Open positions ─────────────────────────────────────── -->
  <section class="m-profile-section m-psec-2">
    <header class="m-psec-head safe-x">
      <h2 class="m-psec-title">Open positions</h2>
    </header>
    <ul class="m-panel">
      {#each MOCK_PROFILE.positions as p (p.coin + p.side)}
        <li class="m-ppos-row">
          <span class="m-coin-ring" class:is-long={p.side === 'long'} class:is-short={p.side === 'short'}>
            {#if coinIconUrl(p.coin)}
              <img src={coinIconUrl(p.coin)} style:background-color={coinIconBg(p.coin)} style:padding={coinIconBg(p.coin) ? '4px' : null} alt="" loading="lazy" />
            {/if}
          </span>
          <span class="m-ppos-main">
            <span class="m-ppos-coin">{coinDisplayName(p.coin)}</span>
            <span class="m-ppos-side" class:is-long={p.side === 'long'} class:is-short={p.side === 'short'}>
              {p.side} · {p.leverage}x
            </span>
          </span>
          <span class="m-ppos-stats">
            <span class="m-ppos-size">{formatUsd(p.sizeUsd)}</span>
            <span class="m-ppos-pnl {pnlSignClass(p.pnlUsd)}">{formatPnl(p.pnlUsd)}</span>
          </span>
        </li>
      {/each}
    </ul>
  </section>

  <!-- ── Latest transactions ────────────────────────────────── -->
  <section class="m-profile-section m-psec-3">
    <header class="m-psec-head safe-x">
      <h2 class="m-psec-title">Latest transactions</h2>
      <span class="m-psec-sub">Last 20</span>
    </header>
    <ul class="m-panel">
      {#each MOCK_PROFILE.fills as f, i (i)}
        <li class="m-fill-row">
          <span class="m-coin-ring" class:is-long={f.side === 'buy'} class:is-short={f.side === 'sell'}>
            {#if coinIconUrl(f.coin)}
              <img src={coinIconUrl(f.coin)} style:background-color={coinIconBg(f.coin)} style:padding={coinIconBg(f.coin) ? '4px' : null} alt="" loading="lazy" />
            {/if}
          </span>
          <span class="m-fill-main">
            <span class="m-fill-line1">
              {coinDisplayName(f.coin)} ·
              <span class:is-buy={f.side === 'buy'} class:is-sell={f.side === 'sell'}>{f.side}</span>
            </span>
            <span class="m-fill-line2">{f.when} · {f.detail}</span>
          </span>
          <span class="m-fill-pnl {f.realizedPnlUsd === null ? 'is-open' : pnlSignClass(f.realizedPnlUsd)}">
            {f.realizedPnlUsd === null ? '—' : formatPnl(f.realizedPnlUsd)}
          </span>
        </li>
      {/each}
    </ul>
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

  /* Balance hero — the app's glass material (same tokens as cards and nav),
     lit as the most important object in the room: two soft radial washes in
     the accent-muted tone for depth, the grain kept for a tactile, premium
     surface. The old opaque navy gradient is gone — one material app-wide. */
  .m-balance-hero {
    position: relative;
    margin: 0 max(var(--safe-left), var(--space-4));
    padding: var(--space-6) var(--space-5) var(--space-5);
    border-radius: var(--radius-xl);
    background:
      radial-gradient(130% 120% at 0% -10%, var(--stripe-accent-muted), transparent 52%),
      radial-gradient(120% 130% at 100% 110%, var(--stripe-accent-muted), transparent 50%),
      var(--glass-bg);
    -webkit-backdrop-filter: var(--glass-blur);
    backdrop-filter: var(--glass-blur);
    box-shadow:
      var(--glass-shadow),
      var(--glass-highlight),
      inset 0 0 0 0.5px var(--stripe-border-light);
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
     line up exactly at the hero's --space-5 inset. */
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

  .m-hero-btns {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }
  /* Sized down to match the change pill's height below. */
  .m-hero-btn {
    position: relative;
    display: grid;
    place-items: center;
    width: 28px;
    height: 28px;
    border-radius: var(--radius-full);
  }
  .m-bell-dot {
    position: absolute;
    top: 5px;
    right: 6px;
    width: 6px;
    height: 6px;
    border-radius: var(--radius-full);
    background: var(--stripe-danger);
    border: 1.5px solid var(--stripe-bg-elevated);
  }

  /* Light/dark switch — recessed track (pressed glass) with a raised thumb
     that slides right for dark. Thumb icon mirrors the current mode. */
  .m-theme-switch {
    position: relative;
    width: 48px;
    height: 28px;
    padding: 0;
    border: 0;
    border-radius: var(--radius-full);
    background: var(--glass-pressed-bg);
    box-shadow: var(--glass-pressed-inset);
    cursor: pointer;
  }
  .m-switch-thumb {
    position: absolute;
    top: 2px;
    left: 2px;
    display: grid;
    place-items: center;
    width: 24px;
    height: 24px;
    border-radius: var(--radius-full);
    background: var(--glass-white-bg);
    box-shadow: var(--glass-white-highlight), var(--shadow-xs);
    color: var(--stripe-text-secondary);
    transition: transform var(--motion-fast) var(--motion-ease);
  }
  .m-theme-switch[aria-checked='true'] .m-switch-thumb {
    transform: translateX(20px);
  }

  /* Content sits above the grain overlay. */
  .m-balance-label-row,
  .m-balance-amount,
  .m-change-row,
  .m-actions {
    position: relative;
    z-index: 1;
  }

  .m-balance-label-row {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    margin-bottom: var(--space-2);
  }
  .m-balance-label {
    font-family: var(--font-mono);
    font-size: var(--type-footnote);
    color: var(--stripe-text-tertiary);
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }
  /* Honesty marker — the page's numbers are fixtures until wallets land. */
  .m-preview-chip {
    padding: 1px 7px;
    border-radius: var(--radius-full);
    background: var(--stripe-accent-subtle);
    color: var(--stripe-accent);
    font-family: var(--font-mono);
    font-size: 10px;
    letter-spacing: 0.05em;
    text-transform: uppercase;
  }

  /* Amount — the hero element. Significant digits at full weight/contrast; the
     currency symbol and cents are dimmed + smaller so the eye lands on the
     number first. (No glow — that was a dark-theme artifact.) */
  .m-balance-amount {
    display: block;
    font-family: var(--font-sans);
    font-variant-numeric: tabular-nums;
    font-size: var(--type-display);
    font-weight: 700;
    letter-spacing: -0.015em;
    line-height: 1.05;
    color: var(--stripe-text-primary);
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

  /* ▲ change pill — chip language, tinted by direction. */
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

  /* ── Sections below the hero ─────────────────────────────── */
  .m-profile-section {
    margin-top: var(--space-4);
  }

  .m-psec-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
    margin-bottom: var(--space-3);
  }
  .m-psec-title {
    font-family: var(--font-sans);
    font-size: var(--type-body);
    font-weight: 600;
    color: var(--stripe-text-primary);
    margin: 0;
  }
  .m-psec-sub {
    font-family: var(--font-mono);
    font-size: var(--type-caption);
    color: var(--stripe-text-tertiary);
  }
  /* Same near-future vocabulary as the Mirror sheet badge. */
  .m-soon-badge {
    padding: 2px 9px;
    border-radius: var(--radius-full);
    background: var(--stripe-accent-subtle);
    color: var(--stripe-accent);
    font-family: var(--font-mono);
    font-size: 10px;
    letter-spacing: 0.05em;
    text-transform: uppercase;
  }

  /* Inset-grouped glass panel — same surface as trader detail's lists. */
  .m-panel {
    list-style: none;
    margin: 0 max(var(--safe-left), var(--space-4));
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
  .m-panel > li + li {
    border-top: 1px solid var(--stripe-border);
  }

  /* ── Mirror rows ─────────────────────────────────────────── */
  .m-mirror-row {
    color: inherit;
    text-decoration: none;
  }
  .m-mirror-avatar {
    width: 28px;
    height: 28px;
    flex: 0 0 28px;
    border-radius: var(--radius-full);
    background: var(--stripe-bg-secondary);
    border: 1px solid var(--stripe-border-light);
  }
  .m-mirror-main {
    flex: 1 1 auto;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }
  .m-mirror-addr {
    font-family: var(--font-mono);
    font-size: var(--type-subhead);
    font-weight: 600;
    color: var(--stripe-text-primary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .m-mirror-weight {
    flex: 0 0 auto;
    padding: 1px 7px;
    border-radius: var(--radius-full);
    background: var(--stripe-accent-muted);
    font-family: var(--font-mono);
    font-variant-numeric: tabular-nums;
    font-size: var(--type-caption);
    color: var(--stripe-text-secondary);
  }
  .m-mirror-stats {
    flex: 0 0 auto;
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 1px;
    font-family: var(--font-mono);
    font-variant-numeric: tabular-nums;
  }
  .m-mirror-pnl {
    font-size: var(--type-subhead);
    font-weight: 600;
    color: var(--stripe-text-primary);
  }
  .m-mirror-pnl-cap {
    font-size: 10px;
    color: var(--stripe-text-tertiary);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  /* Panel footer link — quiet full-width affordance, presses like a row. */
  .m-panel-foot {
    width: 100%;
    min-height: var(--touch-min);
    padding: var(--space-3) var(--space-4);
    background: transparent;
    border: 0;
    font-family: var(--font-sans);
    font-size: var(--type-footnote);
    font-weight: 600;
    color: var(--stripe-accent);
    cursor: pointer;
  }

  /* ── Shared coin icon with side ring ─────────────────────── */
  .m-coin-ring {
    flex: 0 0 32px;
    width: 32px;
    height: 32px;
    border-radius: var(--radius-full);
    background: var(--stripe-bg-secondary);
    border: 1.5px solid var(--stripe-border-light);
    overflow: hidden;
    box-sizing: border-box;
  }
  .m-coin-ring.is-long {
    border-color: var(--stripe-success);
  }
  .m-coin-ring.is-short {
    border-color: var(--stripe-danger);
  }
  .m-coin-ring img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  /* ── Position rows ───────────────────────────────────────── */
  .m-ppos-row,
  .m-fill-row {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-3) var(--space-4);
    min-height: var(--touch-comfortable);
  }
  .m-ppos-main,
  .m-fill-main {
    flex: 1 1 auto;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .m-ppos-coin {
    font-family: var(--font-mono);
    font-size: var(--type-body);
    color: var(--stripe-text-primary);
  }
  .m-ppos-side {
    font-family: var(--font-mono);
    font-size: var(--type-caption);
    color: var(--stripe-text-tertiary);
  }
  .m-ppos-side.is-long {
    color: var(--stripe-success);
  }
  .m-ppos-side.is-short {
    color: var(--stripe-danger);
  }
  .m-ppos-stats {
    flex: 0 0 auto;
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 2px;
    font-family: var(--font-mono);
    font-variant-numeric: tabular-nums;
    text-align: right;
  }
  .m-ppos-size {
    font-size: var(--type-subhead);
    color: var(--stripe-text-primary);
  }
  .m-ppos-pnl {
    font-size: var(--type-caption);
    color: var(--stripe-text-tertiary);
  }

  /* ── Fill rows ───────────────────────────────────────────── */
  .m-fill-line1 {
    font-family: var(--font-mono);
    font-size: var(--type-subhead);
    font-weight: 500;
    color: var(--stripe-text-primary);
  }
  .m-fill-line1 .is-buy {
    color: var(--stripe-success);
  }
  .m-fill-line1 .is-sell {
    color: var(--stripe-danger);
  }
  .m-fill-line2 {
    font-family: var(--font-mono);
    font-variant-numeric: tabular-nums;
    font-size: var(--type-caption);
    color: var(--stripe-text-tertiary);
  }
  .m-fill-pnl {
    flex: 0 0 auto;
    font-family: var(--font-mono);
    font-variant-numeric: tabular-nums;
    font-size: var(--type-subhead);
    color: var(--stripe-text-primary);
  }
  .m-fill-pnl.is-open {
    color: var(--stripe-text-muted);
  }

  /* Sign coloring (global k-pnl-* classes land on scoped elements). */
  .m-mirror-pnl:global(.k-pnl-positive),
  .m-ppos-pnl:global(.k-pnl-positive),
  .m-fill-pnl:global(.k-pnl-positive) {
    color: var(--stripe-success);
  }
  .m-mirror-pnl:global(.k-pnl-negative),
  .m-ppos-pnl:global(.k-pnl-negative),
  .m-fill-pnl:global(.k-pnl-negative) {
    color: var(--stripe-danger);
  }

  /* ── Staggered entrance — hero beats first, sections follow ── */
  .m-hero-right,
  .m-balance-label-row,
  .m-balance-amount,
  .m-change-row,
  .m-actions,
  .m-profile-section {
    animation: m-rise 0.5s cubic-bezier(0.16, 1, 0.3, 1) both;
  }
  .m-balance-label-row {
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
  .m-psec-1 {
    animation-delay: 0.3s;
  }
  .m-psec-2 {
    animation-delay: 0.38s;
  }
  .m-psec-3 {
    animation-delay: 0.46s;
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
    .m-balance-label-row,
    .m-balance-amount,
    .m-change-row,
    .m-actions,
    .m-profile-section {
      animation: none;
    }
  }
</style>
