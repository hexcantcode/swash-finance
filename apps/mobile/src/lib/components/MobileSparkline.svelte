<script lang="ts">
  import type { Candle } from '$lib/api/asset-detail';

  interface Props {
    candles: Candle[];
    height?: number;
    /** Filled area below the line. Adds context without a y-axis. */
    fill?: boolean;
  }

  let { candles, height = 140, fill = true }: Props = $props();

  // Stretches to its container's width via viewBox preserveAspectRatio="none".
  // We pick 600 as a wide reference so 1-pixel strokes still hint at scale on
  // narrow phones; the SVG itself is responsive.
  const W = 600;

  const points = $derived.by(() => {
    if (candles.length < 2) return null;
    const xs = candles.map((c) => c.t);
    const ys = candles.map((c) => c.c);
    const xMin = Math.min(...xs);
    const xMax = Math.max(...xs);
    const yMin = Math.min(...ys);
    const yMax = Math.max(...ys);
    const xSpan = xMax - xMin || 1;
    const ySpan = yMax - yMin || 1;
    // 2px padding top/bottom so the stroke doesn't get clipped on the edges.
    const pad = 2;
    const usable = height - pad * 2;
    const coords = candles.map((c) => ({
      x: ((c.t - xMin) / xSpan) * W,
      y: pad + (1 - (c.c - yMin) / ySpan) * usable,
    }));
    const line = coords.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
    const area = fill
      ? `${line} L${coords[coords.length - 1]?.x.toFixed(1)},${height} L${coords[0]?.x.toFixed(1)},${height} Z`
      : null;
    const trendUp = (candles[candles.length - 1]?.c ?? 0) >= (candles[0]?.c ?? 0);
    return { line, area, trendUp };
  });
</script>

{#if points}
  <svg
    class="m-sparkline"
    viewBox={`0 0 ${W} ${height}`}
    preserveAspectRatio="none"
    role="img"
    aria-label="Price trend"
  >
    {#if points.area}
      <path
        d={points.area}
        class="m-sparkline-area"
        class:is-up={points.trendUp}
        class:is-down={!points.trendUp}
      />
    {/if}
    <path
      d={points.line}
      class="m-sparkline-line"
      class:is-up={points.trendUp}
      class:is-down={!points.trendUp}
    />
  </svg>
{:else}
  <div class="m-sparkline-empty" style="height: {height}px"></div>
{/if}

<style>
  .m-sparkline {
    width: 100%;
    display: block;
  }

  .m-sparkline-line {
    fill: none;
    stroke-width: 1.5;
    vector-effect: non-scaling-stroke;
  }

  .m-sparkline-line.is-up {
    stroke: var(--stripe-success);
  }
  .m-sparkline-line.is-down {
    stroke: var(--stripe-danger);
  }

  .m-sparkline-area {
    stroke: none;
    opacity: 0.18;
  }
  .m-sparkline-area.is-up {
    fill: var(--stripe-success);
  }
  .m-sparkline-area.is-down {
    fill: var(--stripe-danger);
  }

  .m-sparkline-empty {
    background: var(--stripe-bg-secondary);
    border-radius: var(--radius-md);
  }
</style>
