<script lang="ts">
  import { onMount } from 'svelte';
  import { effigyUrl, truncateAddress } from '$lib/utils/format';
  import type { CandlePoint, TraderOpen } from '$lib/utils/asset-ranges';

  interface Props {
    candles: CandlePoint[];
    /** Chart height in CSS pixels. Width auto-fills the container. */
    height?: number;
    /** Position-open events to overlay on the chart as avatar markers. */
    markers?: TraderOpen[];
  }
  let { candles, height = 320, markers = [] }: Props = $props();

  let wrapEl: HTMLDivElement;
  let containerEl: HTMLDivElement;
  let overlayEl: HTMLDivElement;
  // The chart + series live in browser-only land — loaded dynamically inside
  // onMount so SSR doesn't try to evaluate lightweight-charts.
  let chart: any = null;
  let series: any = null;
  let resizeObserver: ResizeObserver | null = null;
  let rangeUnsub: (() => void) | null = null;
  /** DOM nodes built from `markers`, kept aligned 1:1 with that array. */
  let markerEls: HTMLAnchorElement[] = [];

  // Match swash's palette so the chart blends with the surrounding card.
  const COLOR_BG = 'transparent';
  const COLOR_TEXT = 'rgba(255, 255, 255, 0.45)';
  const COLOR_GRID = 'rgba(255, 255, 255, 0.04)';
  const COLOR_BORDER = 'rgba(255, 255, 255, 0.08)';
  const COLOR_UP = '#01CDA2';
  const COLOR_DOWN = '#ff5c5c';

  function toCandleSeries(rows: CandlePoint[]) {
    return rows
      .filter((k) => Number.isFinite(k.o) && Number.isFinite(k.c))
      // lightweight-charts wants seconds since epoch, ascending, unique.
      .map((k) => ({
        time: Math.floor(k.t / 1000) as number,
        open: k.o,
        high: k.h,
        low: k.l,
        close: k.c,
      }));
  }

  /** Build the avatar elements once per `markers` change. We avoid recreating
   *  on every pan/zoom — those only move the existing nodes. */
  function buildMarkers() {
    if (!overlayEl) return;
    for (const el of markerEls) el.remove();
    markerEls = [];
    for (const m of markers) {
      const a = document.createElement('a');
      a.href = `/trader/${m.address}`;
      a.className = `k-tv-marker ${m.side === 'B' ? 'is-long' : 'is-short'}`;
      a.title = `${truncateAddress(m.address)} · ${m.side === 'B' ? 'opened long' : 'opened short'} @ $${m.pxUsd.toLocaleString('en-US')}`;
      // Hidden until we have valid coordinates from the chart.
      a.style.display = 'none';
      const img = document.createElement('img');
      img.src = effigyUrl(m.address);
      img.alt = '';
      img.loading = 'lazy';
      img.onerror = () => (a.style.visibility = 'hidden');
      a.appendChild(img);
      overlayEl.appendChild(a);
      markerEls.push(a);
    }
    positionMarkers();
  }

  /** Translate each marker to its on-chart pixel. `timeToCoordinate` returns
   *  null when the time is outside the visible logical range — hide those. */
  function positionMarkers() {
    if (!chart || !series) return;
    const ts = chart.timeScale();
    for (let i = 0; i < markers.length; i++) {
      const m = markers[i];
      const el = markerEls[i];
      if (!m || !el) continue;
      const x = ts.timeToCoordinate(Math.floor(m.blockTimeMs / 1000));
      const y = series.priceToCoordinate(m.pxUsd);
      if (x !== null && y !== null && Number.isFinite(x) && Number.isFinite(y)) {
        el.style.left = `${x}px`;
        el.style.top = `${y}px`;
        el.style.display = 'block';
      } else {
        el.style.display = 'none';
      }
    }
  }

  onMount(() => {
    let cancelled = false;
    (async () => {
      const { createChart, CandlestickSeries, ColorType, LineStyle, CrosshairMode } = await import(
        'lightweight-charts'
      );
      if (cancelled || !containerEl) return;

      chart = createChart(containerEl, {
        width: containerEl.clientWidth,
        height,
        autoSize: false,
        layout: {
          background: { type: ColorType.Solid, color: COLOR_BG },
          textColor: COLOR_TEXT,
          fontSize: 11,
        },
        grid: {
          vertLines: { color: COLOR_GRID },
          horzLines: { color: COLOR_GRID },
        },
        rightPriceScale: {
          borderColor: COLOR_BORDER,
          scaleMargins: { top: 0.1, bottom: 0.08 },
        },
        timeScale: {
          borderColor: COLOR_BORDER,
          timeVisible: true,
          secondsVisible: false,
        },
        crosshair: {
          mode: CrosshairMode.Magnet,
          vertLine: { color: 'rgba(255,255,255,0.18)', style: LineStyle.Dashed, width: 1 },
          horzLine: { color: 'rgba(255,255,255,0.18)', style: LineStyle.Dashed, width: 1 },
        },
        handleScale: { axisPressedMouseMove: true, mouseWheel: true, pinch: true },
        handleScroll: true,
      });
      series = chart.addSeries(CandlestickSeries, {
        upColor: COLOR_UP,
        downColor: COLOR_DOWN,
        borderUpColor: COLOR_UP,
        borderDownColor: COLOR_DOWN,
        wickUpColor: COLOR_UP,
        wickDownColor: COLOR_DOWN,
      });
      series.setData(toCandleSeries(candles));
      chart.timeScale().fitContent();

      // Re-position avatars on every pan / zoom.
      rangeUnsub = chart.timeScale().subscribeVisibleLogicalRangeChange(positionMarkers);

      buildMarkers();

      resizeObserver = new ResizeObserver((entries) => {
        for (const entry of entries) {
          if (!chart) return;
          chart.applyOptions({ width: entry.contentRect.width, height });
          positionMarkers();
        }
      });
      resizeObserver.observe(containerEl);
    })();

    return () => {
      cancelled = true;
      resizeObserver?.disconnect();
      resizeObserver = null;
      rangeUnsub?.();
      rangeUnsub = null;
      for (const el of markerEls) el.remove();
      markerEls = [];
      chart?.remove?.();
      chart = null;
      series = null;
    };
  });

  // Re-feed candles whenever the parent updates them (range tab change, 12s
  // poll). `chart?.timeScale().fitContent()` re-fits the X axis so a 1h→30d
  // switch doesn't leave us zoomed into 60 minutes of a 30-day window.
  $effect(() => {
    const data = toCandleSeries(candles);
    if (series) {
      series.setData(data);
      chart?.timeScale().fitContent();
      positionMarkers();
    }
  });

  // Rebuild avatars when the marker set changes (new trader top-5, range tab
  // change moved the time window).
  $effect(() => {
    // Touch `markers` reactively so we re-build when the prop swaps.
    void markers;
    if (chart && series) buildMarkers();
  });
</script>

<div bind:this={wrapEl} class="k-tv-chart-wrap" style="height: {height}px">
  <div bind:this={containerEl} class="k-tv-chart"></div>
  <div bind:this={overlayEl} class="k-tv-chart-markers" aria-hidden="true"></div>
</div>

<style>
  .k-tv-chart-wrap {
    position: relative;
    width: 100%;
  }
  .k-tv-chart {
    width: 100%;
    height: 100%;
  }
  .k-tv-chart-markers {
    position: absolute;
    inset: 0;
    /* let pan/zoom pass through to the chart; avatar elements re-enable
     * pointer-events for themselves so they stay clickable. */
    pointer-events: none;
    overflow: hidden;
  }
  /* The avatar nodes are created imperatively in the script — these styles
   * are scoped to the component so we can keep the public class names clean. */
  :global(.k-tv-marker) {
    position: absolute;
    pointer-events: auto;
    transform: translate(-50%, -50%);
    width: 28px;
    height: 28px;
    border-radius: 50%;
    border: 2.5px solid var(--marker-color, rgba(255, 255, 255, 0.4));
    background: var(--stripe-bg-primary);
    box-shadow: 0 1px 6px rgba(0, 0, 0, 0.5);
    display: block;
    transition: transform 120ms ease;
  }
  :global(.k-tv-marker:hover) {
    transform: translate(-50%, -50%) scale(1.18);
    z-index: 2;
  }
  :global(.k-tv-marker.is-long) {
    --marker-color: var(--stripe-success);
  }
  :global(.k-tv-marker.is-short) {
    --marker-color: var(--stripe-danger);
  }
  :global(.k-tv-marker img) {
    display: block;
    width: 100%;
    height: 100%;
    border-radius: 50%;
    object-fit: cover;
  }
</style>
