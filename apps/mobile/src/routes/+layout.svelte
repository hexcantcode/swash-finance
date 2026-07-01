<script lang="ts">
  import '../app.css';
  import { onMount } from 'svelte';
  import { page } from '$app/stores';
  import MobileAppSheets from '$lib/components/MobileAppSheets.svelte';
  import { initNative } from '$lib/native';

  let { children } = $props();

  // The brand header stays put at the top but fades out as you scroll into
  // content, fading back in near the top. Scroll-linked opacity (1:1 with
  // position, no lag) rather than a CSS scroll-timeline, which WKWebView on
  // iOS doesn't support yet.
  let headerEl: HTMLElement | null = null;
  const FADE_OVER = 72; // px of scroll to go fully transparent

  onMount(() => {
    // Native-only chrome (status bar etc.); no-op in the browser/PWA.
    void initNative();

    const onScroll = () => {
      const f = Math.max(0, Math.min(1, 1 - window.scrollY / FADE_OVER));
      if (!headerEl) return;
      headerEl.style.opacity = String(f);
      headerEl.style.transform = `translateY(${(f - 1) * 6}px)`;
      headerEl.style.pointerEvents = f < 0.05 ? 'none' : '';
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener('scroll', onScroll);
  });

  const path = $derived($page.url.pathname);
  // Markets is the home now (`/` redirects to /assets). Light it for the root
  // path too so the brand-logo home link reads as active during the redirect.
  const assetsActive = $derived(path === '/' || path.startsWith('/assets'));
  const vaultsActive = $derived(path.startsWith('/vaults'));
  const feedActive = $derived(path.startsWith('/feed'));
  const profileActive = $derived(path.startsWith('/profile'));

  // Bottom-nav icons. Inline SVG paths so we avoid the icon-library import
  // (and the Capacitor bundle ships fewer bytes).
  const ICON_PROFILE = 'M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2 M16 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0';
  // Markets = exchange arrows (Lucide arrow-right-left).
  const ICON_MARKETS = 'M16 3l4 4-4 4 M20 7H4 M8 21l-4-4 4-4 M4 17h16';
  // Vaults = a safe: outer box + centered dial circle.
  const ICON_VAULTS =
    'M5 4h14a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0z';
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

  <header class="m-header safe-top safe-x" aria-label="App header" bind:this={headerEl}>
    <a href="/" class="m-header-brand" aria-label="Swash — home">
      <img class="m-header-brand-icon" src="/logoicon.png" alt="" aria-hidden="true" />
      <span class="m-header-brand-text">swash</span>
    </a>
  </header>

  {@render children?.()}

  <MobileAppSheets />

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
          <path d={ICON_MARKETS} />
        </svg>
        <span class="m-bottomnav-label">Markets</span>
      </a>
      <a
        href="/vaults"
        class="m-bottomnav-item tappable"
        class:is-active={vaultsActive}
        aria-current={vaultsActive ? 'page' : undefined}
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
          <path d={ICON_VAULTS} />
        </svg>
        <span class="m-bottomnav-label">Vaults</span>
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
    min-height: 44px;
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
       Pill bottom is safe-bottom + --space-3; pill height is 56px. */
    bottom: calc(var(--safe-bottom) + var(--space-3) + 56px);
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
    /* Transparent frosted glass — the same material tokens as the header, so
       top and bottom chrome read as one system and the page shows through the
       pill instead of being hidden behind a milky white fill. The blur does
       the frosting; the low-opacity tint keeps it see-through. Theme-aware,
       and auto-collapses to a solid surface under prefers-reduced-transparency
       (the tokens swap themselves — no per-selector override needed here). */
    background: var(--glass-bg-thin);
    -webkit-backdrop-filter: var(--glass-blur-thin);
    backdrop-filter: var(--glass-blur-thin);
    border-radius: var(--radius-xl);
    box-shadow:
      var(--shadow-lg),
      var(--glass-highlight),
      inset 0 0 0 0.5px var(--stripe-border-light);
    overflow: hidden;
    z-index: 20;
  }

  /* Specular sheen — a faint top-edge highlight so the pill still reads as a
     curved glass surface catching light. Kept subtle (was a strong white wash)
     so it doesn't re-opaque the now-transparent material. Sits between the
     backdrop and the nav items. */
  .m-bottomnav::before {
    content: '';
    position: absolute;
    inset: 0;
    pointer-events: none;
    border-radius: inherit;
    background: linear-gradient(
      180deg,
      rgba(255, 255, 255, 0.1) 0%,
      transparent 45%
    );
    z-index: 0;
  }

  /* Sits above the .m-bottomnav::before specular layer so icons/labels
     aren't washed out by the highlight gradient. */
  .m-bottomnav-inner {
    position: relative;
    z-index: 1;
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    height: 56px;
  }

  .m-bottomnav-item {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 5px;
    /* Brand teal; inactive tabs sit at reduced strength, the active tab goes
       full (plus its recessed pill). Icons inherit via stroke="currentColor". */
    color: color-mix(in srgb, var(--nav-fg) 60%, transparent);
    text-decoration: none;
    font-family: var(--font-sans);
    /* Sentence-case labels — slightly larger than the old all-caps 10px so
       lowercase letterforms stay legible at a glance. */
    font-size: 11px;
    font-weight: 500;
    letter-spacing: 0.01em;
    min-height: var(--touch-min);
  }

  .m-bottomnav-item {
    position: relative;
    transition: color var(--motion-fast) var(--motion-ease);
  }

  .m-bottomnav-item.is-active {
    color: var(--nav-fg);
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
  }
</style>
