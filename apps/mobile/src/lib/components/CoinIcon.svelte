<script lang="ts">
  // Canonical coin-icon renderer. Sits inside a caller-styled disc wrapper
  // (fixed size + overflow:hidden) and fills it. Owns the icon treatment that
  // used to be duplicated at every call-site: iconBg/white-bg discs, padding,
  // and — the reason this exists — a graceful fallback when the logo 404s
  // (many HIP-3 `xyz:` stock tickers have no CDN logo). On error we swap the
  // broken <img> for an initials tile instead of the browser's broken glyph.
  import { coinDisplayName, coinIconUrl, coinIconBg, coinNeedsWhiteBg } from '$lib/utils/coin';

  interface Props {
    coin: string;
    /** Padding when the logo sits on a branded disc (coinIconBg). Small discs
        pass a tighter value; ignored for plain/white icons. Default 4px. */
    padding?: string;
    /** Skip lazy-loading for above-the-fold icons (e.g. the asset hero). */
    eager?: boolean;
  }
  let { coin, padding = '4px', eager = false }: Props = $props();

  const src = $derived(coinIconUrl(coin));
  const bg = $derived(coinIconBg(coin));
  const white = $derived(coinNeedsWhiteBg(coin));
  const initials = $derived(coinDisplayName(coin).slice(0, 2));

  let failed = $state(false);
  // Reset when the coin changes — instances are reused across list rows.
  $effect(() => {
    void coin;
    failed = false;
  });
</script>

{#if failed}
  <span class="cn-fallback">{initials}</span>
{:else}
  <img
    class="cn-img"
    class:is-white={white}
    {src}
    style:background-color={bg}
    style:padding={bg ? padding : null}
    loading={eager ? null : 'lazy'}
    alt=""
    onerror={() => (failed = true)}
  />
{/if}

<style>
  .cn-img,
  .cn-fallback {
    display: block;
    width: 100%;
    height: 100%;
    object-fit: cover;
    border-radius: inherit;
    box-sizing: border-box;
  }
  .cn-img.is-white {
    background: #fff;
  }
  .cn-fallback {
    display: grid;
    place-items: center;
    object-fit: unset;
    font-family: var(--font-mono);
    font-weight: 600;
    font-size: 0.7rem;
    line-height: 1;
    text-transform: uppercase;
    color: var(--stripe-text-tertiary);
    background: var(--stripe-bg-secondary);
  }
</style>
