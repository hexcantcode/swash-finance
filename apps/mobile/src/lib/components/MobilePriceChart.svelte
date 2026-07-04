<script module lang="ts">
  /** A smart-money marker pinned to (time, price). Presentational only — the
   *  parent decides clustering/colors; `key` round-trips through `onmarktap`. */
  export interface ChartMark {
    key: string;
    tMs: number;
    pxUsd: number;
    tone: 'success' | 'danger';
    /** Filled dot (entry) vs hollow ring (exit). Bundles are always filled. */
    filled: boolean;
    r: number;
    /** When set, renders as a bundle bubble with a "×N" label. */
    count?: number;
  }
  /** Faint entry→exit connector between two pinned points. */
  export interface ChartLink {
    aTMs: number;
    aPxUsd: number;
    bTMs: number;
    bPxUsd: number;
    tone: 'success' | 'danger';
  }
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
    /** Smart-money overlay: dot/bundle markers pinned to (time, price). */
    marks?: ChartMark[];
    /** Entry→exit connectors between marker pairs. */
    links?: ChartLink[];
    /** Dashed horizontal levels (aggregate open-position entries). */
    levels?: ChartLevel[];
    /** Fires with the tapped marker's `key`. */
    onmarktap?: (key: string) => void;
  }
  let {
    candles = [],
    height = 200,
    mode = 'line',
    onhover,
    line,
    marks = [],
    links = [],
    levels = [],
    onmarktap,
  }: Props = $props();

  let containerEl: HTMLDivElement;
  // Chart + series live in browser-only land — imported dynamically in
  // onMount so SSR doesn't try to evaluate the canvas-backed library.
  let chart: any = null;
  let series: any = null;
  let lib: any = null;
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
    marks: (ChartMark & XY & { color: string })[];
    links: { x1: number; y1: number; x2: number; y2: number; color: string }[];
    levels: { y: number; color: string; label: string }[];
  }>({ width: 0, marks: [], links: [], levels: [] });

  function toneColor(t: 'success' | 'danger'): string {
    return t === 'success' ? tone.success : tone.danger;
  }

  function positionOverlay() {
    const empty = { width: 0, marks: [], links: [], levels: [] };
    if (!chart || !series || line || candles.length < 2) {
      overlay = empty;
      return;
    }
    if (marks.length === 0 && links.length === 0 && levels.length === 0) {
      overlay = empty;
      return;
    }
    const t0 = candles[0]!.t;
    const step = candles[1]!.t - candles[0]!.t;
    if (step <= 0) {
      overlay = empty;
      return;
    }
    const timeScale = chart.timeScale();
    const width = containerEl?.clientWidth ?? 0;
    // v5's logicalToCoordinate returns 0 here regardless of input (observed on
    // 5.2.0 with a static, fitContent'ed scale), so map x manually: fractional
    // logical index → position within the visible logical range → pixels.
    const vr = timeScale.getVisibleLogicalRange();
    if (!vr || vr.to <= vr.from || width <= 0) {
      overlay = empty;
      return;
    }
    const point = (tMs: number, pxUsd: number): XY | null => {
      const logical = (tMs - t0) / step;
      const x = ((logical - vr.from) / (vr.to - vr.from)) * width;
      const y = series.priceToCoordinate(pxUsd);
      if (y == null || !Number.isFinite(x)) return null;
      return { x, y };
    };

    overlay = {
      width,
      marks: marks.flatMap((m) => {
        const p = point(m.tMs, m.pxUsd);
        return p ? [{ ...m, ...p, color: toneColor(m.tone) }] : [];
      }),
      links: links.flatMap((l) => {
        const a = point(l.aTMs, l.aPxUsd);
        const b = point(l.bTMs, l.bPxUsd);
        return a && b ? [{ x1: a.x, y1: a.y, x2: b.x, y2: b.y, color: toneColor(l.tone) }] : [];
      }),
      levels: levels.flatMap((l) => {
        const y = series.priceToCoordinate(l.pxUsd);
        return y == null ? [] : [{ y, color: toneColor(l.tone), label: l.label }];
      }),
    };
  }

  function markTap(event: Event, key: string) {
    // Keep the tap from bubbling to the page's tap-away dismiss handler.
    event.stopPropagation();
    onmarktap?.(key);
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
    // New series ⇒ new autoscale ⇒ new y mapping; reposition after layout.
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

  // Reposition the overlay when the mark props change without a repaint.
  $effect(() => {
    void marks;
    void links;
    void levels;
    if (chart && series) requestAnimationFrame(positionOverlay);
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
  {#if overlay.marks.length > 0 || overlay.links.length > 0 || overlay.levels.length > 0}
    <svg class="m-chart-overlay" width="100%" height={height} aria-label="Smart-money marks">
      {#each overlay.levels as l (l.label)}
        <line
          class="m-overlay-level"
          x1="0"
          y1={l.y}
          x2={overlay.width}
          y2={l.y}
          stroke={l.color}
        />
        <text class="m-overlay-level-label" x="6" y={l.y - 4} fill={l.color}>{l.label}</text>
      {/each}
      {#each overlay.links as k, i (i)}
        <line class="m-overlay-link" x1={k.x1} y1={k.y1} x2={k.x2} y2={k.y2} stroke={k.color} />
      {/each}
      {#each overlay.marks as m, i (i)}
        <g
          class="m-overlay-mark"
          role="button"
          tabindex="-1"
          aria-label="Show smart-money trades here"
          onclick={(e) => markTap(e, m.key)}
          onkeydown={(e) => e.key === 'Enter' && markTap(e, m.key)}
        >
          <!-- Oversized invisible hit target — the visible dot is too small
               for a fingertip on its own. -->
          <circle class="m-overlay-hit" cx={m.x} cy={m.y} r={Math.max(m.r + 9, 14)} />
          {#if m.count}
            <circle class="m-overlay-bundle" cx={m.x} cy={m.y} r={m.r} fill={m.color} />
            <text class="m-overlay-count" x={m.x} y={m.y}>×{m.count}</text>
          {:else if m.filled}
            <circle class="m-overlay-dot" cx={m.x} cy={m.y} r={m.r} fill={m.color} />
          {:else}
            <circle class="m-overlay-ring" cx={m.x} cy={m.y} r={m.r} stroke={m.color} />
          {/if}
        </g>
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

  /* Marker overlay — sits over the canvas but stays transparent to pointer
     events except on the marks themselves, so the crosshair still tracks. */
  .m-chart-overlay {
    position: absolute;
    inset: 0;
    pointer-events: none;
    overflow: hidden;
  }

  .m-overlay-level {
    stroke-width: 1;
    stroke-dasharray: 4 4;
    opacity: 0.55;
  }

  .m-overlay-level-label {
    font-family: var(--font-mono);
    font-size: 9px;
    opacity: 0.9;
  }

  .m-overlay-link {
    stroke-width: 1;
    opacity: 0.28;
  }

  .m-overlay-mark {
    pointer-events: auto;
    cursor: pointer;
    outline: none;
  }

  .m-overlay-hit {
    fill: transparent;
  }

  .m-overlay-dot {
    stroke: var(--stripe-bg-primary, rgba(0, 0, 0, 0.4));
    stroke-width: 1;
    opacity: 0.92;
  }

  .m-overlay-ring {
    fill: transparent;
    stroke-width: 1.5;
    opacity: 0.92;
  }

  .m-overlay-bundle {
    opacity: 0.85;
    stroke: var(--stripe-bg-primary, rgba(0, 0, 0, 0.4));
    stroke-width: 1;
  }

  .m-overlay-count {
    font-family: var(--font-mono);
    font-size: 9px;
    font-weight: 600;
    fill: #fff;
    text-anchor: middle;
    dominant-baseline: central;
    pointer-events: none;
  }
</style>
