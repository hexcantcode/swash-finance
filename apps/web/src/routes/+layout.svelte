<script lang="ts">
  import '../app.css';
  import { tick } from 'svelte';
  import { page } from '$app/stores';
  import { goto } from '$app/navigation';

  let { children } = $props();

  const path = $derived($page.url.pathname);
  // `/traders` (plural) = leaderboard; `/trader/<address>` (singular) = profile.
  // `path.startsWith('/trader')` catches both.
  const tradersActive = $derived(path.startsWith('/trader'));
  const assetsActive = $derived(path.startsWith('/assets'));
  const analyticsActive = $derived(path.startsWith('/analytics'));

  let searchInput = $state($page.url.searchParams.get('search') ?? '');
  let searchExpanded = $state(($page.url.searchParams.get('search') ?? '') !== '');

  $effect(() => {
    searchInput = $page.url.searchParams.get('search') ?? '';
    if (searchInput) searchExpanded = true;
  });

  async function openSearch() {
    searchExpanded = true;
    await tick();
    // Two search inputs exist (mobile header + desktop topbar); CSS hides one.
    // `offsetParent === null` when the element is in a `display: none` subtree,
    // so we focus the one currently visible.
    const inputs = document.querySelectorAll<HTMLInputElement>('.k-topnav-search-input');
    for (const el of inputs) {
      if (el.offsetParent !== null) {
        el.focus();
        break;
      }
    }
  }

  function runSearch() {
    // Search is the leaderboard's address filter, so it always targets
    // `/traders`. Empty query strips back to the bare leaderboard page.
    const q = searchInput.trim();
    goto(q ? `/traders?search=${encodeURIComponent(q)}` : '/traders');
  }

  function onToggleClick() {
    if (searchExpanded) runSearch();
    else openSearch();
  }

  function onSearchBlur() {
    if (!searchInput.trim()) searchExpanded = false;
  }

  function onSearchKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      searchInput = '';
      searchExpanded = false;
      (e.currentTarget as HTMLInputElement | null)?.blur();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      runSearch();
    }
  }

  function connectWallet() {
    // TODO: wire to wallet provider
    console.log('connect wallet — TODO');
  }

  // Bottom-nav icons (mobile only). The desktop sidebar is text-only.
  const ICON_TRADERS =
    'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2 M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0 M22 21v-2a4 4 0 0 0-3-3.87 M16 3.13a4 4 0 0 1 0 7.75';
  const ICON_ASSETS = 'M3 3v18h18 M18 17V9 M13 17V5 M8 17v-3';
  // 4x4 dot grid — fits the "matrix" mental model in the analytics page.
  const ICON_ANALYTICS =
    'M5 5h.01 M10 5h.01 M15 5h.01 M19 5h.01 M5 10h.01 M10 10h.01 M15 10h.01 M19 10h.01 M5 15h.01 M10 15h.01 M15 15h.01 M19 15h.01 M5 19h.01 M10 19h.01 M15 19h.01 M19 19h.01';
</script>

<svelte:head>
  <title>Swash — The right traders. Mirrored to your wallet.</title>
  <meta
    name="description"
    content="Curated, behaviorally classified, statistically corrected leaderboard of the most credible traders on Hyperliquid."
  />
</svelte:head>

{#snippet searchForm()}
  <div
    class="k-topnav-search-form"
    class:is-expanded={searchExpanded}
    class:is-collapsed={!searchExpanded}
    role="search"
  >
    <input
      bind:value={searchInput}
      type="search"
      placeholder="search asset and address"
      aria-label="Search asset and address"
      class="k-topnav-search-input"
      tabindex={searchExpanded ? 0 : -1}
      onblur={onSearchBlur}
      onkeydown={onSearchKeydown}
    />
    <button
      type="button"
      class="k-topnav-search-toggle"
      aria-label={searchExpanded ? 'Search' : 'Open search'}
      aria-expanded={searchExpanded}
      onclick={onToggleClick}
    >
      <svg
        viewBox="2 2 20 20"
        width="18"
        height="18"
        aria-hidden="true"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
        style="pointer-events: none; display: block"
      >
        <circle cx="11" cy="11" r="8" />
        <path d="m21 21-4.3-4.3" />
      </svg>
    </button>
  </div>
{/snippet}

<div class="bg-glow"></div>
<div class="bg-grid"></div>

<div class="bg-noise stripe-app relative z-10">
  <a href="#main-content" class="skip-link">Skip to main content</a>

  <!-- Mobile header (visible < 1024px) -->
  <header class="k-mobile-header" aria-label="Primary mobile">
    <a href="/" class="k-mobile-header-brand" aria-label="Swash — home">
      <img src="/logotext.png" alt="" aria-hidden="true" />
    </a>
    <div class="k-mobile-header-right">
      {@render searchForm()}
      <button type="button" class="k-connect-wallet" onclick={connectWallet}>
        Connect Wallet
      </button>
    </div>
  </header>

  <!-- Sidebar (visible ≥ 1024px) -->
  <nav class="k-sidenav" aria-label="Primary">
    <a href="/" class="k-sidenav-brand" aria-label="Swash — home">
      <img src="/logotext.png" alt="" aria-hidden="true" />
    </a>
    <ul class="k-sidenav-items">
      <li>
        <a
          href="/assets"
          class="k-sidenav-item"
          class:is-active={assetsActive}
          aria-current={assetsActive ? 'page' : undefined}
        >
          Assets
        </a>
      </li>
      <li>
        <a
          href="/traders"
          class="k-sidenav-item"
          class:is-active={tradersActive}
          aria-current={tradersActive ? 'page' : undefined}
        >
          Traders
        </a>
      </li>
      <li>
        <a
          href="/analytics"
          class="k-sidenav-item"
          class:is-active={analyticsActive}
          aria-current={analyticsActive ? 'page' : undefined}
        >
          Analytics
        </a>
      </li>
    </ul>
  </nav>

  <!-- Top bar (visible ≥ 1024px) -->
  <header class="k-topbar" aria-label="Account and search">
    {@render searchForm()}
    <button type="button" class="k-connect-wallet" onclick={connectWallet}>
      Connect Wallet
    </button>
  </header>

  {@render children?.()}

  <footer class="k-site-footer">
    <div class="k-site-footer-top">
      <div class="k-site-footer-brand">
        <div class="k-site-footer-brand-row">
          <span class="k-site-footer-brand-name">Swash</span>
        </div>
        <p class="k-site-footer-tagline">The right traders. Mirrored to your wallet.</p>
        <span class="k-site-footer-copyright">© 2026 Swash</span>
      </div>

      <div class="k-site-footer-col">
        <h3 class="k-site-footer-col-title">Product</h3>
        <a href="/traders" class="k-site-footer-link">Leaderboard</a>
        <a href="/assets" class="k-site-footer-link">Assets</a>
      </div>

      <div class="k-site-footer-col">
        <h3 class="k-site-footer-col-title">Resources</h3>
        <a href="/methodology" class="k-site-footer-link">Methodology</a>
        <a href="/about" class="k-site-footer-link">About</a>
      </div>
    </div>

    <div class="k-site-footer-bottom"></div>
  </footer>

  <!-- Bottom nav (visible < 1024px) -->
  <nav class="k-bottomnav" aria-label="Primary mobile">
    <div class="k-bottomnav-inner">
      <a
        href="/assets"
        class="k-bottomnav-item"
        class:is-active={assetsActive}
        aria-current={assetsActive ? 'page' : undefined}
      >
        <svg class="k-bottomnav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d={ICON_ASSETS} />
        </svg>
        <span class="k-bottomnav-label">Assets</span>
      </a>
      <a
        href="/traders"
        class="k-bottomnav-item"
        class:is-active={tradersActive}
        aria-current={tradersActive ? 'page' : undefined}
      >
        <svg class="k-bottomnav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d={ICON_TRADERS} />
        </svg>
        <span class="k-bottomnav-label">Traders</span>
      </a>
      <a
        href="/analytics"
        class="k-bottomnav-item"
        class:is-active={analyticsActive}
        aria-current={analyticsActive ? 'page' : undefined}
      >
        <svg class="k-bottomnav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d={ICON_ANALYTICS} />
        </svg>
        <span class="k-bottomnav-label">Analytics</span>
      </a>
    </div>
  </nav>
</div>
