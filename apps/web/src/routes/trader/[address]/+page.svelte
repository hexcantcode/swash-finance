<script lang="ts">
  import EquityChart from '$lib/components/EquityChart.svelte';
  import Tag from '$lib/components/Tag.svelte';
  import {
    effigyUrl,
    formatDuration,
    formatPct,
    formatPnl,
    formatRelativeTime,
    formatTradesPerWeek,
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

  function fmt(n: number | null | undefined, frac = 2): string {
    if (n === null || n === undefined || !Number.isFinite(n)) return '—';
    return n.toFixed(frac);
  }

  function formatRoiInline(value: number | null | undefined): string {
    if (value === null || value === undefined || !Number.isFinite(value)) return '—';
    const pct = value * 100;
    if (Math.abs(pct) >= 1000) return `${(pct / 100).toFixed(1)}x`;
    if (Math.abs(pct) >= 100) return `${pct.toFixed(0)}%`;
    return `${pct.toFixed(1)}%`;
  }

  function hideBrokenAvatar(e: Event) {
    const img = e.currentTarget as HTMLImageElement;
    img.style.visibility = 'hidden';
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

  // Open-positions monitor (kismet "perps" bar + table). Numbers come from
  // leader_cache, which is populated on the user-triggered refresh. Anything
  // not in the snapshot stays null/empty so the section gracefully shows
  // "no snapshot yet — click refresh".
  const openPositions = $derived(data.leader.open_positions);
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
  // HL returns funding positive when the trader paid. Flip the sign so the UI
  // reads "red = bad for trader, green = trader earned".
  const sumFundingDisplay = $derived(
    -openPositions.reduce((s, p) => s + (p.funding ?? 0), 0),
  );
  const grossLeverage = $derived(
    data.leader.account_value && data.leader.account_value > 0
      ? totalNotional / data.leader.account_value
      : null,
  );

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
</script>

<svelte:head>
  <title>{shortAddress(data.leader.address)} — Swash</title>
</svelte:head>

<main id="main-content" class="stripe-content">
  <a href="/" class="k-trader-back">← back to leaderboard</a>

  <header class="k-trader-header">
    <div class="k-trader-top">
      <img
        src={effigyUrl(data.leader.address)}
        alt=""
        onerror={hideBrokenAvatar}
        class="k-trader-avatar stripe-avatar stripe-avatar-ring"
      />
      <div class="k-trader-meta">
        <div class="k-trader-tag-row">
          <Tag tag={data.leader.primary_tag} />
          {#if decayLabel}
            <span class="stripe-badge stripe-badge-neutral">{decayLabel}</span>
          {/if}
          {#if data.leader.agent_count > 0}
            <span class="stripe-badge stripe-badge-neutral">
              +{data.leader.agent_count} agent{data.leader.agent_count > 1 ? 's' : ''}
            </span>
          {/if}
        </div>
        <div class="k-trader-address">
          <span class="k-trader-address-text">{shortAddress(data.leader.address, 10, 8)}</span>
          <button class="k-trader-copy" onclick={copyAddress} aria-label="Copy address" title="Copy address">
            {#if copied}
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="#59A0AC" stroke-width="2"><path d="M3 8 L7 12 L13 4" stroke-linecap="round" stroke-linejoin="round"/></svg>
            {:else}
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="5" y="5" width="9" height="9" rx="1.5"/><path d="M3 11 V3 a1.5 1.5 0 0 1 1.5 -1.5 H10" stroke-linecap="round"/></svg>
            {/if}
          </button>
          <a
            href="https://app.hyperliquid.xyz/explorer/address/{data.leader.address}"
            target="_blank"
            rel="noreferrer"
            class="k-trader-copy"
            aria-label="Open in Hyperliquid explorer"
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M6 3 H3 V13 H13 V10" stroke-linecap="round"/><path d="M9 3 H13 V7" stroke-linecap="round" stroke-linejoin="round"/><path d="M13 3 L7 9" stroke-linecap="round"/></svg>
          </a>
        </div>
        <p class="stripe-text-tertiary stripe-body-sm">
          last trade {formatRelativeTime(data.leader.last_trade_at)}
          {#if data.leader.scoring?.computed_at}
            · scored {formatRelativeTime(data.leader.scoring.computed_at)}
          {/if}
        </p>
      </div>
      <div class="k-trader-composite">
        <p class="k-stat-label">Composite</p>
        <p class="k-trader-composite-value">
          {data.leader.composite_score ?? '—'}
          <span class="k-trader-composite-of">/ 100</span>
        </p>
        <button onclick={refresh} disabled={refreshing} class="btn-poly k-trader-refresh">
          {refreshing ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>
    </div>

    <div class="k-trader-stats">
      <div class="k-trader-stat">
        <span class="k-trader-stat-label">Net PnL</span>
        <span class="k-trader-stat-value {pnlSignClass(data.leader.scoring?.net_pnl_usd ?? null)}">
          {formatPnl(data.leader.scoring?.net_pnl_usd ?? null)}
        </span>
      </div>
      <div class="k-trader-stat">
        <span class="k-trader-stat-label">ROI</span>
        <span class="k-trader-stat-value {pnlSignClass(data.leader.scoring?.net_pnl_pct ?? null)}">
          {formatRoiInline(data.leader.scoring?.net_pnl_pct ?? null)}
        </span>
      </div>
      <div class="k-trader-stat">
        <span class="k-trader-stat-label">PSR</span>
        <span class="k-trader-stat-value">{fmt(data.leader.scoring?.psr ?? null, 3)}</span>
      </div>
      <div class="k-trader-stat">
        <span class="k-trader-stat-label">Sharpe</span>
        <span class="k-trader-stat-value">{fmt(data.leader.scoring?.sharpe ?? null, 2)}</span>
      </div>
      <div class="k-trader-stat">
        <span class="k-trader-stat-label">Max DD</span>
        <span class="k-trader-stat-value">{formatPct(data.leader.scoring?.max_drawdown_pct ?? null)}</span>
      </div>
      <div class="k-trader-stat">
        <span class="k-trader-stat-label">Win rate</span>
        <span class="k-trader-stat-value">{formatPct(data.leader.scoring?.win_rate ?? null, 0)}</span>
      </div>
      <div class="k-trader-stat">
        <span class="k-trader-stat-label">Copyability</span>
        <span
          class="k-trader-stat-value"
          title={data.leader.copyability_notes.length > 0
            ? data.leader.copyability_notes.join(' · ')
            : undefined}
        >
          {formatPct(data.leader.copyability, 0)}
        </span>
      </div>
      <div class="k-trader-stat">
        <span class="k-trader-stat-label">Avg hold</span>
        <span class="k-trader-stat-value">{formatDuration(data.leader.scoring?.avg_hold_seconds ?? null)}</span>
      </div>
      <div class="k-trader-stat">
        <span class="k-trader-stat-label">Trades</span>
        <span class="k-trader-stat-value">{(data.leader.scoring?.total_trades ?? 0).toLocaleString()}</span>
      </div>
      <div class="k-trader-stat">
        <span class="k-trader-stat-label">Frequency</span>
        <span class="k-trader-stat-value" title="Weekly trade average">
          {formatTradesPerWeek(
            data.leader.scoring?.trades_per_day_avg != null
              ? data.leader.scoring.trades_per_day_avg * 7
              : null,
          )}
        </span>
      </div>
    </div>
  </header>

  <!-- Equity curve -->
  <section class="k-trader-section">
    <div class="k-section-head">
      <h2 class="k-section-title">90-day equity curve</h2>
      <span class="stripe-text-tertiary stripe-body-sm">
        cumulative realized pnl, master + agents
      </span>
    </div>
    <div class="k-card">
      <EquityChart series={data.leader.equity_curve} />
    </div>
  </section>

  <!-- Open positions snapshot (from leader_cache, populated on refresh) -->
  <section class="k-trader-section">
    <div class="k-section-head">
      <h2 class="k-section-title">
        Open positions
        <span class="k-section-count">({openPositions.length})</span>
      </h2>
      <span class="stripe-text-tertiary stripe-body-sm">
        {#if data.leader.account_value != null}
          equity {formatUsd(data.leader.account_value, { precise: false })}
        {/if}
        {#if grossLeverage != null}
          · {grossLeverage.toFixed(2)}× gross
        {/if}
        {#if data.leader.positions_refreshed_at}
          · snapshot {formatRelativeTime(data.leader.positions_refreshed_at)}
        {:else}
          · no snapshot yet — click refresh
        {/if}
      </span>
    </div>

    {#if openPositions.length === 0}
      <div class="k-card k-empty">
        {data.leader.positions_refreshed_at ? 'no open positions' : 'no snapshot yet — click refresh to fetch'}
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
                      {p.roe == null
                        ? '—'
                        : `${(p.roe * 100).toFixed(2)}%`}
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
  </section>

  <!-- Asset breakdown + recent fills -->
  <section class="k-trader-section">
    <h2 class="k-section-title">Activity</h2>
    <div style="display: grid; gap: 16px; grid-template-columns: minmax(0, 1fr) minmax(0, 2fr);">
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

      <div class="k-card" style="padding: 0; overflow: hidden;">
        <div style="display: flex; align-items: center; justify-content: space-between; padding: 16px 20px; border-bottom: 0.5px solid var(--stripe-border);">
          <p class="k-stat-label" style="margin: 0;">Recent fills</p>
          <span class="stripe-text-tertiary stripe-body-sm">
            last {data.leader.recent_fills.length}
          </span>
        </div>
        <div style="max-height: 420px; overflow-y: auto;">
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
              {#each data.leader.recent_fills as f (f.tid)}
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
    </div>
  </section>
</main>
