<script module lang="ts">
  /** Dashed horizontal price level with a compact label. */
  export interface ChartLevel {
    pxUsd: number;
    tone: 'success' | 'danger';
    label: string;
  }
</script>

<script lang="ts">
  import { onMount } from 'svelte';
  import type { Candle } from '$lib/api/asset-detail';

  interface Props {
    candles?: Candle[];
    /** Chart height in CSS pixels. Width auto-fills the container. */
    height?: number;
    /** `'line'` paints an area/line series with a gradient fill (default,
     *  matching the old sparkline look); `'candle'` paints OHLC candles. */
    mode?: 'line' | 'candle';
    /** Fires with the price + time under the crosshair as it moves, and with
     *  `null` when the pointer leaves the chart. The parent shows the readout
     *  (there's no price scale on the right anymore). */
    onhover?: (point: { price: number; time: number } | null) => void;
    /** When provided, renders this `{ t: ms, value }` series as the area/line
     *  and ignores `candles`/`mode`. Used for the trader equity curve so it
     *  shares this chart's exact design. Sparse series are pinned edge-to-edge. */
    line?: { t: number; value: number }[];
    /** Dashed horizontal levels (the cohort's average entry per side). */
    levels?: ChartLevel[];
  }
  let {
    candles = [],
    height = 200,
    mode = 'line',
    onhover,
    line,
    levels = [],
  }: Props = $props();

  let containerEl: HTMLDivElement;
  // Chart + series live in browser-only land — imported dynamically in
  // onMount so SSR doesn't try to evaluate the canvas-backed library.
  let chart: any = null;
  let series: any = null;
  let lib: any = null;
  // Native lightweight-charts price lines for the levels (crisp dotted
  // rendering by the chart engine itself; SVG only carries the labels).
  let priceLines: any[] = [];
  let resizeObserver: ResizeObserver | null = null;
  // Theme tones resolved from CSS custom properties at mount, so candle/line
  // colors track the active light/dark theme without duplicating the tokens.
  let tone = { success: '#0E9F66', danger: '#DC2A2A' };

  function trendUp(): boolean {
    return (candles[candles.length - 1]?.c ?? 0) >= (candles[0]?.c ?? 0);
  }

  // ── Smart-money overlay ────────────────────────────────────────────────
  // The library renders to canvas, so pinned markers live in a sibling SVG
  // positioned with the chart's own coordinate APIs: x from a fractional
  // logical index over the candle series, y from priceToCoordinate. Repainted
  // whenever the visible scale or the mark props change; scroll/zoom are
  // disabled, so those are the only movers.
  type XY = { x: number; y: number };
  let overlay = $state<{
    width: number;
    levels: { y: number; labelY: number; textX: number; anchor: string; color: string; label: string }[];
  }>({ width: 0, levels: [] });

  function toneColor(t: 'success' | 'danger'): string {
    return t === 'success' ? tone.success : tone.danger;
  }

  /** (Re)create the native price lines for the current levels. Old lines die
   *  with a removed series, so this runs after every draw() and level change. */
  function applyLevels() {
    if (!chart || !series || !lib) return;
    for (const pl of priceLines) {
      try {
        series.removePriceLine(pl);
      } catch {
        // The line's series may already be torn down — nothing to remove.
      }
    }
    priceLines = [];
    if (line) return; // equity-curve mode has no levels
    for (const l of levels) {
      priceLines.push(
        series.createPriceLine({
          price: l.pxUsd,
          color: toneColor(l.tone),
          lineWidth: 1,
          lineStyle: lib.LineStyle.Dotted,
          axisLabelVisible: false,
        }),
      );
    }
  }

  function positionOverlay() {
    const empty = { width: 0, levels: [] };
    if (!chart || !series || line || candles.length < 2 || levels.length === 0) {
      overlay = empty;
      return;
    }
    const width = containerEl?.clientWidth ?? 0;
    if (width <= 0) {
      overlay = empty;
      return;
    }
    // Long labels anchor left, short labels right — opposite ends, so the two
    // can never collide even when the lines nearly touch.
    const lvls = levels.flatMap((l) => {
      const y = series.priceToCoordinate(l.pxUsd);
      if (y == null) return [];
      const right = l.tone === 'danger';
      return [{
        y,
        labelY: y - 4,
        textX: right ? width - 6 : 6,
        anchor: right ? 'end' : 'start',
        color: toneColor(l.tone),
        label: l.label,
      }];
    });
    overlay = { width, levels: lvls };
  }

  /** Tear down the current series and repaint for the active `mode`. Cheaper
   *  than recreating the whole chart when only the series type changes. */
  function draw() {
    if (!chart || !lib) return;
    if (series) {
      chart.removeSeries(series);
      series = null;
    }

    // Equity-curve mode: a bare {time,value} series, edge-to-edge.
    if (line && line.length > 0) {
      const up = (line[line.length - 1]?.value ?? 0) >= (line[0]?.value ?? 0);
      const t = up ? tone.success : tone.danger;
      series = chart.addSeries(lib.AreaSeries, {
        lineColor: t,
        lineWidth: 2,
        topColor: hexToRgba(t, 0.22),
        bottomColor: hexToRgba(t, 0.0),
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false,
      });
      const pts = line.map((p) => ({ time: Math.floor(p.t / 1000), value: p.value }));
      // Resample to a dense series: lightweight-charts leaves a half-bar margin
      // on each edge, which is huge for a handful of points. Many points along
      // the same piecewise-linear path shrink that margin to ~nothing, so the
      // curve sits flush to the edges like the dense candle chart.
      series.setData(densify(pts));
      chart.timeScale().fitContent();
      return;
    }

    if (candles.length === 0) return;

    if (mode === 'candle') {
      series = chart.addSeries(lib.CandlestickSeries, {
        upColor: tone.success,
        downColor: tone.danger,
        borderUpColor: tone.success,
        borderDownColor: tone.danger,
        wickUpColor: tone.success,
        wickDownColor: tone.danger,
        priceLineVisible: false,
        lastValueVisible: false,
      });
      series.setData(
        candles.map((c) => ({
          time: Math.floor(c.t / 1000),
          open: c.o,
          high: c.h,
          low: c.l,
          close: c.c,
        })),
      );
    } else {
      const t = trendUp() ? tone.success : tone.danger;
      series = chart.addSeries(lib.AreaSeries, {
        lineColor: t,
        lineWidth: 2,
        topColor: hexToRgba(t, 0.22),
        bottomColor: hexToRgba(t, 0.0),
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false,
      });
      series.setData(
        candles.map((c) => ({ time: Math.floor(c.t / 1000), value: c.c })),
      );
    }
    chart.timeScale().fitContent();
    // New series ⇒ stale price-line handles + new y mapping.
    priceLines = [];
    applyLevels();
    requestAnimationFrame(positionOverlay);
  }

  /** Resample a sparse {time,value} series to ~120 points along its existing
   *  piecewise-linear path. Same shape, far more bars — so fitContent's
   *  per-bar edge margin becomes visually negligible. */
  function densify(
    pts: { time: number; value: number }[],
    target = 120,
  ): { time: number; value: number }[] {
    if (pts.length < 2 || pts.length >= target) return pts;
    const t0 = pts[0]!.time;
    const t1 = pts[pts.length - 1]!.time;
    const span = t1 - t0;
    if (span <= 0) return pts;
    const out: { time: number; value: number }[] = [];
    let j = 0;
    let lastT = -1;
    for (let k = 0; k < target; k++) {
      const t = t0 + Math.round((span * k) / (target - 1));
      while (j < pts.length - 2 && pts[j + 1]!.time < t) j++;
      const a = pts[j]!;
      const b = pts[j + 1] ?? a;
      const f = b.time > a.time ? (t - a.time) / (b.time - a.time) : 0;
      // lightweight-charts needs strictly-ascending unique integer times.
      const time = t <= lastT ? lastT + 1 : t;
      lastT = time;
      out.push({ time, value: a.value + (b.value - a.value) * f });
    }
    return out;
  }

  onMount(() => {
    let cancelled = false;
    (async () => {
      const mod = await import('lightweight-charts');
      if (cancelled || !containerEl) return;
      lib = mod;

      const cs = getComputedStyle(containerEl);
      tone = {
        success: cs.getPropertyValue('--stripe-success').trim() || tone.success,
        danger: cs.getPropertyValue('--stripe-danger').trim() || tone.danger,
      };
      const axisText = cs.getPropertyValue('--stripe-text-tertiary').trim();
      const gridColor = cs.getPropertyValue('--stripe-border').trim();

      chart = mod.createChart(containerEl, {
        width: containerEl.clientWidth,
        height,
        autoSize: false,
        layout: {
          background: { type: mod.ColorType.Solid, color: 'transparent' },
          textColor: axisText,
          fontSize: 10,
          attributionLogo: false,
        },
        grid: {
          vertLines: { visible: false },
          horzLines: { visible: false },
        },
        rightPriceScale: {
          // Hidden — price is surfaced via the hover readout instead. The
          // scale still drives layout, so margins keep the series off the edges.
          visible: false,
          borderVisible: false,
          scaleMargins: { top: 0.16, bottom: 0.08 },
        },
        leftPriceScale: { visible: false },
        timeScale: {
          borderVisible: false,
          timeVisible: true,
          secondsVisible: false,
        },
        // A vertical crosshair tracks the hovered date; the price for that
        // point is pushed to the parent via `onhover`. Touch *drag* stays off
        // below (handleScroll) so the canvas doesn't trap page scroll.
        crosshair: {
          mode: mod.CrosshairMode.Magnet,
          vertLine: {
            color: gridColor,
            style: mod.LineStyle.Solid,
            width: 1,
            labelVisible: false,
          },
          horzLine: { visible: false, labelVisible: false },
        },
        handleScale: { axisPressedMouseMove: false, mouseWheel: false, pinch: false },
        handleScroll: {
          mouseWheel: false,
          pressedMouseMove: false,
          horzTouchDrag: false,
          vertTouchDrag: false,
        },
      });

      draw();

      chart.subscribeCrosshairMove((param: any) => {
        if (!onhover) return;
        if (!param.point || param.time == null || !series) {
          onhover(null);
          return;
        }
        const bar = param.seriesData.get(series);
        if (!bar) {
          onhover(null);
          return;
        }
        // Candle bars carry OHLC; the area series carries a single value.
        const price = bar.close ?? bar.value;
        if (price == null) {
          onhover(null);
          return;
        }
        onhover({ price, time: param.time as number });
      });

      chart.timeScale().subscribeVisibleLogicalRangeChange(() => positionOverlay());

      resizeObserver = new ResizeObserver((entries) => {
        for (const entry of entries) {
          if (!chart) return;
          chart.applyOptions({ width: entry.contentRect.width, height });
          requestAnimationFrame(positionOverlay);
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
      lib = null;
    };
  });

  // Repaint when the candle set, line series, or mode changes.
  $effect(() => {
    void candles;
    void line;
    void mode;
    if (chart && lib) draw();
  });

  // Re-apply native lines + reposition labels when the level props change.
  $effect(() => {
    void levels;
    if (chart && series) {
      applyLevels();
      requestAnimationFrame(positionOverlay);
    }
  });

  /** `#rrggbb` → `rgba(r,g,b,a)` for the area gradient stops, which need an
   *  alpha the bare hex can't carry. Pre-existing rgba strings pass through. */
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

<div class="m-price-chart-wrap" style="height: {height}px">
  <div bind:this={containerEl} class="m-price-chart" style="height: {height}px"></div>
  {#if overlay.levels.length > 0}
    <svg class="m-chart-overlay" width="100%" height={height} aria-label="Smart-money entry levels">
      {#each overlay.levels as l (l.label)}
        <text
          class="m-overlay-level-label"
          x={l.textX}
          y={l.labelY}
          text-anchor={l.anchor}
          fill={l.color}
        >{l.label}</text>
      {/each}
    </svg>
  {/if}
</div>

<style>
  .m-price-chart-wrap {
    position: relative;
    width: 100%;
  }

  .m-price-chart {
    width: 100%;
    /* lightweight-charts renders to a transparent canvas inside this
     * container; the inline height mirrors the `height` prop so the canvas
     * measures up on first paint. */
  }

  /* Level overlay — sits over the canvas, fully transparent to pointer
     events, so the crosshair still tracks. */
  .m-chart-overlay {
    position: absolute;
    inset: 0;
    /* lightweight-charts gives its canvases explicit z-indexes (up to 2), so
       the series paints over a z-auto sibling. Lift the overlay above them —
       still pointer-transparent, so the crosshair keeps working. */
    z-index: 3;
    pointer-events: none;
    overflow: hidden;
  }

  .m-overlay-level-label {
    font-family: var(--font-mono);
    font-size: 10px;
    font-weight: 600;
    /* Thin theme-bg halo — keeps the bare text legible where the price path
       crosses it, without a visible pill. */
    stroke: var(--stripe-bg-primary);
    stroke-width: 2.5px;
    paint-order: stroke;
  }







</style>
