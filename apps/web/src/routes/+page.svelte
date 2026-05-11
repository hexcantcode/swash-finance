<script lang="ts">
  import LeaderTable from '$lib/components/LeaderTable.svelte';
  import TradeTicker from '$lib/components/TradeTicker.svelte';
  import WeeklyRoiTable from '$lib/components/WeeklyRoiTable.svelte';
  import type { PageData } from './$types';

  interface Props {
    data: PageData;
  }
  let { data }: Props = $props();

  const lastUpdated = $derived(
    data.stats.leaders_scored > 0
      ? new Date().toLocaleString(undefined, {
          month: 'short',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
        })
      : 'never',
  );
</script>

<svelte:head>
  <title>Swish — hyperliquid trader leaderboard</title>
</svelte:head>

<main id="main-content" class="stripe-content">
  <header class="k-hero">
    <span class="k-hero-eyebrow">v0.5 · Discovery preview</span>
    <h1 class="k-hero-title">
      Hyperliquid leaders,<br />
      <span class="accent">behaviorally classified</span>.
    </h1>
    <p class="k-hero-sub">
      Every active trader on Hyperliquid, ranked by probabilistic Sharpe deflated for selection
      bias — not just what they returned.
    </p>
    <div class="k-hero-cta">
      <a href="/browse" class="btn-poly btn-cream">Browse all leaders</a>
      <a href="/methodology" class="btn-poly">How scoring works</a>
    </div>
  </header>

  <section class="k-trader-section" style="margin-top: 0;">
    <TradeTicker trades={data.recentTrades} />
  </section>

  <section class="k-trader-section">
    <div class="k-section-head">
      <h2 class="k-section-title">
        Top scored — {data.topLeaders.length} of {data.stats.leaders_scored.toLocaleString()}
      </h2>
      <a href="/browse" class="btn-poly">See all →</a>
    </div>

    {#if data.topLeaders.length === 0}
      <div class="stripe-empty">
        <div class="stripe-empty-title">no scored leaders yet</div>
        <p class="stripe-empty-text">
          Run <code>pnpm bootstrap &amp;&amp; pnpm score</code> to populate.
        </p>
      </div>
    {:else}
      <LeaderTable rows={data.topLeaders} />
    {/if}
  </section>

  <section class="k-trader-section">
    <div class="k-section-head">
      <h2 class="k-section-title">Top 7d ROI — {data.weeklyRoi.length}</h2>
      <span class="stripe-text-tertiary stripe-body-sm">
        per Hyperliquid's official 7d window
      </span>
    </div>

    {#if data.weeklyRoi.length === 0}
      <div class="stripe-empty">
        <div class="stripe-empty-title">no 7d data yet</div>
        <p class="stripe-empty-text">
          Run <code>pnpm leaderboard</code> to fetch HL leaderboard.
        </p>
      </div>
    {:else}
      <WeeklyRoiTable rows={data.weeklyRoi} />
    {/if}
  </section>

  <p class="k-universe-note">
    <span class="k-universe-count">{data.stats.wallets_total.toLocaleString()}</span> wallets observed
  </p>
</main>

<footer class="k-site-footer">
  <div class="k-site-footer-top">
    <div class="k-site-footer-brand">
      <div class="k-site-footer-brand-row">
        <img src="/swish.svg" alt="" />
        <span class="k-site-footer-brand-name">Swish</span>
      </div>
      <p class="k-site-footer-tagline">
        A behaviorally classified leaderboard for Hyperliquid traders.
      </p>
    </div>

    <div class="k-site-footer-col">
      <h3 class="k-site-footer-col-title">Product</h3>
      <a href="/" class="k-site-footer-link">Leaderboard</a>
      <a href="/browse" class="k-site-footer-link">Browse all</a>
    </div>

    <div class="k-site-footer-col">
      <h3 class="k-site-footer-col-title">Resources</h3>
      <a href="/methodology" class="k-site-footer-link">Methodology</a>
      <a href="/about" class="k-site-footer-link">About</a>
    </div>
  </div>

  <div class="k-site-footer-bottom">
    <span>© 2026 Swish · v0.5 discovery preview</span>
    <span class="k-site-footer-meta">
      Updated {lastUpdated} · {data.stats.leaders_scored.toLocaleString()} scored
    </span>
  </div>
</footer>
