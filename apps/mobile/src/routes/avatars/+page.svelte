<script lang="ts">
  import { onMount } from 'svelte';

  // Throwaway showcase: compare open-source avatar packs seeded by a wallet
  // address. DiceBear styles render via its HTTP API; the wallet-classic
  // generators + boring-avatars are pulled from esm.sh at runtime, so nothing
  // is added to the repo's dependencies.

  const baseSeeds = [
    '0x71C7656EC7ab88b098defB751B7401B5f6d8976F',
    '0xAb5801a7D398351b8bE11C439e05C5B3259aeC9B',
    '0xde0B295669a9FD93d5F28D9Ec85E40f4cb697BAe',
    'vitalik.eth',
  ];

  let custom = $state('');
  const seeds = $derived(custom.trim() ? [custom.trim(), ...baseSeeds] : baseSeeds);

  function short(s: string) {
    return s.startsWith('0x') && s.length > 14 ? `${s.slice(0, 6)}…${s.slice(-4)}` : s;
  }

  // DiceBear v9 HTTP API — one <img> per style/seed, no JS dep.
  const dicebearStyles = [
    'pixel-art', 'bottts', 'identicon', 'shapes', 'rings', 'thumbs',
    'fun-emoji', 'glass', 'notionists', 'avataaars', 'lorelei', 'micah',
    'adventurer', 'big-smile', 'open-peeps', 'personas', 'miniavs',
    'croodles', 'big-ears', 'icons', 'initials', 'bottts-neutral',
  ];
  function dicebear(style: string, seed: string) {
    return `https://api.dicebear.com/9.x/${style}/svg?seed=${encodeURIComponent(seed)}&size=72`;
  }

  const boringVariants = ['marble', 'beam', 'pixel', 'sunset', 'ring', 'bauhaus'];

  // CDN-loaded generators (populated in onMount). Kept in $state so the markup
  // re-renders once they resolve.
  let gens = $state<{
    multi: ((s: string) => string) | null;
    mini: ((s: string) => string) | null;
    blockie: ((s: string) => string) | null;
    jazz: ((d: number, seed: number) => HTMLElement) | null;
    boring: ((seed: string, variant: string) => string) | null;
  }>({ multi: null, mini: null, blockie: null, jazz: null, boring: null });

  let cdnError = $state(false);

  function seedInt(s: string) {
    if (s.startsWith('0x') && s.length >= 10) return parseInt(s.slice(2, 10), 16);
    let h = 0;
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    return h;
  }

  // Svelte action — jazzicon returns a DOM element, so append it directly.
  function jazz(node: HTMLElement, [seed, fn]: [string, typeof gens.jazz]) {
    const render = (s: string, f: typeof gens.jazz) => {
      node.innerHTML = '';
      if (f) node.appendChild(f(56, seedInt(s)));
    };
    render(seed, fn);
    return {
      update([s, f]: [string, typeof gens.jazz]) {
        render(s, f);
      },
    };
  }

  onMount(async () => {
    const results = await Promise.allSettled([
      import(/* @vite-ignore */ 'https://esm.sh/@multiavatar/multiavatar@8'),
      import(/* @vite-ignore */ 'https://esm.sh/minidenticons@4'),
      import(/* @vite-ignore */ 'https://esm.sh/ethereum-blockies-base64@1'),
      import(/* @vite-ignore */ 'https://esm.sh/@metamask/jazzicon@2'),
      import(/* @vite-ignore */ 'https://esm.sh/react@18'),
      import(/* @vite-ignore */ 'https://esm.sh/react-dom@18/server'),
      import(/* @vite-ignore */ 'https://esm.sh/boring-avatars@1'),
    ]);

    const [multiR, miniR, blockieR, jazzR, reactR, rdsR, boringR] = results;
    if (results.some((r) => r.status === 'rejected')) cdnError = true;

    if (multiR.status === 'fulfilled') gens.multi = multiR.value.default;
    if (miniR.status === 'fulfilled') gens.mini = miniR.value.minidenticonSvg;
    if (blockieR.status === 'fulfilled') gens.blockie = blockieR.value.default;
    if (jazzR.status === 'fulfilled') gens.jazz = jazzR.value.default;

    if (
      reactR.status === 'fulfilled' &&
      rdsR.status === 'fulfilled' &&
      boringR.status === 'fulfilled'
    ) {
      const React = reactR.value.default;
      const renderToStaticMarkup = rdsR.value.renderToStaticMarkup;
      const Avatar = boringR.value.default ?? boringR.value.Avatar;
      gens.boring = (seed, variant) =>
        renderToStaticMarkup(React.createElement(Avatar, { size: 56, name: seed, variant }));
    }
  });
</script>

<svelte:head>
  <title>Avatar packs · Swash</title>
</svelte:head>

<main id="main-content" class="m-page safe-x">
  <header class="head">
    <h1>Avatar packs</h1>
    <p class="sub">
      Open-source avatar generators, each seeded by a wallet address. All are MIT / CC0 /
      permissively licensed — verify the exact license on each repo before shipping.
    </p>
    <input
      class="seed-input"
      type="text"
      placeholder="Type a custom address or name…"
      bind:value={custom}
      spellcheck="false"
      autocapitalize="off"
    />
    <div class="seed-legend">
      {#each seeds as s (s)}
        <span class="seed-chip">{short(s)}</span>
      {/each}
    </div>
    {#if cdnError}
      <p class="warn">Some CDN-loaded generators failed to load (network). DiceBear styles still work.</p>
    {/if}
  </header>

  <!-- Wallet-classic generators -->
  <section class="pack">
    <div class="pack-head">
      <h2>Jazzicon</h2><span class="lic">MIT · @metamask/jazzicon</span>
    </div>
    <div class="row">
      {#each seeds as s (s)}
        <div class="ava ava-jazz" use:jazz={[s, gens.jazz]} title={s}></div>
      {/each}
    </div>
  </section>

  <section class="pack">
    <div class="pack-head">
      <h2>Blockies</h2><span class="lic">MIT · ethereum-blockies-base64</span>
    </div>
    <div class="row">
      {#each seeds as s (s)}
        <div class="ava" title={s}>
          {#if gens.blockie}<img src={gens.blockie(s)} alt="" />{/if}
        </div>
      {/each}
    </div>
  </section>

  <section class="pack">
    <div class="pack-head">
      <h2>Minidenticons</h2><span class="lic">MIT · minidenticons</span>
    </div>
    <div class="row">
      {#each seeds as s (s)}
        <div class="ava" title={s}>
          {#if gens.mini}{@html gens.mini(s)}{/if}
        </div>
      {/each}
    </div>
  </section>

  <section class="pack">
    <div class="pack-head">
      <h2>Multiavatar</h2><span class="lic">@multiavatar/multiavatar</span>
    </div>
    <div class="row">
      {#each seeds as s (s)}
        <div class="ava" title={s}>
          {#if gens.multi}{@html gens.multi(s)}{/if}
        </div>
      {/each}
    </div>
  </section>

  <!-- Boring Avatars — one block per variant -->
  <section class="pack">
    <div class="pack-head">
      <h2>Boring Avatars</h2><span class="lic">MIT · boring-avatars</span>
    </div>
    {#each boringVariants as v (v)}
      <div class="sub-style">
        <span class="style-name">{v}</span>
        <div class="row">
          {#each seeds as s (s)}
            <div class="ava ava-round" title={`${s} · ${v}`}>
              {#if gens.boring}{@html gens.boring(s, v)}{/if}
            </div>
          {/each}
        </div>
      </div>
    {/each}
  </section>

  <!-- DiceBear styles via HTTP API -->
  <section class="pack">
    <div class="pack-head">
      <h2>DiceBear</h2><span class="lic">styles vary (MIT / CC0 / CC-BY)</span>
    </div>
    {#each dicebearStyles as style (style)}
      <div class="sub-style">
        <span class="style-name">{style}</span>
        <div class="row">
          {#each seeds as s (s)}
            <div class="ava" title={`${s} · ${style}`}>
              <img src={dicebear(style, s)} alt="" loading="lazy" />
            </div>
          {/each}
        </div>
      </div>
    {/each}
  </section>
</main>

<style>
  .m-page {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    padding-top: var(--space-4);
    padding-bottom: calc(var(--safe-bottom) + 80px);
  }

  .head h1 {
    font-family: var(--font-sans);
    font-size: var(--type-title);
    font-weight: 700;
    color: var(--stripe-text-primary);
    margin: 0 0 var(--space-2);
  }
  .sub {
    font-size: var(--type-caption);
    color: var(--stripe-text-tertiary);
    margin: 0 0 var(--space-3);
    line-height: 1.5;
  }
  .seed-input {
    width: 100%;
    height: 36px;
    padding: 0 12px;
    background: var(--glass-bg);
    -webkit-backdrop-filter: var(--glass-blur);
    backdrop-filter: var(--glass-blur);
    border: 0;
    border-radius: var(--radius-lg);
    box-shadow: var(--glass-highlight);
    color: var(--stripe-text-primary);
    font-family: var(--font-mono);
    font-size: var(--type-body);
  }
  .seed-input:focus {
    outline: none;
    background: var(--glass-pressed-bg);
    box-shadow: var(--glass-pressed-inset);
  }
  .seed-legend {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-top: var(--space-2);
  }
  .seed-chip {
    font-family: var(--font-mono);
    font-size: var(--type-caption);
    color: var(--stripe-text-tertiary);
    background: var(--glass-bg);
    padding: 3px 8px;
    border-radius: var(--radius-sm);
  }
  .warn {
    margin-top: var(--space-2);
    font-size: var(--type-caption);
    color: var(--stripe-danger);
  }

  .pack {
    background: var(--glass-bg);
    -webkit-backdrop-filter: var(--glass-blur);
    backdrop-filter: var(--glass-blur);
    box-shadow: var(--glass-highlight);
    border-radius: var(--radius-xl);
    padding: var(--space-3);
  }
  .pack-head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: var(--space-2);
    margin-bottom: var(--space-3);
  }
  .pack-head h2 {
    font-family: var(--font-sans);
    font-size: var(--type-headline);
    font-weight: 600;
    color: var(--stripe-text-primary);
    margin: 0;
  }
  .lic {
    font-family: var(--font-mono);
    font-size: 10px;
    color: var(--stripe-text-muted);
    text-align: right;
  }

  .sub-style + .sub-style {
    margin-top: var(--space-3);
    padding-top: var(--space-3);
    border-top: 1px solid var(--stripe-border);
  }
  .style-name {
    display: block;
    font-family: var(--font-mono);
    font-size: var(--type-caption);
    color: var(--stripe-text-tertiary);
    margin-bottom: 6px;
  }

  .row {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }
  .ava {
    width: 56px;
    height: 56px;
    border-radius: var(--radius-md);
    overflow: hidden;
    background: var(--stripe-bg-secondary);
    display: grid;
    place-items: center;
    flex: 0 0 auto;
  }
  .ava-round {
    border-radius: var(--radius-full);
  }
  .ava-jazz {
    background: transparent;
    border-radius: var(--radius-full);
  }
  .ava :global(img),
  .ava :global(svg) {
    width: 100%;
    height: 100%;
    display: block;
  }
  .ava-jazz :global(div) {
    border-radius: var(--radius-full);
  }
</style>
