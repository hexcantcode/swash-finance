<script lang="ts">
  // Vaults — placeholder. Wired into the bottom nav + routing; real content
  // lands once there's a spec. Matches the app's deep-ocean glass language.
  const ICON_VAULTS =
    'M5 4h14a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0z';
</script>

<svelte:head>
  <title>Vaults — Swash</title>
</svelte:head>

<main id="main-content" class="m-page">
  <section class="m-vaults safe-x" aria-label="Vaults">
    <span class="m-vaults-badge" aria-hidden="true">
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="1.5"
        stroke-linecap="round"
        stroke-linejoin="round"
      >
        <path d={ICON_VAULTS} />
      </svg>
    </span>
    <h1 class="m-vaults-title">Vaults</h1>
    <p class="m-vaults-blurb">Swash vaults are coming soon.</p>
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

  .m-vaults {
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
    gap: var(--space-3);
    padding-top: var(--space-8);
  }

  .m-vaults-badge {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 64px;
    height: 64px;
    border-radius: var(--radius-xl);
    background: var(--glass-bg);
    -webkit-backdrop-filter: var(--glass-blur);
    backdrop-filter: var(--glass-blur);
    box-shadow: var(--glass-highlight), var(--glass-shadow);
    color: var(--stripe-text-secondary);
  }
  .m-vaults-badge svg {
    width: 30px;
    height: 30px;
  }

  .m-vaults-title {
    margin: var(--space-2) 0 0;
    font-family: var(--font-sans);
    font-size: var(--type-title);
    font-weight: 700;
    color: var(--stripe-text-primary);
  }

  .m-vaults-blurb {
    max-width: 32ch;
    margin: 0;
    font-size: var(--type-subhead);
    line-height: 1.6;
    color: var(--stripe-text-secondary);
  }
</style>
