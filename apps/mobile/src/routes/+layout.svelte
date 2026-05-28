<script lang="ts">
  import '../app.css';
  import { page } from '$app/stores';

  let { children } = $props();

  const path = $derived($page.url.pathname);
  const homeActive = $derived(path === '/');
  const tradersActive = $derived(path.startsWith('/trader'));
  const assetsActive = $derived(path.startsWith('/assets'));
  const feedActive = $derived(path.startsWith('/feed'));
  const profileActive = $derived(path.startsWith('/profile'));

  // Bottom-nav icons. Inline SVG paths so we avoid the icon-library import
  // (and the Capacitor bundle ships fewer bytes).
  const ICON_HOME = 'm3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z M9 22V12h6v10';
  const ICON_PROFILE = 'M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2 M16 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0';
  const ICON_TRADERS =
    'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2 M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0 M22 21v-2a4 4 0 0 0-3-3.87 M16 3.13a4 4 0 0 1 0 7.75';
  const ICON_ASSETS = 'M3 3v18h18 M18 17V9 M13 17V5 M8 17v-3';
  const ICON_FEED =
    'M5 5h.01 M10 5h.01 M15 5h.01 M19 5h.01 M5 10h.01 M10 10h.01 M15 10h.01 M19 10h.01 M5 15h.01 M10 15h.01 M15 15h.01 M19 15h.01 M5 19h.01 M10 19h.01 M15 19h.01 M19 19h.01';
</script>

<svelte:head>
  <title>Swash — The right traders. Mirrored to your wallet.</title>
  <meta
    name="description"
    content="Curated, behaviorally classified, statistically corrected leaderboard of the most credible traders on Hyperliquid."
  />
</svelte:head>

<div class="m-shell">
  <a href="#main-content" class="skip-link">Skip to main content</a>

  <header class="m-header safe-top safe-x" aria-label="App header">
    <a href="/" class="m-header-brand" aria-label="Swash — home">
      <img class="m-header-brand-icon" src="/logoicon.png" alt="" aria-hidden="true" />
      <span class="m-header-brand-text">swash</span>
    </a>
  </header>

  {@render children?.()}

  <div class="m-bottomnav-edge" aria-hidden="true"></div>

  <nav class="m-bottomnav" aria-label="Primary navigation">
    <div class="m-bottomnav-inner">
      <a
        href="/assets"
        class="m-bottomnav-item tappable"
        class:is-active={assetsActive}
        aria-current={assetsActive ? 'page' : undefined}
      >
        <svg
          class="m-bottomnav-icon"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.5"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
        >
          <path d={ICON_ASSETS} />
        </svg>
        <span class="m-bottomnav-label">Assets</span>
      </a>
      <a
        href="/traders"
        class="m-bottomnav-item tappable"
        class:is-active={tradersActive}
        aria-current={tradersActive ? 'page' : undefined}
      >
        <svg
          class="m-bottomnav-icon"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.5"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
        >
          <path d={ICON_TRADERS} />
        </svg>
        <span class="m-bottomnav-label">Traders</span>
      </a>
      <a
        href="/"
        class="m-bottomnav-item tappable"
        class:is-active={homeActive}
        aria-current={homeActive ? 'page' : undefined}
      >
        <svg
          class="m-bottomnav-icon"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.5"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
        >
          <path d={ICON_HOME} />
        </svg>
        <span class="m-bottomnav-label">Home</span>
      </a>
      <a
        href="/feed"
        class="m-bottomnav-item tappable"
        class:is-active={feedActive}
        aria-current={feedActive ? 'page' : undefined}
      >
        <svg
          class="m-bottomnav-icon"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2.5"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
        >
          <path d={ICON_FEED} />
        </svg>
        <span class="m-bottomnav-label">Feed</span>
      </a>
      <a
        href="/profile"
        class="m-bottomnav-item tappable"
        class:is-active={profileActive}
        aria-current={profileActive ? 'page' : undefined}
      >
        <svg
          class="m-bottomnav-icon"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.5"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
        >
          <path d={ICON_PROFILE} />
        </svg>
        <span class="m-bottomnav-label">Profile</span>
      </a>
    </div>
  </nav>
</div>

<style>
  .m-shell {
    min-height: 100vh;
    min-height: 100dvh;
    background: var(--stripe-bg-deep);
    color: var(--stripe-text-primary);
    display: flex;
    flex-direction: column;
  }

  .m-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
    /* Match the 56px bottom-nav height so top/bottom chrome are balanced. */
    min-height: 56px;
    padding-top: var(--safe-top);
    padding-bottom: 0;
    background: var(--glass-bg-thin);
    -webkit-backdrop-filter: var(--glass-blur-thin);
    backdrop-filter: var(--glass-blur-thin);
    position: sticky;
    top: 0;
    z-index: 20;
  }

  /* Scroll-edge effect: a short fade strip immediately under the header that
     bleeds the header tone into transparency, so content scrolling underneath
     resolves into clarity rather than colliding with a hard chrome line.
     Apple HIG: replace dividers with subtle blur at chrome boundaries. */
  .m-header::after {
    content: '';
    position: absolute;
    top: 100%;
    left: 0;
    right: 0;
    height: 20px;
    background: linear-gradient(to bottom, var(--glass-bg-thin), transparent);
    pointer-events: none;
  }
  @media (prefers-reduced-transparency: reduce) {
    .m-header::after {
      display: none;
    }
  }

  /* Brand mark — icon + wordmark, laid out inline. Replaces the older
     single `logotext.png` that baked icon and text together. */
  .m-header-brand {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    text-decoration: none;
    color: var(--stripe-text-primary);
  }
  .m-header-brand-icon {
    height: 26px;
    width: 26px;
    display: block;
    object-fit: contain;
  }
  .m-header-brand-text {
    font-family: var(--font-sans);
    font-size: 17px;
    font-weight: 600;
    letter-spacing: -0.01em;
    color: var(--stripe-text-primary);
    line-height: 1;
  }

  /* Scroll-edge effect above the floating bottom-nav pill: a fade band that
     softens content as it scrolls behind / past the pill. Spans full width
     (the pill is inset, so content drifts past on either side too).
     Apple HIG: chrome boundaries get subtle blur, not hard cut-offs. */
  .m-bottomnav-edge {
    position: fixed;
    left: 0;
    right: 0;
    /* Anchored to the TOP of the pill, not the screen floor — otherwise the
       gradient would fill the area behind the pill with page-color and the
       pill's backdrop-blur would frost a solid block instead of real content.
       Pill bottom is safe-bottom + --space-3; pill height is 64px. */
    bottom: calc(var(--safe-bottom) + var(--space-3) + 64px);
    height: 28px;
    background: linear-gradient(
      to top,
      var(--stripe-bg-deep) 0%,
      transparent 100%
    );
    pointer-events: none;
    z-index: 19;
  }
  @media (prefers-reduced-transparency: reduce) {
    .m-bottomnav-edge {
      display: none;
    }
  }

  /* Bottom navigation — sticks to the bottom safe-area, never scrolls. */
  /* Floating pill — detached from the screen edges, fully rounded, frosted.
     Content scrolls behind it on both sides. */
  .m-bottomnav {
    position: fixed;
    left: max(var(--safe-left), var(--space-4));
    right: max(var(--safe-right), var(--space-4));
    bottom: calc(var(--safe-bottom) + var(--space-3));
    /* Apple-style Liquid Glass material. The body is a vertical gradient
       (brighter at the top, dimmer at the bottom) to fake the look of a
       curved upper face catching light — flat fills always read as paint.
       Backdrop-filter does the real frosting; the inset shadow stack does
       the thickness work: top-edge specular, bottom-edge shadow (suggesting
       depth), a hairline rim, and an inner glow for refracted light. */
    background:
      linear-gradient(
        180deg,
        rgba(255, 255, 255, 0.45) 0%,
        rgba(255, 255, 255, 0.22) 50%,
        rgba(255, 255, 255, 0.32) 100%
      );
    -webkit-backdrop-filter: blur(28px) saturate(220%) brightness(108%);
    backdrop-filter: blur(28px) saturate(220%) brightness(108%);
    border-radius: var(--radius-xl);
    box-shadow:
      var(--shadow-lg),
      inset 0 1.5px 0 rgba(255, 255, 255, 0.85),
      inset 0 -1px 1px rgba(10, 15, 26, 0.08),
      inset 1px 0 0 rgba(255, 255, 255, 0.35),
      inset -1px 0 0 rgba(255, 255, 255, 0.35),
      inset 0 0 32px rgba(255, 255, 255, 0.2);
    overflow: hidden;
    z-index: 20;
  }

  /* Specular sheen — a soft vertical gradient that brightens the top of the
     pill and fades through the body, mimicking the highlight on a curved
     glass surface. Sits between the backdrop and the nav items. */
  .m-bottomnav::before {
    content: '';
    position: absolute;
    inset: 0;
    pointer-events: none;
    border-radius: inherit;
    background: linear-gradient(
      180deg,
      rgba(255, 255, 255, 0.32) 0%,
      rgba(255, 255, 255, 0.06) 30%,
      transparent 60%
    );
    z-index: 0;
  }

  /* Sits above the .m-bottomnav::before specular layer so icons/labels
     aren't washed out by the highlight gradient. */
  .m-bottomnav-inner {
    position: relative;
    z-index: 1;
    display: grid;
    grid-template-columns: repeat(5, 1fr);
    height: 64px;
  }

  .m-bottomnav-item {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 5px;
    color: var(--stripe-text-tertiary);
    text-decoration: none;
    font-family: var(--font-mono);
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    min-height: var(--touch-min);
  }

  .m-bottomnav-item {
    position: relative;
    transition: color var(--motion-fast) var(--motion-ease);
  }

  .m-bottomnav-item.is-active {
    color: var(--stripe-accent);
  }

  /* Active tab = recessed glass pill (Apple HIG iOS 26 pattern): no external
     indicator line, no glow. The pill sits behind the icon+label via ::before
     and uses the shared pressed-depth tokens so selection reads consistently
     with chips and segs across the app. */
  .m-bottomnav-item.is-active::before {
    content: '';
    position: absolute;
    inset: 6px 8px;
    border-radius: var(--radius-lg);
    background: var(--glass-pressed-bg);
    box-shadow: var(--glass-pressed-inset);
    pointer-events: none;
  }
  .m-bottomnav-icon,
  .m-bottomnav-label {
    position: relative;
  }

  /* Fixed 22px slot, vertically centered, so every icon shares one baseline
     regardless of its artwork's bounds within the viewBox. flex-shrink:0 keeps
     them from squashing in narrow cells. */
  .m-bottomnav-icon {
    width: 22px;
    height: 22px;
    flex: 0 0 22px;
    display: block;
  }

  .m-bottomnav-label {
    line-height: 1;
    letter-spacing: 0.05em;
  }
</style>
