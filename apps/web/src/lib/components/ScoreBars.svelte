<script lang="ts">
  interface Props {
    /** composite score 0..100, or null. */
    score: number | null;
  }
  let { score }: Props = $props();

  // Stable id (consistent SSR ↔ hydration) so the gradient defs don't collide.
  const uid = $props.id();

  const BARS = 10;
  // One lit bar per 10 score points.
  const lit = $derived(
    score == null ? 0 : Math.round(Math.max(0, Math.min(100, score)) / 10),
  );

  const BAR_W = 2;
  const GAP = 1.5;
  const H = 12;
  const W = BARS * BAR_W + (BARS - 1) * GAP; // 33.5
  const barX = (i: number) => i * (BAR_W + GAP);
</script>

<svg
  class="k-score-bars"
  viewBox="0 0 {W} {H}"
  width={W}
  height={H}
  role="img"
  aria-label="Score {score ?? 'n/a'} of 100"
>
  <defs>
    <linearGradient id="scoreBars-{uid}" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2={W} y2="0">
      <stop offset="0%" stop-color="#ffffff" />
      <stop offset="100%" stop-color="var(--stripe-accent)" />
    </linearGradient>
  </defs>
  {#each Array(BARS) as _, i}
    <rect
      x={barX(i)}
      y="0"
      width={BAR_W}
      height={H}
      rx="0.5"
      fill={i < lit ? `url(#scoreBars-${uid})` : 'rgba(255, 255, 255, 0.1)'}
    />
  {/each}
</svg>
