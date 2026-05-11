<script lang="ts">
  import Tag from '$lib/components/Tag.svelte';
</script>

<svelte:head>
  <title>methodology — Swish</title>
</svelte:head>

<main id="main-content" class="stripe-content" style="max-width: 760px;">
  <p class="stripe-text-accent stripe-caption">Methodology</p>
  <h1 class="stripe-heading-xl" style="margin-top: 8px;">how leaders are scored</h1>
  <p class="stripe-text-secondary stripe-body" style="margin-top: 16px; line-height: 1.7;">
    Every wallet on Hyperliquid is observable. Reading PnL is easy. Telling whether a high PnL is
    skill versus luck is the hard part. We try to do that, transparently.
  </p>

  <h2 class="stripe-heading-md" style="margin-top: 48px;">1. discovery</h2>
  <p class="stripe-text-secondary" style="margin-top: 12px; line-height: 1.7;">
    A worker subscribes to Hyperliquid's WebSocket trades feed for the top 20 perp markets and
    captures every wallet that fills a trade. New addresses join a queue.
  </p>

  <h2 class="stripe-heading-md" style="margin-top: 40px;">2. ingest with agent attribution</h2>
  <p class="stripe-text-secondary" style="margin-top: 12px; line-height: 1.7;">
    For each queued wallet we fetch 90 days of fills, funding payments, and ledger updates.
    Critically, we also call <code style="font-family: var(--font-mono); color: var(--stripe-accent);">extraAgents</code>
    to find every approved agent wallet, fetch their fills too, and roll them up to the master.
    This prevents two failure modes:
  </p>
  <ul style="margin-top: 12px; padding-left: 24px; line-height: 1.8; color: var(--stripe-text-secondary);">
    <li>a trader using agents looks like they did nothing.</li>
    <li>an agent wallet looks like a high-frequency standalone trader.</li>
  </ul>

  <h2 class="stripe-heading-md" style="margin-top: 40px;">3. net pnl (deposits matter)</h2>
  <p class="stripe-text-secondary" style="margin-top: 12px; line-height: 1.7;">
    On-chain "PnL" includes deposits — that's wrong. A trader who deposits $10K starts at +$10K of
    "profit." We subtract net deposits explicitly:
  </p>
  <pre style="margin-top: 12px; padding: 16px 20px; border: 0.5px solid var(--stripe-border); border-radius: var(--radius-md); background: var(--stripe-bg-primary); font-family: var(--font-mono); font-size: 12px; line-height: 1.6; color: var(--stripe-text-secondary); overflow-x: auto;">gross_pnl   = Σ(fills.closedPnl) + Σ(fundings.usdc) − Σ(fills.fee)
net_deposit = Σ(deposit.usdc) − Σ(withdraw.usdc)
net_pnl     = gross_pnl − net_deposit</pre>

  <h2 class="stripe-heading-md" style="margin-top: 40px;">4. probabilistic + deflated sharpe</h2>
  <p class="stripe-text-secondary" style="margin-top: 12px; line-height: 1.7;">
    The PSR (Bailey & López de Prado, 2012) takes an observed Sharpe ratio and produces the
    probability that the true Sharpe exceeds a benchmark, given the sample's skewness and
    kurtosis. Heavy-tailed strategies need more observations to clear the same bar.
  </p>
  <p class="stripe-text-secondary" style="margin-top: 12px; line-height: 1.7;">
    Deflated Sharpe (López de Prado, 2018) shifts the benchmark up to account for selection bias.
    When you screen thousands of wallets and pick the best, the highest observed Sharpe overstates
    the true Sharpe. We compute the variance of Sharpes across the entire scored population and
    feed it into DSR.
  </p>

  <h2 class="stripe-heading-md" style="margin-top: 40px;">5. composite (0–100)</h2>
  <p class="stripe-text-secondary" style="margin-top: 12px; line-height: 1.7;">
    Eight weighted criteria produce the composite score. Each contributes a fixed number of points.
  </p>
  <div class="k-table-wrap" style="margin-top: 16px;">
    <table class="stripe-table" style="min-width: 0;">
      <thead>
        <tr>
          <th style="text-align: left; padding-left: 20px;">Criterion</th>
          <th>Points</th>
        </tr>
      </thead>
      <tbody>
        {#each [
          ['PSR > 0.95 AND ≥ 100 trades', 25],
          ['DSR > 0', 15],
          ['Max drawdown < 30%', 10],
          ['Profit factor > 1.5', 10],
          ['Maker share between 20–70%', 10],
          ['Avg hold > 5 minutes', 10],
          ['Diversified across ≥ 3 assets', 10],
          ['Recent Sharpe ≥ 70% of peak', 10],
        ] as [label, points] (label)}
          <tr>
            <td style="text-align: left; padding-left: 20px; color: var(--stripe-text-secondary);">{label}</td>
            <td>{points}</td>
          </tr>
        {/each}
      </tbody>
    </table>
  </div>

  <h2 class="stripe-heading-md" style="margin-top: 40px;">6. behavioral tags</h2>
  <p class="stripe-text-secondary" style="margin-top: 12px; line-height: 1.7;">
    The score tells you "how good" — the tag tells you "what kind of trader." A high-PSR
    daily-position trader and a high-PSR scalper need different copy strategies; we don't merge
    them.
  </p>

  <div style="margin-top: 16px; display: grid; gap: 12px; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));">
    {#each [
      { tag: 'alpha_hunter', desc: 'Proven directional skill at significant sample. PSR > 0.95, ≥100 trades, ≥90 active days, max DD < 30%.' },
      { tag: 'veteran', desc: 'High sample, long history, sustained performance. ≥500 trades, ≥365 active days, PSR ≥ 0.8.' },
      { tag: 'insider', desc: 'Fresh wallet (<60 days) with concentrated, event-driven activity.' },
      { tag: 'specialist', desc: 'Dominant in one asset or category. Asset concentration > 60% with ≥50 trades.' },
      { tag: 'dark_horse', desc: 'Small sample (<50 trades) with strong signal (PSR > 0.9) and recent activity.' },
    ] as item (item.tag)}
      <div class="k-card">
        <Tag tag={item.tag} />
        <p class="stripe-text-secondary" style="margin-top: 12px; font-size: 13px; line-height: 1.6;">
          {item.desc}
        </p>
      </div>
    {/each}
  </div>

  <h2 class="stripe-heading-md" style="margin-top: 40px;">limitations</h2>
  <ul style="margin-top: 12px; padding-left: 24px; line-height: 1.8; color: var(--stripe-text-secondary);">
    <li>capital base is approximated as initial deposit + cumulative net deposits. sub-account transfers and vault flows we don't see can distort daily-return calculations.</li>
    <li><code style="font-family: var(--font-mono); color: var(--stripe-accent);">extraAgents</code> returns currently-approved agents only. a leader who revoked an agent loses that agent's pre-revoke history.</li>
    <li>score recompute is daily. recent activity drives the rolling-Sharpe / decay flag, but the composite itself updates once per UTC day.</li>
    <li>none of this is financial advice. past performance — even bias-corrected — does not guarantee future results.</li>
  </ul>

  <footer class="k-footer">
    <span>questions? read the <a href="https://github.com/anthropics/claude-code">source</a></span>
    <a href="/about">about →</a>
  </footer>
</main>
