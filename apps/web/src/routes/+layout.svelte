<script lang="ts">
  import '../app.css';
  import { page } from '$app/stores';

  let { children } = $props();

  const links = [
    {
      href: '/',
      label: 'traders',
      match: (p: string) => p === '/' || p.startsWith('/browse') || p.startsWith('/trader'),
    },
    {
      href: '/methodology',
      label: 'methodology',
      match: (p: string) => p.startsWith('/methodology'),
    },
    { href: '/about', label: 'about', match: (p: string) => p.startsWith('/about') },
  ];
</script>

<svelte:head>
  <title>Swish — hyperliquid trader leaderboard</title>
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
    <a href="/" class="k-topnav-brand">
      <img src="/swish.svg" alt="" class="k-topnav-logo" aria-hidden="true" />
      <span>Swish</span>
    </a>
    <nav class="k-topnav-links">
      {#each links as link (link.href)}
        {@const active = link.match($page.url.pathname)}
        <a
          href={link.href}
          class="k-topnav-link"
          class:is-active={active}
          aria-current={active ? 'page' : undefined}
        >
          {link.label}
        </a>
      {/each}
    </nav>
  </header>

  {@render children?.()}
</div>
