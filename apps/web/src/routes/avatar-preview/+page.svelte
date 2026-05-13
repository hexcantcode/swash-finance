<script lang="ts">
  // Temporary route for comparing trader-avatar generators side-by-side.
  // Open http://localhost:5173/avatar-preview while `pnpm dev` is running.
  // Not linked from anywhere — safe to delete once a style is picked.

  import { effigyUrl } from '$lib/utils/format';

  // A spread of real-ish hex addresses so each generator gets distinct seeds.
  const SAMPLES = [
    '0xf3f496c9486be5924a93d67e98298733bb47057c',
    '0x4d8b76f5ee52f4dffba8b8b87f04b1adf3a44a23',
    '0x9af33b5dae15a64f6f60b5f5c8a0e5b6c3acdee2',
    '0x71c7656ec7ab88b098defb751b7401b5f6d8976f',
    '0xab5801a7d398351b8be11c439e05c5b3259aec9b',
    '0x0000000000000000000000000000000000000001',
  ];

  // Boring-Avatars hosted endpoint pattern (path: variant / size / seed).
  function boringUrl(variant: string, seed: string, size = 64): string {
    return `https://source.boringavatars.com/${variant}/${size}/${encodeURIComponent(seed)}`;
  }

  // DiceBear hosted endpoint for cross-comparison (a few styles).
  function dicebearUrl(style: string, seed: string): string {
    return `https://api.dicebear.com/9.x/${style}/svg?seed=${encodeURIComponent(seed.toLowerCase())}`;
  }

  const BORING_VARIANTS = ['marble', 'beam', 'pixel', 'sunset', 'ring', 'bauhaus'];
  const DICEBEAR_STYLES = ['identicon', 'shapes', 'thumbs', 'pixel-art', 'bottts', 'rings'];

  // Render at a few sizes since usage is mixed: 20px (mini-tables), 24px
  // (leaderboard rows), 64px (trader profile header).
  const SIZES = [20, 24, 64];
</script>

<svelte:head>
  <title>Avatar preview — Swash</title>
</svelte:head>

<main class="wrap">
  <h1>Avatar generator preview</h1>
  <p class="hint">
    Each row is one wallet address. Columns are different generators / styles. Pick the one you
    like and tell me — I'll swap <code>effigyUrl()</code> in
    <code>src/lib/utils/format.ts</code>.
  </p>

  <h2>Currently in production: <code>dicebear / identicon</code></h2>
  <div class="row head">
    <span class="addr">address</span>
    {#each SIZES as s}<span class="cell" style="width: {s + 12}px">{s}px</span>{/each}
  </div>
  {#each SAMPLES as addr}
    <div class="row">
      <span class="addr">{addr.slice(0, 10)}…{addr.slice(-4)}</span>
      {#each SIZES as s}
        <span class="cell" style="width: {s + 12}px">
          <img src={effigyUrl(addr)} alt="" width={s} height={s} class="av" />
        </span>
      {/each}
    </div>
  {/each}

  <h2>Boring Avatars</h2>
  <p class="hint">via <code>source.boringavatars.com/&lt;variant&gt;/&lt;size&gt;/&lt;seed&gt;</code></p>
  <div class="row head">
    <span class="addr">address</span>
    {#each BORING_VARIANTS as v}<span class="cell">{v}</span>{/each}
  </div>
  {#each SAMPLES as addr}
    <div class="row">
      <span class="addr">{addr.slice(0, 10)}…{addr.slice(-4)}</span>
      {#each BORING_VARIANTS as v}
        <span class="cell">
          <img src={boringUrl(v, addr)} alt="" width="48" height="48" class="av" />
        </span>
      {/each}
    </div>
  {/each}

  <h2>DiceBear other styles (for comparison)</h2>
  <p class="hint">via <code>api.dicebear.com/9.x/&lt;style&gt;/svg?seed=&lt;addr&gt;</code></p>
  <div class="row head">
    <span class="addr">address</span>
    {#each DICEBEAR_STYLES as s}<span class="cell">{s}</span>{/each}
  </div>
  {#each SAMPLES as addr}
    <div class="row">
      <span class="addr">{addr.slice(0, 10)}…{addr.slice(-4)}</span>
      {#each DICEBEAR_STYLES as s}
        <span class="cell">
          <img src={dicebearUrl(s, addr)} alt="" width="48" height="48" class="av" />
        </span>
      {/each}
    </div>
  {/each}
</main>

<style>
  .wrap {
    max-width: 1100px;
    margin: 0 auto;
    padding: 48px var(--space-6);
  }
  h1 {
    font-size: 24px;
    margin-bottom: 8px;
  }
  h2 {
    font-size: 16px;
    margin: 32px 0 8px;
    color: var(--stripe-text-secondary);
  }
  .hint {
    font-size: 12px;
    color: var(--stripe-text-tertiary);
    margin-bottom: 16px;
  }
  code {
    font-family: var(--font-mono);
    font-size: 11px;
    padding: 1px 4px;
    border-radius: 3px;
    background: rgba(255, 255, 255, 0.05);
  }
  .row {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 8px 0;
    border-bottom: 0.5px solid var(--stripe-border);
  }
  .row.head {
    color: var(--stripe-text-tertiary);
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .addr {
    flex: 0 0 180px;
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--stripe-text-secondary);
  }
  .cell {
    flex: 1;
    display: inline-flex;
    align-items: center;
    justify-content: flex-start;
    gap: 8px;
  }
  .av {
    border-radius: 50%;
    background: var(--stripe-bg-tertiary);
    object-fit: cover;
  }
</style>
