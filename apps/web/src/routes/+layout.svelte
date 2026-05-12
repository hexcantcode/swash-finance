<script lang="ts">
  import '../app.css';
  import { page } from '$app/stores';
  import { goto } from '$app/navigation';

  let { children } = $props();

  let searchInput = $state($page.url.searchParams.get('search') ?? '');
  // Keep the box in sync with the URL after navigation.
  $effect(() => {
    searchInput = $page.url.searchParams.get('search') ?? '';
  });

  function submitSearch(e: Event) {
    e.preventDefault();
    const q = searchInput.trim();
    goto(q ? `/?search=${encodeURIComponent(q)}` : '/');
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
    <form class="k-topnav-search-form" role="search" onsubmit={submitSearch}>
      <input
        type="search"
        bind:value={searchInput}
        placeholder="search address 0x…"
        aria-label="Search trader address"
        class="k-filter-search"
      />
    </form>
  </header>

  {@render children?.()}
</div>
