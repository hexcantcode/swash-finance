<script lang="ts">
  // Trade ticket — Basic (guided sliders) + Pro (full order ticket) tabs.
  // Data-stage placeholder: every number computes live off the mark price,
  // but nothing submits until wallet connection ships. Paper balance only.
  import MobileSheet from './MobileSheet.svelte';
  import { appSheet } from '$lib/ui/sheets.svelte';
  import { coinDisplayName } from '$lib/utils/coin';
  import { formatUsd } from '$lib/utils/format';

  const BALANCE = 10_000; // paper balance until wallets connect
  const LEV_MAX = 25;
  const TAKER_FEE = 0.00045; // HL base tier
  const MAKER_FEE = 0.00015;

  const open = $derived(appSheet.active === 'trade' && appSheet.trade !== null);
  const coin = $derived(appSheet.trade?.coin ?? '');
  const entry = $derived(appSheet.trade?.price ?? 0);

  let tab = $state<'basic' | 'pro'>('basic');
  let side = $state<'long' | 'short'>('long');

  // ----- Basic — three guided sliders -----
  let invest = $state(1000);
  let lev = $state(3);
  let risk = $state(100);

  // ----- Pro — full ticket -----
  let marginMode = $state<'cross' | 'isolated'>('cross');
  let orderType = $state<'market' | 'limit' | 'stop-market' | 'stop-limit'>('market');
  let limitPx = $state(0);
  let triggerPx = $state(0);
  let sizeUsd = $state(1000);
  let sizeUnit = $state<'usd' | 'coin'>('usd');
  let proLev = $state(3);
  let reduceOnly = $state(false);
  let tif = $state<'gtc' | 'ioc' | 'alo'>('gtc');
  let slippagePct = $state(1);
  let tpPx = $state<number | null>(null);
  let slPx = $state<number | null>(null);

  // Reset the ticket whenever it opens on a (new) market.
  $effect(() => {
    if (open) {
      tab = 'basic';
      side = 'long';
      invest = Math.min(1000, BALANCE);
      lev = 3;
      risk = 100;
      marginMode = 'cross';
      orderType = 'market';
      limitPx = entry;
      triggerPx = entry;
      sizeUsd = 1000;
      sizeUnit = 'usd';
      proLev = 3;
      reduceOnly = false;
      tif = 'gtc';
      slippagePct = 1;
      tpPx = null;
      slPx = null;
    }
  });

  // Estimated liquidation (simplified — cross-margin maintenance ignored):
  // long liq = entry·(1 − 1/lev), short liq = entry·(1 + 1/lev).
  function liqPrice(l: number): number {
    return side === 'long' ? entry * (1 - 1 / l) : entry * (1 + 1 / l);
  }

  // ----- Basic deriveds -----
  const positionUsd = $derived(invest * lev);
  const basicLiq = $derived(liqPrice(lev));
  /** stop distance as a price fraction: risk$ = invest·lev·dist ⇒ dist = risk/(invest·lev). */
  const stopDist = $derived(positionUsd > 0 ? risk / positionUsd : 0);
  const stopPx = $derived(side === 'long' ? entry * (1 - stopDist) : entry * (1 + stopDist));
  /** true when the stop sits past the liquidation price — the position dies first. */
  const stopBeyondLiq = $derived(stopDist >= 1 / lev);
  const levRatio = $derived((lev - 1) / (LEV_MAX - 1));

  // ----- Pro deriveds -----
  const refPx = $derived(orderType === 'limit' || orderType === 'stop-limit' ? limitPx || entry : entry);
  const proSizeUsd = $derived(sizeUnit === 'usd' ? sizeUsd : sizeUsd * refPx);
  const proCoinSize = $derived(refPx > 0 ? proSizeUsd / refPx : 0);
  const marginReq = $derived(proLev > 0 ? proSizeUsd / proLev : 0);
  const proLiq = $derived(liqPrice(proLev));
  const isTaker = $derived(orderType === 'market' || orderType === 'stop-market' || tif === 'ioc');
  const feeEst = $derived(proSizeUsd * (isTaker ? TAKER_FEE : MAKER_FEE));
  const tpPnl = $derived(tpPx !== null && tpPx > 0 ? proCoinSize * (side === 'long' ? tpPx! - refPx : refPx - tpPx!) : null);
  const slPnl = $derived(slPx !== null && slPx > 0 ? proCoinSize * (side === 'long' ? slPx! - refPx : refPx - slPx!) : null);

  const fmt = (v: number) => formatUsd(v, { decimals: 3 });
  /** exact dollars — a ticket needs $1,000, not $1.0K. */
  const usd = (v: number) => `$${Math.round(v).toLocaleString('en-US')}`;
  const usd2 = (v: number) => `$${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const needsLimitPx = $derived(orderType === 'limit' || orderType === 'stop-limit');
  const needsTrigger = $derived(orderType === 'stop-market' || orderType === 'stop-limit');
</script>

<MobileSheet {open} onclose={() => appSheet.close()} label={`Trade ${coinDisplayName(coin)}`}>
  <div class="t-scroll">
    <h2 class="t-title">Trade {coinDisplayName(coin)}</h2>
    <p class="t-mark">Mark {fmt(entry)}</p>

    <!-- Basic / Pro tabs -->
    <div class="t-tabs" role="tablist" aria-label="Ticket mode">
      <button type="button" role="tab" aria-selected={tab === 'basic'} class="t-tab tappable" class:is-active={tab === 'basic'} onclick={() => (tab = 'basic')}>Basic</button>
      <button type="button" role="tab" aria-selected={tab === 'pro'} class="t-tab tappable" class:is-active={tab === 'pro'} onclick={() => (tab = 'pro')}>Pro</button>
    </div>

    <!-- Direction -->
    <div class="t-side" role="radiogroup" aria-label="Direction">
      <button
        type="button"
        class="t-side-btn is-long tappable"
        class:is-active={side === 'long'}
        onclick={() => (side = 'long')}
      >
        Long
      </button>
      <button
        type="button"
        class="t-side-btn is-short tappable"
        class:is-active={side === 'short'}
        onclick={() => (side = 'short')}
      >
        Short
      </button>
    </div>

    {#if tab === 'basic'}
      <!-- 1 · Investment -->
      <div class="t-field">
        <div class="t-field-head">
          <span class="t-label">How much do you want to invest?</span>
          <span class="t-value">{usd(invest)}</span>
        </div>
        <input class="t-slider" type="range" min="0" max={BALANCE} step="50" bind:value={invest} aria-label="Investment amount" />
        <div class="t-scale"><span>$0</span><span>Balance {usd(BALANCE)}</span></div>
      </div>

      <!-- 2 · Leverage -->
      <div class="t-field">
        <div class="t-field-head">
          <span class="t-label">How much leverage?</span>
          <span class="t-value">{lev}×</span>
        </div>
        <input
          class="t-slider t-slider-risk"
          type="range"
          min="1"
          max={LEV_MAX}
          step="1"
          bind:value={lev}
          aria-label="Leverage"
          style:--risk-pos={`${levRatio * 100}%`}
        />
        <div class="t-scale"><span>1× · safer</span><span>{LEV_MAX}× · riskier</span></div>
        <p class="t-hint">Est. liquidation <strong class="is-{side}">{fmt(basicLiq)}</strong> — the position closes there.</p>
      </div>

      <!-- 3 · Risk -->
      <div class="t-field">
        <div class="t-field-head">
          <span class="t-label">How much are you willing to risk?</span>
          <span class="t-value">{usd(risk)}</span>
        </div>
        <input class="t-slider" type="range" min="0" max={invest} step="10" bind:value={risk} aria-label="Risk amount" disabled={invest === 0} />
        <div class="t-scale"><span>$0</span><span>All {usd(invest)}</span></div>
        {#if invest > 0 && risk > 0}
          {#if stopBeyondLiq}
            <p class="t-hint is-warn">That risk sits past liquidation — lower leverage or risk less.</p>
          {:else}
            <p class="t-hint">Stop loss at <strong>{fmt(stopPx)}</strong> — you lose at most {usd(risk)}.</p>
          {/if}
        {/if}
      </div>

      <!-- Summary -->
      <dl class="t-summary">
        <div><dt>Position</dt><dd>{usd(positionUsd)} {side}</dd></div>
        <div><dt>Entry</dt><dd>{fmt(entry)}</dd></div>
        <div><dt>Stop loss</dt><dd>{invest > 0 && risk > 0 && !stopBeyondLiq ? fmt(stopPx) : '—'}</dd></div>
        <div><dt>Liquidation</dt><dd>{fmt(basicLiq)}</dd></div>
      </dl>
    {:else}
      <!-- Pro — full ticket -->
      <div class="t-row">
        <div class="t-seg" role="radiogroup" aria-label="Margin mode">
          <button type="button" class="t-seg-btn tappable" class:is-active={marginMode === 'cross'} onclick={() => (marginMode = 'cross')}>Cross</button>
          <button type="button" class="t-seg-btn tappable" class:is-active={marginMode === 'isolated'} onclick={() => (marginMode = 'isolated')}>Isolated</button>
        </div>
        <div class="t-lev-box">
          <label class="t-mini-label" for="t-pro-lev">Leverage</label>
          <div class="t-lev-input">
            <input id="t-pro-lev" type="number" min="1" max={LEV_MAX} bind:value={proLev} />
            <span>×</span>
          </div>
        </div>
      </div>

      <div class="t-chiprow" role="radiogroup" aria-label="Order type">
        {#each [['market', 'Market'], ['limit', 'Limit'], ['stop-market', 'Stop market'], ['stop-limit', 'Stop limit']] as [key, label] (key)}
          <button type="button" class="t-chip tappable" class:is-active={orderType === key} onclick={() => (orderType = key as typeof orderType)}>{label}</button>
        {/each}
      </div>

      {#if needsTrigger}
        <div class="t-input-field">
          <label for="t-trigger">Trigger price</label>
          <input id="t-trigger" type="number" min="0" step="any" bind:value={triggerPx} />
        </div>
      {/if}
      {#if needsLimitPx}
        <div class="t-input-field">
          <label for="t-limit">Limit price</label>
          <input id="t-limit" type="number" min="0" step="any" bind:value={limitPx} />
        </div>
      {/if}

      <div class="t-input-field">
        <label for="t-size">Size</label>
        <div class="t-size-row">
          <input id="t-size" type="number" min="0" step="any" bind:value={sizeUsd} />
          <div class="t-seg t-seg-sm" role="radiogroup" aria-label="Size unit">
            <button type="button" class="t-seg-btn tappable" class:is-active={sizeUnit === 'usd'} onclick={() => (sizeUnit = 'usd')}>USD</button>
            <button type="button" class="t-seg-btn tappable" class:is-active={sizeUnit === 'coin'} onclick={() => (sizeUnit = 'coin')}>{coinDisplayName(coin)}</button>
          </div>
        </div>
        <p class="t-hint">≈ {sizeUnit === 'usd' ? `${proCoinSize.toFixed(5)} ${coinDisplayName(coin)}` : usd(proSizeUsd)}</p>
      </div>

      <div class="t-input-field">
        <span class="t-mini-label">Take profit / Stop loss</span>
        <div class="t-tpsl">
          <input type="number" min="0" step="any" placeholder="TP price" bind:value={tpPx} aria-label="Take profit price" />
          <input type="number" min="0" step="any" placeholder="SL price" bind:value={slPx} aria-label="Stop loss price" />
        </div>
        {#if tpPnl !== null || slPnl !== null}
          <p class="t-hint">
            {#if tpPnl !== null}TP est. <strong class="is-gain">{usd(tpPnl)}</strong>{/if}
            {#if tpPnl !== null && slPnl !== null}&nbsp;·&nbsp;{/if}
            {#if slPnl !== null}SL est. <strong class="is-loss">{usd(slPnl)}</strong>{/if}
          </p>
        {/if}
      </div>

      <div class="t-row">
        <div class="t-seg" role="radiogroup" aria-label="Time in force">
          <button type="button" class="t-seg-btn tappable" class:is-active={tif === 'gtc'} onclick={() => (tif = 'gtc')}>GTC</button>
          <button type="button" class="t-seg-btn tappable" class:is-active={tif === 'ioc'} onclick={() => (tif = 'ioc')}>IOC</button>
          <button type="button" class="t-seg-btn tappable" class:is-active={tif === 'alo'} onclick={() => (tif = 'alo')}>Post only</button>
        </div>
        <label class="t-check">
          <input type="checkbox" bind:checked={reduceOnly} />
          Reduce only
        </label>
      </div>

      {#if orderType === 'market' || orderType === 'stop-market'}
        <div class="t-input-field">
          <label for="t-slip">Max slippage %</label>
          <input id="t-slip" type="number" min="0" max="10" step="0.1" bind:value={slippagePct} />
        </div>
      {/if}

      <dl class="t-summary">
        <div><dt>Order value</dt><dd>{usd(proSizeUsd)}</dd></div>
        <div><dt>Margin required</dt><dd>{usd(marginReq)} · {marginMode}</dd></div>
        <div><dt>Est. liquidation</dt><dd>{fmt(proLiq)}</dd></div>
        <div><dt>Est. fee</dt><dd>{usd2(feeEst)} · {isTaker ? 'taker' : 'maker'}</dd></div>
      </dl>
    {/if}

    <button type="button" class="t-cta m-cta-primary tappable" onclick={() => appSheet.close()}>
      Connect wallet to trade
    </button>
    <p class="t-paper">Paper ticket — orders go live when wallets connect.</p>
  </div>
</MobileSheet>

<style>
  .t-scroll {
    max-height: 72vh;
    overflow-y: auto;
    -webkit-overflow-scrolling: touch;
  }
  .t-title {
    margin: 0;
    font-family: var(--font-sans);
    font-size: var(--type-headline);
    font-weight: 600;
    color: var(--stripe-text-primary);
  }
  .t-mark {
    margin: 2px 0 var(--space-3);
    font-family: var(--font-mono);
    font-size: var(--type-caption);
    color: var(--stripe-text-tertiary);
    font-variant-numeric: tabular-nums;
  }

  /* Direction — segmented, colored by side */
  .t-side {
    display: flex;
    gap: var(--space-1);
    padding: var(--space-1);
    background: var(--stripe-bg-secondary);
    border-radius: var(--radius-lg);
    margin-bottom: var(--space-3);
  }
  .t-side-btn {
    flex: 1;
    min-height: 40px;
    border: 0;
    border-radius: var(--radius-md);
    background: transparent;
    font-family: var(--font-mono);
    font-size: var(--type-subhead);
    font-weight: 600;
    color: var(--stripe-text-secondary);
    cursor: pointer;
  }
  .t-side-btn.is-long.is-active { background: var(--stripe-success-subtle); color: var(--stripe-success); }
  .t-side-btn.is-short.is-active { background: var(--stripe-danger-subtle); color: var(--stripe-danger); }

  /* Basic / Pro tabs — feed-tab language */
  .t-tabs {
    display: flex;
    gap: var(--space-1);
    padding: var(--space-1);
    background: var(--stripe-bg-secondary);
    border: 1px solid var(--stripe-border-light);
    border-radius: var(--radius-lg);
    margin-bottom: var(--space-3);
  }
  .t-tab {
    flex: 1;
    min-height: 32px;
    border: 0;
    border-radius: var(--radius-lg);
    background: transparent;
    color: var(--stripe-text-secondary);
    font-family: var(--font-mono);
    font-size: var(--type-footnote);
    cursor: pointer;
  }
  .t-tab.is-active {
    /* Lighter (elevated) tone marks the selected mode. */
    background: var(--stripe-bg-elevated);
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.08);
    color: var(--stripe-text-primary);
  }

  /* Basic sliders */
  .t-field { margin-bottom: var(--space-5); }
  .t-field-head {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: var(--space-2);
    margin-bottom: var(--space-2);
  }
  .t-label {
    font-size: var(--type-footnote);
    color: var(--stripe-text-secondary);
  }
  .t-value {
    font-family: var(--font-mono);
    font-size: var(--type-subhead);
    font-weight: 500;
    color: var(--stripe-text-primary);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }
  .t-slider {
    width: 100%;
    height: 28px;
    margin: 0;
    appearance: none;
    -webkit-appearance: none;
    background: transparent;
  }
  .t-slider::-webkit-slider-runnable-track {
    height: 6px;
    border-radius: var(--radius-full);
    background: var(--stripe-bg-hover);
  }
  .t-slider::-webkit-slider-thumb {
    -webkit-appearance: none;
    width: 22px;
    height: 22px;
    margin-top: -8px;
    border-radius: var(--radius-full);
    background: var(--stripe-accent);
    border: 2px solid var(--stripe-bg-primary);
    box-shadow: 0 1px 4px rgba(0, 0, 0, 0.3);
  }
  .t-slider:disabled { opacity: 0.4; }
  /* Leverage track — the whole scale shows the risk ramp. */
  .t-slider-risk::-webkit-slider-runnable-track {
    background: linear-gradient(90deg, var(--stripe-success), var(--stripe-warning) 55%, var(--stripe-danger));
  }
  .t-scale {
    display: flex;
    justify-content: space-between;
    margin-top: 2px;
    font-family: var(--font-mono);
    font-size: var(--type-caption);
    color: var(--stripe-text-tertiary);
  }
  .t-hint {
    margin: var(--space-2) 0 0;
    font-size: var(--type-footnote);
    color: var(--stripe-text-secondary);
  }
  .t-hint strong { font-family: var(--font-mono); font-weight: 600; color: var(--stripe-text-primary); }
  .t-hint strong.is-long, .t-hint strong.is-short { color: var(--stripe-text-primary); }
  .t-hint.is-warn { color: var(--stripe-warning); }
  .t-hint .is-gain { color: var(--stripe-success); }
  .t-hint .is-loss { color: var(--stripe-danger); }

  /* Summary */
  .t-summary {
    margin: 0 0 var(--space-4);
    padding: var(--space-3);
    background: var(--stripe-bg-secondary);
    border-radius: var(--radius-md);
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }
  .t-summary div { display: flex; justify-content: space-between; }
  .t-summary dt { font-size: var(--type-footnote); color: var(--stripe-text-tertiary); }
  .t-summary dd {
    margin: 0;
    font-family: var(--font-mono);
    font-size: var(--type-footnote);
    color: var(--stripe-text-primary);
    font-variant-numeric: tabular-nums;
  }

  /* Pro controls */
  .t-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
    margin-bottom: var(--space-4);
  }
  .t-seg {
    display: flex;
    gap: 2px;
    padding: 2px;
    background: var(--stripe-bg-secondary);
    border-radius: var(--radius-md);
  }
  .t-seg-btn {
    min-height: 32px;
    padding: 0 var(--space-3);
    border: 0;
    border-radius: calc(var(--radius-md) - 2px);
    background: transparent;
    font-family: var(--font-mono);
    font-size: var(--type-caption);
    color: var(--stripe-text-secondary);
    cursor: pointer;
    white-space: nowrap;
  }
  .t-seg-btn.is-active {
    background: var(--glass-pressed-bg);
    box-shadow: var(--glass-pressed-inset);
    color: var(--stripe-text-primary);
  }
  .t-seg-sm .t-seg-btn { min-height: 28px; padding: 0 var(--space-2); }
  .t-lev-box { display: flex; align-items: center; gap: var(--space-2); }
  .t-mini-label {
    font-size: var(--type-caption);
    color: var(--stripe-text-tertiary);
  }
  .t-lev-input {
    display: flex;
    align-items: center;
    gap: 2px;
    font-family: var(--font-mono);
    color: var(--stripe-text-primary);
  }
  .t-lev-input input {
    width: 48px;
    min-height: 32px;
    text-align: right;
  }
  .t-chiprow {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-1);
    margin-bottom: var(--space-4);
  }
  .t-chip {
    min-height: 32px;
    padding: 0 var(--space-3);
    border: 1px solid var(--stripe-border);
    border-radius: var(--radius-full);
    background: transparent;
    font-family: var(--font-mono);
    font-size: var(--type-caption);
    color: var(--stripe-text-secondary);
    cursor: pointer;
  }
  .t-chip.is-active {
    border-color: transparent;
    background: var(--glass-pressed-bg);
    box-shadow: var(--glass-pressed-inset);
    color: var(--stripe-text-primary);
  }
  .t-input-field { margin-bottom: var(--space-4); }
  .t-input-field label {
    display: block;
    margin-bottom: var(--space-1);
    font-size: var(--type-caption);
    color: var(--stripe-text-tertiary);
  }
  .t-input-field input,
  .t-lev-input input,
  .t-tpsl input {
    border: 1px solid var(--stripe-border);
    border-radius: var(--radius-md);
    background: var(--stripe-bg-secondary);
    color: var(--stripe-text-primary);
    font-family: var(--font-mono);
    font-size: var(--type-subhead);
    font-variant-numeric: tabular-nums;
    padding: var(--space-2) var(--space-3);
    width: 100%;
    min-height: 40px;
  }
  .t-size-row { display: flex; gap: var(--space-2); align-items: center; }
  .t-size-row input { flex: 1; }
  .t-tpsl { display: flex; gap: var(--space-2); }
  .t-check {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    font-size: var(--type-footnote);
    color: var(--stripe-text-secondary);
    white-space: nowrap;
  }
  .t-check input { width: 18px; height: 18px; accent-color: var(--stripe-accent); }

  /* CTA */
  .t-cta {
    width: 100%;
    min-height: 48px;
    border-radius: var(--radius-lg);
    margin-top: var(--space-2);
  }
  .t-paper {
    margin: var(--space-2) 0 0;
    text-align: center;
    font-family: var(--font-mono);
    font-size: var(--type-caption);
    color: var(--stripe-text-tertiary);
  }
</style>
