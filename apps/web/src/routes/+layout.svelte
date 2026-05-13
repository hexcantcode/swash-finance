<script lang="ts">
  import '../app.css';
  import { tick } from 'svelte';
  import { page } from '$app/stores';
  import { goto } from '$app/navigation';

  let { children } = $props();

  const path = $derived($page.url.pathname);
  const tradersActive = $derived(path === '/' || path.startsWith('/trader'));
  const assetsActive = $derived(path.startsWith('/assets'));

  let searchInput = $state($page.url.searchParams.get('search') ?? '');
  let searchExpanded = $state(($page.url.searchParams.get('search') ?? '') !== '');
  let searchInputEl: HTMLInputElement | undefined;

  $effect(() => {
    searchInput = $page.url.searchParams.get('search') ?? '';
    if (searchInput) searchExpanded = true;
  });

  async function openSearch() {
    searchExpanded = true;
    await tick();
    searchInputEl?.focus();
  }

  function runSearch() {
    const q = searchInput.trim();
    goto(q ? `/?search=${encodeURIComponent(q)}` : '/');
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
      searchInputEl?.blur();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      runSearch();
    }
  }

  function connectWallet() {
    // TODO: wire to wallet provider
    console.log('connect wallet — TODO');
  }
</script>

<svelte:head>
  <title>Swash — The right traders. Mirrored to your wallet.</title>
  <meta
    name="description"
    content="Curated, behaviorally classified, statistically corrected leaderboard of the most credible traders on Hyperliquid."
  />
</svelte:head>

<div class="bg-glow"></div>
<div class="bg-grid"></div>

<div class="bg-noise stripe-app relative z-10">
  <a href="#main-content" class="skip-link">Skip to main content</a>

  <header class="k-topnav" aria-label="Primary">
    <a href="/" class="k-topnav-brand" aria-label="Swash — home">
      <img src="/logoicon.png" alt="" class="k-topnav-logo" aria-hidden="true" />
    </a>
    <nav class="k-topnav-links" aria-label="Sections">
      <a
        href="/"
        class="k-topnav-link"
        class:is-active={tradersActive}
        aria-current={tradersActive ? 'page' : undefined}
      >
        Traders
      </a>
      <a
        href="/assets"
        class="k-topnav-link"
        class:is-active={assetsActive}
        aria-current={assetsActive ? 'page' : undefined}
      >
        Assets
      </a>
    </nav>
    <div class="k-topnav-right">
      <div
        class="k-topnav-search-form"
        class:is-expanded={searchExpanded}
        class:is-collapsed={!searchExpanded}
        role="search"
      >
        <input
          bind:this={searchInputEl}
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
          <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="pointer-events: none; display: block">
            <circle cx="11" cy="11" r="8" />
            <path d="m21 21-4.3-4.3" />
          </svg>
        </button>
      </div>
      <button type="button" class="k-connect-wallet" onclick={connectWallet}>
        Connect Wallet
      </button>
    </div>
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
        <a href="/" class="k-site-footer-link">Leaderboard</a>
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
</div>
