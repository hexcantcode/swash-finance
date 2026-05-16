<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import EquityChart from '$lib/components/EquityChart.svelte';
  import Tag from '$lib/components/Tag.svelte';
  import {
    effigyUrl,
    formatPct,
    formatPnl,
    formatRelativeTime,
    formatUsd,
    pnlSignClass,
    shortAddress,
  } from '$lib/utils/format';
  import type { PageData } from './$types';

  interface Props {
    data: PageData;
  }
  let { data }: Props = $props();

  let copied = $state(false);
  let refreshing = $state(false);
  // Chart window (slice client-side off the full equity_curve).
  let chartWindow = $state<'24h' | '7d' | '30d' | 'all'>('30d');
  // Bottom tab strip.
  let activeTab = $state<'positions' | 'fills' | 'trades' | 'performance'>('positions');
  // Deepen-history button state.
  let deepening = $state(false);
  let deepenError = $state<string | null>(null);

  // Volatile slice (positions + recent fills + cache freshness) polled every
  // POLL_MS while the tab is visible. Seeded from the server load; updates
  // patch this state in place so the rest of the page (score, equity curve,
  // tags) keeps its initial values.
  let live = $state({
    open_positions: data.leader.open_positions,
    recent_fills: data.leader.recent_fills,
    live_refreshed_at: data.leader.live_refreshed_at,
    live_source: data.leader.live_source,
  });

  const POLL_MS = 8_000;
  let pollTimer: ReturnType<typeof setTimeout> | null = null;
  let pollStopped = false;

  async function pollLive() {
    if (pollStopped) return;
    if (document.visibilityState !== 'visible') {
      pollTimer = setTimeout(pollLive, POLL_MS);
      return;
    }
    try {
      const res = await fetch(`/trader/${data.leader.address}/live`);
      if (res.ok) {
        const next = await res.json();
        live = next;
      }
    } catch {
      // Network blip — keep last good state and try again next tick.
    }
    if (!pollStopped) pollTimer = setTimeout(pollLive, POLL_MS);
  }

  function onVisibilityChange() {
    if (document.visibilityState === 'visible') {
      if (pollTimer) clearTimeout(pollTimer);
      pollLive();
    }
  }

  onMount(() => {
    pollTimer = setTimeout(pollLive, POLL_MS);
    document.addEventListener('visibilitychange', onVisibilityChange);
  });
  onDestroy(() => {
    pollStopped = true;
    if (pollTimer) clearTimeout(pollTimer);
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', onVisibilityChange);
    }
  });

  async function copyAddress() {
    await navigator.clipboard.writeText(data.leader.address);
    copied = true;
    setTimeout(() => (copied = false), 1500);
  }

  async function refresh() {
    refreshing = true;
    try {
      const res = await fetch(`/api/leaders/${data.leader.address}/refresh`, { method: 'POST' });
      if (res.ok) location.reload();
    } finally {
      refreshing = false;
    }
  }

  // POST to the deepen endpoint. On success, reload so the new fills feed
  // into the equity curve + recent-fills + stats. On 409 (in_progress) we
  // poll-by-reload after a short pause; on 4xx/5xx we surface the message.
  async function deepenHistory() {
    deepening = true;
    deepenError = null;
    try {
      const res = await fetch(`/api/trader/${data.leader.address}/deepen`, { method: 'POST' });
      if (res.ok) {
        location.reload();
        return;
      }
      if (res.status === 409) {
        deepenError = 'another deepen is already running — try again in a moment';
      } else {
        const text = await res.text().catch(() => '');
        deepenError = text || `deepen failed (${res.status})`;
      }
    } catch (e) {
      deepenError = e instanceof Error ? e.message : 'network error';
    } finally {
      deepening = false;
    }
  }

  function hideBrokenAvatar(e: Event) {
    const img = e.currentTarget as HTMLImageElement;
    img.style.visibility = 'hidden';
  }

  function priceFmt(n: number): string {
    if (n >= 100) return n.toFixed(2);
    if (n >= 1) return n.toFixed(3);
    return n.toFixed(4);
  }
  function sizeFmt(n: number): string {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
    if (n >= 10_000) return `${(n / 1_000).toFixed(1)}K`;
    if (n >= 100) return n.toFixed(0);
    return n.toFixed(2);
  }
  function signedUsd(n: number): string {
    const sign = n < 0 ? '-' : '';
    return `${sign}${formatUsd(Math.abs(n), { precise: false })}`;
  }

  const decayLabel = $derived(
    data.leader.scoring?.decay_flag === 'green'
      ? 'Hot'
      : data.leader.scoring?.decay_flag === 'yellow'
        ? 'Cooling'
        : data.leader.scoring?.decay_flag === 'red'
          ? 'Cold'
          : null,
  );

  // ── Position-derived aggregates ─────────────────────────────────────
  const openPositions = $derived(live.open_positions);
  const longNotional = $derived(
    openPositions.filter((p) => p.side === 'long').reduce((s, p) => s + p.positionValueUsd, 0),
  );
  const shortNotional = $derived(
    openPositions.filter((p) => p.side === 'short').reduce((s, p) => s + p.positionValueUsd, 0),
  );
  const totalNotional = $derived(longNotional + shortNotional);
  const sumUnrealized = $derived(
    openPositions.reduce((s, p) => s + p.unrealizedPnl, 0),
  );
  // HL returns funding positive when the trader paid. Flip the sign so red = bad.
  const sumFundingDisplay = $derived(
    -openPositions.reduce((s, p) => s + (p.funding ?? 0), 0),
  );
  // Gross account leverage = sum(|position notional|) / equity. Falls back to
  // server-computed `leverage` when the positions snapshot is empty.
  const grossLeverage = $derived(
    data.leader.account_value && data.leader.account_value > 0 && openPositions.length > 0
      ? totalNotional / data.leader.account_value
      : (data.leader.leverage ?? null),
  );
  const marginUsagePct = $derived(
    data.leader.margin_used != null && data.leader.account_value && data.leader.account_value > 0
      ? data.leader.margin_used / data.leader.account_value
      : null,
  );
  const freeMargin = $derived(
    data.leader.margin_used != null && data.leader.account_value != null
      ? data.leader.account_value - data.leader.margin_used
      : null,
  );
  // Closest position to liquidation drives the card's "from liquidation" line.
  const minDistToLiq = $derived(
    openPositions.length === 0
      ? null
      : openPositions.reduce<number | null>((best, p) => {
          if (p.distToLiqPct == null) return best;
          return best == null || p.distToLiqPct < best ? p.distToLiqPct : best;
        }, null),
  );
  const longShare = $derived(totalNotional > 0 ? longNotional / totalNotional : null);
  const shortShare = $derived(totalNotional > 0 ? shortNotional / totalNotional : null);
  const directionBiasLabel = $derived.by(() => {
    if (longShare == null) return null;
    if (longShare >= 0.85) return 'Very Bullish';
    if (longShare >= 0.6) return 'Bullish';
    if (longShare >= 0.4) return 'Neutral';
    if (longShare >= 0.15) return 'Bearish';
    return 'Very Bearish';
  });
  const directionBiasDir = $derived(longShare == null ? null : longShare >= 0.5 ? 'long' : 'short');

  // ── Equity-curve windowing ─────────────────────────────────────────
  const windowedSeries = $derived.by(() => {
    const full = data.leader.equity_curve;
    if (chartWindow === 'all' || full.length === 0) return full;
    const last = full[full.length - 1]!.ts;
    const ms = chartWindow === '24h' ? 24 * 3600_000 : chartWindow === '7d' ? 7 * 86400_000 : 30 * 86400_000;
    const cutoff = last - ms;
    return full.filter((p) => p.ts >= cutoff);
  });
  const windowedPnl = $derived(
    windowedSeries.length === 0
      ? null
      : windowedSeries[windowedSeries.length - 1]!.value - windowedSeries[0]!.value,
  );
  const chartWindowLabel = $derived(
    chartWindow === '24h' ? '24H' : chartWindow === '7d' ? '7D' : chartWindow === '30d' ? '30D' : 'ALL',
  );
</script>

<svelte:head>
  <title>{shortAddress(data.leader.address)} — Swash</title>
</svelte:head>

<main id="main-content" class="stripe-content">
  <a href="/" class="k-trader-back">← back to leaderboard</a>

  <div class="k-tp-shell">
    <!-- ── Left rail ───────────────────────────────────────────────── -->
    <aside class="k-tp-rail">
      <!-- Identity (placeholders reserved for display name + X link) -->
      <section class="k-tp-rail-section k-tp-identity">
        <img
          src={effigyUrl(data.leader.address)}
          alt=""
          onerror={hideBrokenAvatar}
          class="k-tp-avatar"
        />
        <div class="k-tp-identity-body">
          <div class="k-tp-name-row">
            <!-- TODO(social): display_name slot — falls back to truncated address until labels ship -->
            <h1 class="k-tp-name">{shortAddress(data.leader.address)}</h1>
            <!-- TODO(social): X (Twitter) link slot — hidden until we store socials -->
            <span class="k-tp-social k-tp-social-placeholder" aria-hidden="true">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M18.244 2H21l-6.52 7.453L22.5 22H16.18l-4.95-6.475L5.4 22H2.64l6.97-7.967L1.5 2h6.42l4.48 5.92Zm-2.21 18h1.49L7.05 4H5.45z"/>
              </svg>
            </span>
          </div>
          <button class="k-tp-address" onclick={copyAddress} aria-label="Copy address" title="Copy address">
            <span class="k-tp-address-text">{shortAddress(data.leader.address, 6, 4)}</span>
            {#if copied}
              <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="#59A0AC" stroke-width="2"><path d="M3 8 L7 12 L13 4" stroke-linecap="round" stroke-linejoin="round"/></svg>
            {:else}
              <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="5" y="5" width="9" height="9" rx="1.5"/><path d="M3 11 V3 a1.5 1.5 0 0 1 1.5 -1.5 H10" stroke-linecap="round"/></svg>
            {/if}
          </button>
          <div class="k-tp-tag-row">
            <Tag tag={data.leader.primary_tag} />
            {#if data.leader.agent_count > 0}
              <span class="stripe-badge stripe-badge-neutral">
                +{data.leader.agent_count} agent{data.leader.agent_count > 1 ? 's' : ''}
              </span>
            {/if}
          </div>
        </div>
      </section>

      <!-- Composite score + decay flag + behavioral tags -->
      <section class="k-tp-rail-section k-tp-score-panel">
        <div class="k-tp-score-head">
          <p class="k-stat-label">Swash Score</p>
          {#if decayLabel}
            <span class="stripe-badge stripe-badge-neutral">{decayLabel}</span>
          {/if}
        </div>
        <p class="k-tp-score-value">
          {data.leader.score ?? '—'}<span class="k-tp-score-of"> / 100</span>
        </p>
        {#if data.leader.tags.length > 0}
          <div class="k-tp-score-tags">
            {#each data.leader.tags as t (t.type + t.value)}
              <span class="stripe-badge stripe-badge-neutral">{t.value}</span>
            {/each}
          </div>
        {/if}
        <button onclick={refresh} disabled={refreshing} class="btn-poly k-tp-refresh">
          {refreshing ? 'Refreshing…' : 'Refresh'}
        </button>
      </section>

      <!-- Account value -->
      <section class="k-tp-rail-section">
        <p class="k-stat-label">Account Value</p>
        <p class="k-tp-big-value">{formatUsd(data.leader.account_value, { precise: false })}</p>
      </section>

      <!-- Account equity breakdown (Perps populated; Spot/Staked placeholders) -->
      <section class="k-tp-rail-section">
        <p class="k-stat-label">Account Equity</p>
        <dl class="k-tp-kv">
          <div><dt>Perps</dt><dd>{formatUsd(data.leader.account_value, { precise: false })}</dd></div>
          <div><dt>Spot</dt><dd class="stripe-text-tertiary" title="Not tracked yet">—</dd></div>
          <div><dt>Staked</dt><dd class="stripe-text-tertiary" title="Not tracked yet">—</dd></div>
        </dl>
      </section>

      <!-- Overview -->
      <section class="k-tp-rail-section">
        <p class="k-stat-label">Overview</p>
        <dl class="k-tp-kv">
          <div>
            <dt>Unrealized PnL</dt>
            <dd class={pnlSignClass(sumUnrealized)}>{formatPnl(sumUnrealized)}</dd>
          </div>
          <div>
            <dt>Account Leverage</dt>
            <dd>{grossLeverage == null ? '—' : `${grossLeverage.toFixed(2)}×`}</dd>
          </div>
          <div>
            <dt>Margin Usage</dt>
            <dd>{marginUsagePct == null ? '—' : formatPct(marginUsagePct, 2)}</dd>
          </div>
          <div>
            <dt>All-Time PnL</dt>
            <dd class={pnlSignClass(data.leader.scoring?.net_pnl_usd ?? null)}>
              {formatPnl(data.leader.scoring?.net_pnl_usd ?? null)}
            </dd>
          </div>
          <div>
            <dt>Volume</dt>
            <dd>{formatUsd(data.leader.total_volume_usd, { precise: false })}</dd>
          </div>
        </dl>
      </section>

      <!-- Analysis (Trading Style intentionally omitted per scope) -->
      <section class="k-tp-rail-section">
        <p class="k-stat-label">Analysis</p>
        <dl class="k-tp-kv">
          <!-- TODO(pass-2): derive from consecutive winning round-trips -->
          <div><dt>Longest Win Streak</dt><dd class="stripe-text-tertiary">—</dd></div>
          <!-- TODO(pass-2): derive from round-trip durations -->
          <div><dt>Avg Trade Duration</dt><dd class="stripe-text-tertiary">—</dd></div>
          <div><dt>Median Trade Duration</dt><dd class="stripe-text-tertiary">—</dd></div>
          <!-- TODO(pass-2): bucketize all-time PnL -->
          <div><dt>PnL Cohort</dt><dd class="stripe-text-tertiary">—</dd></div>
        </dl>
      </section>
    </aside>

    <!-- ── Main column ─────────────────────────────────────────────── -->
    <div class="k-tp-main">
      <!-- 4-card stat row -->
      <div class="k-tp-stat-row">
        <article class="k-tp-stat-card">
          <div class="k-tp-stat-card-head">
            <span class="k-stat-label">Performance</span>
            <span class="stripe-text-tertiary stripe-body-sm">All</span>
          </div>
          <p class="k-tp-stat-card-value {pnlSignClass(data.leader.scoring?.net_pnl_usd ?? null)}">
            {formatPnl(data.leader.scoring?.net_pnl_usd ?? null)}
          </p>
          <p class="stripe-text-tertiary stripe-body-sm">
            {formatPct(data.leader.scoring?.win_rate ?? null, 1)} Win Rate ·
            {(data.leader.scoring?.total_trades ?? 0).toLocaleString()} Trades
          </p>
        </article>

        <article class="k-tp-stat-card">
          <span class="k-stat-label">Leverage</span>
          <p class="k-tp-stat-card-value">
            {grossLeverage == null ? '—' : `${grossLeverage.toFixed(1)}×`}
          </p>
          <div class="k-tp-meter">
            <div class="k-tp-meter-fill" style:width="{Math.min((grossLeverage ?? 0) / 5, 1) * 100}%"></div>
          </div>
          <p class="stripe-text-tertiary stripe-body-sm">
            {formatUsd(totalNotional, { precise: false })} Notional ·
            {formatUsd(data.leader.account_value, { precise: false })} Equity
          </p>
        </article>

        <article class="k-tp-stat-card">
          <span class="k-stat-label">Margin Usage</span>
          <p class="k-tp-stat-card-value">
            {marginUsagePct == null ? '—' : formatPct(marginUsagePct, 2)}
          </p>
          <div class="k-tp-meter">
            <div class="k-tp-meter-fill" style:width="{Math.min(marginUsagePct ?? 0, 1) * 100}%"></div>
          </div>
          <p class="stripe-text-tertiary stripe-body-sm">
            {freeMargin == null ? '—' : formatUsd(freeMargin, { precise: false })} Free
            {#if minDistToLiq != null}· {(minDistToLiq * 100).toFixed(2)}% from Liquidation{/if}
          </p>
        </article>

        <article class="k-tp-stat-card">
          <span class="k-stat-label">Direction Bias</span>
          <p class="k-tp-stat-card-value {directionBiasDir === 'long' ? 'k-pnl-positive' : directionBiasDir === 'short' ? 'k-pnl-negative' : ''}">
            {directionBiasLabel ?? '—'}
            {#if directionBiasDir === 'long'}<span aria-hidden="true">↗</span>{:else if directionBiasDir === 'short'}<span aria-hidden="true">↘</span>{/if}
          </p>
          <div class="k-tp-meter k-tp-meter-split">
            <div class="k-tp-meter-fill k-tp-meter-long" style:width="{(longShare ?? 0) * 100}%"></div>
            <div class="k-tp-meter-fill k-tp-meter-short" style:width="{(shortShare ?? 0) * 100}%"></div>
          </div>
          <p class="stripe-text-tertiary stripe-body-sm">
            {longShare == null ? '—' : `${Math.round(longShare * 100)}% · Long ${formatUsd(longNotional, { precise: false })}`}
            ·
            {shortShare == null ? '—' : `${Math.round(shortShare * 100)}% · Short ${formatUsd(shortNotional, { precise: false })}`}
          </p>
        </article>
      </div>

      <!-- Main chart -->
      <section class="k-tp-chart-section k-card">
        <div class="k-tp-chart-head">
          <div>
            <p class="k-stat-label">{chartWindowLabel} Perps PnL</p>
            <p class="k-tp-chart-value {pnlSignClass(windowedPnl)}">{formatPnl(windowedPnl)}</p>
          </div>
          <div class="k-tp-chart-controls" role="tablist" aria-label="Chart window">
            {#each ['24h', '7d', '30d', 'all'] as w (w)}
              <button
                type="button"
                class="k-tp-pill"
                class:is-active={chartWindow === w}
                onclick={() => (chartWindow = w as typeof chartWindow)}
              >{w === 'all' ? 'ALL' : w.toUpperCase()}</button>
            {/each}
          </div>
        </div>
        {#if !data.leader.history_deepened_at}
          <!-- Default fills retention is 90 days. Click the button to backfill
               older history from HL (one wallet per click; durable). -->
          <div class="k-tp-deepen">
            <span class="stripe-text-tertiary stripe-body-sm">
              Showing last 90 days — older history was trimmed.
            </span>
            <button
              type="button"
              class="btn-poly k-tp-deepen-btn"
              disabled={deepening}
              onclick={deepenHistory}
            >
              {deepening ? 'Loading history…' : 'Show all history'}
            </button>
          </div>
          {#if deepenError}
            <p class="stripe-text-tertiary stripe-body-sm" style="color: var(--stripe-danger); margin: 4px 0 0;">
              {deepenError}
            </p>
          {/if}
        {/if}
        {#if windowedSeries.length === 0}
          <p class="k-empty">no equity curve yet</p>
        {:else}
          <EquityChart series={windowedSeries} />
        {/if}
        <p class="stripe-text-tertiary stripe-body-sm" style="margin-top: 8px;">
          cumulative realized pnl, master + agents
          {#if data.leader.last_trade_at}
            · last trade {formatRelativeTime(data.leader.last_trade_at)}
          {/if}
        </p>
      </section>

      <!-- Bottom tabs -->
      <section class="k-tp-tabs-section">
        <div class="k-tp-tabs" role="tablist" aria-label="Trader detail tabs">
          <button class="k-tp-tab" class:is-active={activeTab === 'positions'} onclick={() => (activeTab = 'positions')} role="tab" aria-selected={activeTab === 'positions'}>
            Positions <span class="k-tp-tab-count">{openPositions.length}</span>
          </button>
          <button class="k-tp-tab" class:is-active={activeTab === 'fills'} onclick={() => (activeTab = 'fills')} role="tab" aria-selected={activeTab === 'fills'}>
            Fills
          </button>
          <button class="k-tp-tab" class:is-active={activeTab === 'trades'} onclick={() => (activeTab = 'trades')} role="tab" aria-selected={activeTab === 'trades'}>
            Trades
          </button>
          <button class="k-tp-tab" class:is-active={activeTab === 'performance'} onclick={() => (activeTab = 'performance')} role="tab" aria-selected={activeTab === 'performance'}>
            Performance
          </button>
        </div>

        {#if activeTab === 'positions'}
          {#if openPositions.length === 0}
            <div class="k-card k-empty">
              {live.live_refreshed_at ? 'no open positions' : 'no snapshot yet — click refresh to fetch'}
            </div>
          {:else}
            <div class="k-positions-bar">
              <div class="k-positions-bar-left">
                <span>long <strong class="k-fills-side-buy">{formatUsd(longNotional, { precise: false })}</strong></span>
                <span>·</span>
                <span>short <strong class="k-fills-side-sell">{formatUsd(shortNotional, { precise: false })}</strong></span>
                <span>·</span>
                <span>total <strong>{formatUsd(totalNotional, { precise: false })}</strong></span>
              </div>
              <div class="k-positions-bar-right">
                <span>sum funding <strong class={pnlSignClass(sumFundingDisplay)}>{signedUsd(sumFundingDisplay)}</strong></span>
                <span>·</span>
                <span>sum pnl <strong class={pnlSignClass(sumUnrealized)}>{formatPnl(sumUnrealized)}</strong></span>
              </div>
            </div>
            <div class="k-card" style="padding: 0; overflow: hidden;">
              <div style="overflow-x: auto;">
                <table class="k-fills-table k-positions-table">
                  <thead>
                    <tr>
                      <th>Token</th>
                      <th class="right">Amount</th>
                      <th class="right">Value</th>
                      <th class="right">Avg entry</th>
                      <th class="right">Live</th>
                      <th class="right">PnL / ROE</th>
                      <th class="right">Funding</th>
                      <th>Dist. to liq</th>
                    </tr>
                  </thead>
                  <tbody>
                    {#each openPositions as p (p.coin + p.side)}
                      <tr>
                        <td>
                          <span class="k-positions-side-stripe {p.side === 'long' ? 'k-positions-side-long' : 'k-positions-side-short'}"></span>
                          <span class="k-positions-symbol">{p.coin}</span>
                          <span class="stripe-text-tertiary">
                            {p.leverage}×{p.leverageType ? ` ${p.leverageType}` : ''}
                          </span>
                        </td>
                        <td class="right">{p.side === 'short' ? '-' : ''}{sizeFmt(p.size)}</td>
                        <td class="right">{formatUsd(p.positionValueUsd, { precise: false })}</td>
                        <td class="right">${priceFmt(p.entryPx)}</td>
                        <td class="right">${priceFmt(p.markPx)}</td>
                        <td class="right {pnlSignClass(p.unrealizedPnl)}">
                          <div>{formatPnl(p.unrealizedPnl)}</div>
                          <div class="stripe-text-tertiary">
                            {p.roe == null ? '—' : `${(p.roe * 100).toFixed(2)}%`}
                          </div>
                        </td>
                        <td class="right {pnlSignClass(p.funding == null ? 0 : -p.funding)}">
                          {p.funding == null ? '—' : signedUsd(-p.funding)}
                        </td>
                        <td>
                          {#if p.distToLiqPct == null || p.liquidationPx == null}
                            <span class="stripe-text-tertiary">—</span>
                          {:else}
                            <div class="k-distliq">
                              <span class="k-distliq-pct">{Math.round(p.distToLiqPct * 100)}%</span>
                              <div class="k-distliq-bar">
                                <div
                                  class="k-distliq-fill"
                                  style:width="{Math.min(p.distToLiqPct / 0.5, 1) * 100}%"
                                  style:background={
                                    p.distToLiqPct < 0.1
                                      ? '#ff5d75'
                                      : p.distToLiqPct < 0.25
                                        ? '#d4a017'
                                        : '#16f199'
                                  }
                                ></div>
                              </div>
                              <span class="k-distliq-px">${priceFmt(p.liquidationPx)}</span>
                            </div>
                          {/if}
                        </td>
                      </tr>
                    {/each}
                  </tbody>
                </table>
              </div>
            </div>
          {/if}
        {:else if activeTab === 'fills'}
          <div class="k-card" style="padding: 0; overflow: hidden;">
            <div style="display: flex; align-items: center; justify-content: space-between; padding: 14px 18px; border-bottom: 0.5px solid var(--stripe-border);">
              <p class="k-stat-label" style="margin: 0;">Recent fills</p>
              <span class="stripe-text-tertiary stripe-body-sm">last {live.recent_fills.length}</span>
            </div>
            <div style="max-height: 540px; overflow-y: auto;">
              <table class="k-fills-table">
                <thead>
                  <tr>
                    <th>Time</th>
                    <th>Coin</th>
                    <th>Side</th>
                    <th class="right">Px</th>
                    <th class="right">Notional</th>
                    <th class="right">PnL</th>
                  </tr>
                </thead>
                <tbody>
                  {#each live.recent_fills as f (f.tid)}
                    <tr>
                      <td style="color: var(--stripe-text-muted);">{formatRelativeTime(new Date(f.block_time_ms))}</td>
                      <td>{f.coin}</td>
                      <td class={f.side === 'B' ? 'k-fills-side-buy' : 'k-fills-side-sell'}>
                        {f.side === 'B' ? 'buy' : 'sell'}
                        {#if !f.crossed}<span class="k-fills-maker-flag">M</span>{/if}
                      </td>
                      <td class="right">{f.px.toFixed(4)}</td>
                      <td class="right">{formatUsd(f.notional)}</td>
                      <td class="right {pnlSignClass(f.closed_pnl)}">
                        {f.closed_pnl !== 0 ? formatPnl(f.closed_pnl) : '—'}
                      </td>
                    </tr>
                  {/each}
                </tbody>
              </table>
            </div>
          </div>
        {:else if activeTab === 'trades'}
          <div class="k-card k-empty">
            <!-- TODO(pass-3): surface round-trip aggregation from packages/scoring -->
            Round-trip view coming soon.
          </div>
        {:else if activeTab === 'performance'}
          <div class="k-card">
            <p class="k-stat-label" style="margin-bottom: 12px;">Asset breakdown</p>
            {#if data.leader.primary_asset_breakdown.length > 0}
              <div class="k-asset-list">
                {#each data.leader.primary_asset_breakdown as a (a.coin)}
                  <div class="k-asset-row">
                    <div class="k-asset-row-meta">
                      <span class="k-asset-row-name">{a.coin}</span>
                      <span>{(a.share * 100).toFixed(1)}%</span>
                    </div>
                    <div class="k-asset-row-bar">
                      <div class="k-asset-row-fill" style="width: {a.share * 100}%;"></div>
                    </div>
                  </div>
                {/each}
              </div>
            {:else}
              <p class="k-empty">no fills yet</p>
            {/if}
          </div>
        {/if}
      </section>
    </div>
  </div>
</main>

<style>
  /* Trader-profile layout — uses the existing design tokens so cards visually
     match .k-card / .k-stat-label everywhere else in the app. All rail and
     stat-card backgrounds share .k-card's surface so the page reads as one
     family. */

  .k-tp-shell {
    display: grid;
    grid-template-columns: 300px minmax(0, 1fr);
    gap: var(--space-4);
    align-items: start;
  }
  /* Aligns with the app-wide 1023/1024 nav-switch breakpoint: when the
     sidenav appears at 1024px, content shrinks by 200px and the rail+main
     two-column layout finally fits. Below 1024 we use mobile chrome, so
     stack everything to avoid awkward in-between widths. */
  @media (max-width: 1023px) {
    .k-tp-shell { grid-template-columns: minmax(0, 1fr); }
  }

  /* ── Rail ─────────────────────────────────────────────────────── */
  .k-tp-rail {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }
  /* Same surface as .k-card so cards stack visually. */
  .k-tp-rail-section {
    background: var(--stripe-bg-primary);
    border: 0.5px solid var(--stripe-border);
    border-radius: var(--radius-md);
    padding: var(--space-4);
  }
  .k-tp-identity {
    display: flex;
    gap: var(--space-3);
    align-items: flex-start;
  }
  .k-tp-avatar {
    width: 44px;
    height: 44px;
    border-radius: var(--radius-full);
    flex-shrink: 0;
    border: 0.5px solid var(--stripe-border);
  }
  .k-tp-identity-body {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    min-width: 0;
    flex: 1;
  }
  .k-tp-name-row { display: flex; align-items: center; gap: var(--space-2); }
  .k-tp-name {
    font-size: 15px;
    font-weight: 600;
    margin: 0;
    color: var(--stripe-text-primary);
  }
  .k-tp-social {
    color: var(--stripe-text-tertiary);
    display: inline-flex;
    align-items: center;
    text-decoration: none;
  }
  /* Reserved slot — invisible until socials ingestion ships. */
  .k-tp-social-placeholder { visibility: hidden; pointer-events: none; }
  .k-tp-address {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    padding: 0;
    border: none;
    background: transparent;
    cursor: pointer;
    color: var(--stripe-text-tertiary);
    font-family: var(--font-mono);
    font-size: 11px;
  }
  .k-tp-tag-row {
    display: flex;
    gap: var(--space-1);
    flex-wrap: wrap;
    margin-top: var(--space-1);
  }

  .k-tp-score-panel {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }
  .k-tp-score-head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: var(--space-2);
  }
  .k-tp-score-value {
    font-size: 32px;
    font-weight: 600;
    line-height: 1;
    margin: 0;
    color: var(--stripe-text-primary);
    font-variant-numeric: tabular-nums;
  }
  .k-tp-score-of {
    font-size: 13px;
    color: var(--stripe-text-tertiary);
    font-weight: 400;
  }
  .k-tp-score-tags { display: flex; gap: var(--space-1); flex-wrap: wrap; }
  .k-tp-refresh { margin-top: var(--space-1); width: 100%; }

  .k-tp-big-value {
    font-size: 20px;
    font-weight: 600;
    color: var(--stripe-text-primary);
    margin: var(--space-1) 0 0 0;
    font-variant-numeric: tabular-nums;
  }

  .k-tp-kv {
    margin: var(--space-2) 0 0 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }
  .k-tp-kv > div {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: var(--space-2);
  }
  .k-tp-kv dt {
    color: var(--stripe-text-tertiary);
    font-size: 12px;
  }
  .k-tp-kv dd {
    margin: 0;
    color: var(--stripe-text-primary);
    font-size: 13px;
    font-variant-numeric: tabular-nums;
  }

  /* ── Main column ──────────────────────────────────────────────── */
  .k-tp-main {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    min-width: 0;
  }

  /* Auto-fit drops cards based on available width, not viewport. Solves the
     1024–1280px dead zone where the sidenav appeared but four cards still
     tried to fit into the shrunken main column. 220px floor keeps the PnL
     and meter sub-lines legible; cards wrap to 3-up / 2-up / 1-up naturally. */
  .k-tp-stat-row {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
    gap: var(--space-3);
  }
  .k-tp-stat-card {
    background: var(--stripe-bg-primary);
    border: 0.5px solid var(--stripe-border);
    border-radius: var(--radius-md);
    padding: var(--space-4);
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    min-width: 0;
  }
  .k-tp-stat-card-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  .k-tp-stat-card-value {
    font-size: 22px;
    font-weight: 600;
    line-height: 1.1;
    margin: 0;
    color: var(--stripe-text-primary);
    font-variant-numeric: tabular-nums;
  }

  .k-tp-meter {
    height: 4px;
    border-radius: var(--radius-sm);
    background: var(--stripe-bg-tertiary);
    overflow: hidden;
    display: flex;
  }
  .k-tp-meter-fill {
    height: 100%;
    background: var(--stripe-text-tertiary);
  }
  .k-tp-meter-split .k-tp-meter-long  { background: var(--stripe-success); }
  .k-tp-meter-split .k-tp-meter-short { background: var(--stripe-danger); }

  .k-tp-chart-section { padding: var(--space-4); }
  .k-tp-chart-head {
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    gap: var(--space-3);
    flex-wrap: wrap;
    margin-bottom: var(--space-3);
  }
  .k-tp-chart-value {
    font-size: 20px;
    font-weight: 600;
    margin: var(--space-1) 0 0 0;
    color: var(--stripe-text-primary);
    font-variant-numeric: tabular-nums;
  }
  .k-tp-chart-controls { display: flex; gap: var(--space-1); }
  .k-tp-pill {
    background: transparent;
    border: 0.5px solid var(--stripe-border);
    border-radius: var(--radius-sm);
    padding: 4px 10px;
    color: var(--stripe-text-tertiary);
    font-family: var(--font-sans);
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.05em;
    cursor: pointer;
  }
  .k-tp-pill:hover { color: var(--stripe-text-secondary); border-color: var(--stripe-border-light); }
  .k-tp-pill.is-active {
    color: var(--stripe-text-primary);
    border-color: var(--stripe-text-secondary);
    background: var(--stripe-bg-secondary);
  }

  .k-tp-deepen {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
    padding: var(--space-2) 0;
    border-bottom: 0.5px dashed var(--stripe-border);
    margin-bottom: var(--space-3);
    flex-wrap: wrap;
  }
  .k-tp-deepen-btn {
    padding: 4px 12px;
    font-size: 12px;
  }

  .k-tp-tabs-section { display: flex; flex-direction: column; gap: var(--space-3); }
  .k-tp-tabs {
    display: flex;
    gap: var(--space-1);
    border-bottom: 0.5px solid var(--stripe-border);
    overflow-x: auto;
  }
  .k-tp-tab {
    background: transparent;
    border: none;
    border-bottom: 2px solid transparent;
    color: var(--stripe-text-tertiary);
    padding: var(--space-2) var(--space-3);
    font-family: var(--font-sans);
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
    letter-spacing: 0.02em;
    white-space: nowrap;
  }
  .k-tp-tab:hover { color: var(--stripe-text-secondary); }
  .k-tp-tab.is-active {
    color: var(--stripe-text-primary);
    border-bottom-color: var(--stripe-accent);
  }
  .k-tp-tab-count {
    color: var(--stripe-text-tertiary);
    margin-left: 4px;
    font-variant-numeric: tabular-nums;
  }
</style>
