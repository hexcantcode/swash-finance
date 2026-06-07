<script lang="ts">
  import { onMount } from 'svelte';

  interface Props {
    /** Cumulative-PnL series, oldest → newest. Length determines how
     *  densely the x-axis is filled. */
    data: number[];
    /** Chart height in CSS pixels. Width auto-fills the container. */
    height?: number;
    /** Tint override. Default `'auto'` picks success / danger / muted
     *  from the sign of (last - first). */
    tint?: 'positive' | 'negative' | 'flat' | 'auto';
    /** Show axes + crosshair? Off by default — the card list uses the
     *  bare-sparkline mode. The profile page passes `interactive=true`
     *  for a full equity chart. */
    interactive?: boolean;
  }
  let { data, height = 60, tint = 'auto', interactive = false }: Props = $props();

  let containerEl: HTMLDivElement;
  // Chart + series live in browser-only land — imported dynamically in
  // onMount so SSR doesn't try to evaluate the canvas-backed library.
  let chart: any = null;
  let series: any = null;
  let resizeObserver: ResizeObserver | null = null;

  const direction = $derived(directionOf(data));
  const effectiveTint = $derived<'positive' | 'negative' | 'flat'>(
    tint === 'auto' ? direction : tint,
  );

  // Theme colors — duplicated from app.css's --stripe-success / --stripe-danger
  // because lightweight-charts paints to a canvas and can't read CSS
  // custom properties. Update both sides together if either token moves.
  const COLOR_POS = '#0E9F66';
  const COLOR_NEG = '#DC2A2A';
  const COLOR_MUTE = 'rgba(10, 15, 26, 0.42)';

  function lineColor(t: 'positive' | 'negative' | 'flat'): string {
    if (t === 'positive') return COLOR_POS;
    if (t === 'negative') return COLOR_NEG;
    return COLOR_MUTE;
  }

  function directionOf(d: number[]): 'positive' | 'negative' | 'flat' {
    if (d.length < 2) return 'flat';
    const first = d[0] ?? 0;
    const last = d[d.length - 1] ?? 0;
    if (last > first) return 'positive';
    if (last < first) return 'negative';
    return 'flat';
  }

  /** Convert a `number[]` into the `{ time, value }` shape the library
   *  wants. Time-stamps are synthetic — one per index, anchored at
   *  today and stepping back one day per index in reverse — so the
   *  x-axis is ascending and unique. Only the ordering matters; in
   *  bare-sparkline mode the axis isn't shown anyway. */
  function toSeries(d: number[]): { time: number; value: number }[] {
    const dayMs = 24 * 60 * 60 * 1000;
    const todayUtc = Math.floor(Date.now() / dayMs) * dayMs;
    return d.map((v, i) => ({
      time: Math.floor((todayUtc - (d.length - 1 - i) * dayMs) / 1000),
      value: Number.isFinite(v) ? v : 0,
    }));
  }

  onMount(() => {
    let cancelled = false;
    (async () => {
      const { createChart, AreaSeries, ColorType, CrosshairMode, LineStyle } = await import(
        'lightweight-charts'
      );
      if (cancelled || !containerEl) return;

      const tone = lineColor(effectiveTint);

      chart = createChart(containerEl, {
        width: containerEl.clientWidth,
        height,
        autoSize: false,
        layout: {
          background: { type: ColorType.Solid, color: 'transparent' },
          textColor: interactive ? 'rgba(10, 15, 26, 0.48)' : 'transparent',
          fontSize: 10,
          attributionLogo: false,
        },
        grid: {
          vertLines: { visible: false },
          horzLines: interactive
            ? { color: 'rgba(10, 15, 26, 0.06)', style: LineStyle.Dotted }
            : { visible: false },
        },
        rightPriceScale: {
          // Hidden even in interactive mode — no price labels on the right,
          // so the series spans the full container width.
          visible: false,
          borderVisible: false,
          scaleMargins: { top: 0.12, bottom: 0.08 },
        },
        leftPriceScale: { visible: false },
        timeScale: {
          visible: interactive,
          borderVisible: false,
          timeVisible: false,
          secondsVisible: false,
        },
        crosshair: interactive
          ? {
              mode: CrosshairMode.Magnet,
              vertLine: { color: 'rgba(10, 15, 26, 0.24)', style: LineStyle.Dotted, width: 1 },
              horzLine: { color: 'rgba(10, 15, 26, 0.24)', style: LineStyle.Dotted, width: 1 },
            }
          : {
              vertLine: { visible: false, labelVisible: false },
              horzLine: { visible: false, labelVisible: false },
            },
        // Touch drag/pinch stay OFF even in interactive mode: otherwise the
        // chart's canvas sets `touch-action: none` and swallows vertical
        // swipes that begin over it, trapping page scroll. Mouse pan/zoom
        // (desktop) and the crosshair still work.
        handleScale: interactive
          ? { axisPressedMouseMove: true, mouseWheel: true, pinch: false }
          : { axisPressedMouseMove: false, mouseWheel: false, pinch: false },
        handleScroll: interactive
          ? {
              mouseWheel: true,
              pressedMouseMove: true,
              horzTouchDrag: false,
              vertTouchDrag: false,
            }
          : {
              mouseWheel: false,
              pressedMouseMove: false,
              horzTouchDrag: false,
              vertTouchDrag: false,
            },
      });

      // One AreaSeries owns both the line and a gradient fill below. The
      // gradient fades from tone-translucent at the top to transparent at
      // the baseline so the curve floats above the card surface without a
      // hard block of color.
      series = chart.addSeries(AreaSeries, {
        lineColor: tone,
        lineWidth: 2,
        topColor: hexToRgba(tone, 0.28),
        bottomColor: hexToRgba(tone, 0.0),
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: interactive,
      });
      series.setData(toSeries(data));
      chart.timeScale().fitContent();

      resizeObserver = new ResizeObserver((entries) => {
        for (const entry of entries) {
          if (!chart) return;
          chart.applyOptions({ width: entry.contentRect.width, height });
        }
      });
      resizeObserver.observe(containerEl);
    })();

    return () => {
      cancelled = true;
      resizeObserver?.disconnect();
      resizeObserver = null;
      chart?.remove?.();
      chart = null;
      series = null;
    };
  });

  // Refeed when `data` changes (silent leaderboard refresh, profile load).
  $effect(() => {
    if (!series) return;
    series.setData(toSeries(data));
    chart?.timeScale().fitContent();
  });

  // Re-tint in place when the sign flips between renders. Cheaper than
  // rebuilding the chart.
  $effect(() => {
    if (!series) return;
    const tone = lineColor(effectiveTint);
    series.applyOptions({
      lineColor: tone,
      topColor: hexToRgba(tone, 0.28),
      bottomColor: hexToRgba(tone, 0.0),
    });
  });

  /** `#rrggbb` → `rgba(r,g,b,a)`. The library accepts CSS color strings,
   *  but we need the alpha on the area gradient stops which the bare hex
   *  can't carry. Pre-existing rgba strings pass through. */
  function hexToRgba(hex: string, alpha: number): string {
    if (hex.startsWith('rgba(') || hex.startsWith('rgb(')) return hex;
    const m = hex.match(/^#?([0-9a-f]{6})$/i);
    if (!m) return hex;
    const num = Number.parseInt(m[1]!, 16);
    const r = (num >> 16) & 0xff;
    const g = (num >> 8) & 0xff;
    const b = num & 0xff;
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }
</script>

<div bind:this={containerEl} class="m-equity-curve" style="height: {height}px"></div>

<style>
  .m-equity-curve {
    width: 100%;
    /* lightweight-charts renders to a canvas inside this container. The
     * inline `height` style mirrors the `height` prop we pass to the
     * library so the canvas measures up correctly on first paint. */
  }
</style>
