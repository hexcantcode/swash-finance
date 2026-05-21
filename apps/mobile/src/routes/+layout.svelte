<script lang="ts">
  import '../app.css';
  import { page } from '$app/stores';

  let { children } = $props();

  const path = $derived($page.url.pathname);
  const homeActive = $derived(path === '/');
  const tradersActive = $derived(path.startsWith('/trader'));
  const assetsActive = $derived(path.startsWith('/assets'));
  const feedActive = $derived(path.startsWith('/feed'));

  // Bottom-nav icons. Inline SVG paths so we avoid the icon-library import
  // (and the Capacitor bundle ships fewer bytes).
  const ICON_HOME = 'm3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z M9 22V12h6v10';
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
      <img src="/logotext.png" alt="" aria-hidden="true" />
    </a>
  </header>

  {@render children?.()}

  <nav class="m-bottomnav safe-bottom" aria-label="Primary navigation">
    <div class="m-bottomnav-inner">
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
    padding-top: max(var(--safe-top), var(--space-2));
    padding-bottom: var(--space-2);
    background: var(--glass-bg-strong);
    -webkit-backdrop-filter: var(--glass-blur);
    backdrop-filter: var(--glass-blur);
    border-bottom: 1px solid var(--stripe-border);
    box-shadow: var(--glass-highlight);
    position: sticky;
    top: 0;
    z-index: 20;
  }

  .m-header-brand img {
    height: 22px;
    width: auto;
    display: block;
  }

  /* Bottom navigation — sticks to the bottom safe-area, never scrolls. */
  .m-bottomnav {
    position: fixed;
    bottom: 0;
    left: 0;
    right: 0;
    background: var(--glass-bg-strong);
    -webkit-backdrop-filter: var(--glass-blur);
    backdrop-filter: var(--glass-blur);
    border-top: 1px solid var(--stripe-border);
    box-shadow: var(--glass-highlight);
    padding-bottom: var(--safe-bottom);
    z-index: 20;
  }

  .m-bottomnav-inner {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    height: 56px;
  }

  .m-bottomnav-item {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 2px;
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

  /* Active tab gets a short teal indicator bar at the top edge + an icon glow. */
  .m-bottomnav-item.is-active::before {
    content: '';
    position: absolute;
    top: 0;
    left: 50%;
    transform: translateX(-50%);
    width: 28px;
    height: 2px;
    border-radius: var(--radius-full);
    background: var(--stripe-accent);
    box-shadow: 0 0 10px rgba(106, 220, 197, 0.6);
  }

  .m-bottomnav-item.is-active .m-bottomnav-icon {
    filter: drop-shadow(0 0 6px rgba(106, 220, 197, 0.45));
  }

  .m-bottomnav-icon {
    width: 20px;
    height: 20px;
  }

  .m-bottomnav-label {
    line-height: 1;
  }
</style>
