<script lang="ts">
  interface Props {
    series: { ts: number; value: number }[];
    height?: number;
  }
  let { series, height = 240 }: Props = $props();

  // Pure SVG line chart — keeps SSR rendering trivial and avoids any layerchart
  // hydration overhead for a single static curve.
  const padding = { top: 16, right: 16, bottom: 24, left: 48 };

  const width = $derived(720);
  const minVal = $derived(series.length ? Math.min(...series.map((p) => p.value), 0) : 0);
  const maxVal = $derived(series.length ? Math.max(...series.map((p) => p.value), 0) : 1);
  const minTs = $derived(series.length ? series[0]!.ts : 0);
  const maxTs = $derived(series.length ? series[series.length - 1]!.ts : 1);

  const innerW = $derived(width - padding.left - padding.right);
  const innerH = $derived(height - padding.top - padding.bottom);

  function x(ts: number): number {
    if (maxTs === minTs) return padding.left;
    return padding.left + ((ts - minTs) / (maxTs - minTs)) * innerW;
  }
  function y(v: number): number {
    if (maxVal === minVal) return padding.top + innerH / 2;
    return padding.top + (1 - (v - minVal) / (maxVal - minVal)) * innerH;
  }

  const linePath = $derived.by(() => {
    if (series.length === 0) return '';
    return series
      .map((p, i) => `${i === 0 ? 'M' : 'L'} ${x(p.ts).toFixed(2)} ${y(p.value).toFixed(2)}`)
      .join(' ');
  });

  const areaPath = $derived.by(() => {
    if (series.length === 0) return '';
    const top = series
      .map((p, i) => `${i === 0 ? 'M' : 'L'} ${x(p.ts).toFixed(2)} ${y(p.value).toFixed(2)}`)
      .join(' ');
    const close = `L ${x(series[series.length - 1]!.ts).toFixed(2)} ${(padding.top + innerH).toFixed(2)} L ${x(series[0]!.ts).toFixed(2)} ${(padding.top + innerH).toFixed(2)} Z`;
    return `${top} ${close}`;
  });

  // y-axis ticks
  const yTicks = $derived.by(() => {
    if (maxVal === minVal) return [];
    return [0, 0.25, 0.5, 0.75, 1].map((p) => {
      const v = minVal + p * (maxVal - minVal);
      return { v, y: y(v) };
    });
  });

  function fmtUsd(v: number): string {
    const abs = Math.abs(v);
    const sign = v < 0 ? '-' : '';
    if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(1)}M`;
    if (abs >= 1_000) return `${sign}$${(abs / 1_000).toFixed(1)}k`;
    return `${sign}$${abs.toFixed(0)}`;
  }

  function fmtDate(ts: number): string {
    return new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }

  const isProfitable = $derived(
    series.length > 1 ? series[series.length - 1]!.value >= series[0]!.value : true,
  );
</script>

{#if series.length === 0}
  <div class="grid h-60 place-items-center text-sm text-fg-faint">No 90-day equity data yet.</div>
{:else}
  <svg viewBox="0 0 {width} {height}" class="h-auto w-full overflow-visible" role="img" aria-label="Equity curve">
    <defs>
      <linearGradient id="equity-fill" x1="0" x2="0" y1="0" y2="1">
        <stop offset="0%" stop-color={isProfitable ? '#16f199' : '#ff5d75'} stop-opacity="0.25" />
        <stop offset="100%" stop-color={isProfitable ? '#16f199' : '#ff5d75'} stop-opacity="0" />
      </linearGradient>
    </defs>

    <!-- y gridlines -->
    {#each yTicks as t (t.v)}
      <line
        x1={padding.left}
        x2={width - padding.right}
        y1={t.y}
        y2={t.y}
        stroke="#232633"
        stroke-dasharray="3 3"
      />
      <text x={padding.left - 8} y={t.y + 4} text-anchor="end" font-size="10" fill="#6b7080" class="numeric">
        {fmtUsd(t.v)}
      </text>
    {/each}

    <!-- zero line -->
    {#if minVal < 0 && maxVal > 0}
      <line
        x1={padding.left}
        x2={width - padding.right}
        y1={y(0)}
        y2={y(0)}
        stroke="#2f3344"
        stroke-width="1"
      />
    {/if}

    <!-- area fill -->
    <path d={areaPath} fill="url(#equity-fill)" />

    <!-- line -->
    <path
      d={linePath}
      fill="none"
      stroke={isProfitable ? '#16f199' : '#ff5d75'}
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
    />

    <!-- x-axis labels -->
    <text x={padding.left} y={height - 6} font-size="10" fill="#6b7080" class="numeric">
      {fmtDate(minTs)}
    </text>
    <text x={width - padding.right} y={height - 6} text-anchor="end" font-size="10" fill="#6b7080" class="numeric">
      {fmtDate(maxTs)}
    </text>
  </svg>
{/if}
