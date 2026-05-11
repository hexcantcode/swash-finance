<script lang="ts">
  import Tag from '$lib/components/Tag.svelte';
</script>

<svelte:head>
  <title>methodology — Swash</title>
</svelte:head>

<main id="main-content" class="stripe-content" style="max-width: 760px;">
  <p class="stripe-text-accent stripe-caption">Methodology</p>
  <h1 class="stripe-heading-xl" style="margin-top: 8px;">how leaders are scored</h1>
  <p class="stripe-text-secondary stripe-body" style="margin-top: 16px; line-height: 1.7;">
    Every wallet on Hyperliquid is observable. Reading PnL is easy. Telling whether a high PnL is
    skill versus luck is the hard part — that's what this score does, transparently.
  </p>

  <h2 class="stripe-heading-md" style="margin-top: 48px;">1. discovery &amp; curation</h2>
  <p class="stripe-text-secondary" style="margin-top: 12px; line-height: 1.7;">
    The "best traders" list is seeded from Hyperliquid's own leaderboard, then filtered. A wallet
    only makes the list if it clears a real bar:
  </p>
  <ul style="margin-top: 12px; padding-left: 24px; line-height: 1.8; color: var(--stripe-text-secondary);">
    <li>≥ $10K account value and ≥ $100K traded volume.</li>
    <li>a genuine track record — first seen ≥ 90 days ago, ≥ 30 active trading days, enough round-trip trades that the numbers aren't noise.</li>
    <li>a reconstructable capital base (we can tell what they put in); if not, the wallet shows "insufficient data" rather than a fabricated return.</li>
    <li>not a market-maker or grid bot — those get a <code style="font-family: var(--font-mono); color: var(--stripe-accent);">market maker</code> tag and stay scoreable, but never appear in the curated list.</li>
  </ul>
  <p class="stripe-text-secondary" style="margin-top: 12px; line-height: 1.7;">
    Any wallet that earns it — found by us or scored on demand — gets added. One that decays below
    the bar drops off.
  </p>

  <h2 class="stripe-heading-md" style="margin-top: 40px;">2. on-demand scoring</h2>
  <p class="stripe-text-secondary" style="margin-top: 12px; line-height: 1.7;">
    Any wallet can be scored on request, not just the curated set. The score is computed fresh (or
    served from a recent cache). Wallets are findable and shareable whether or not they're "the
    best" — score your own wallet, or someone else's.
  </p>

  <h2 class="stripe-heading-md" style="margin-top: 40px;">3. agent attribution</h2>
  <p class="stripe-text-secondary" style="margin-top: 12px; line-height: 1.7;">
    Many leaders trade through approved agent wallets to avoid signing every order. For each wallet
    we also call <code style="font-family: var(--font-mono); color: var(--stripe-accent);">extraAgents</code>,
    pull every agent's fills, and roll them up to the master. This prevents two failure modes:
  </p>
  <ul style="margin-top: 12px; padding-left: 24px; line-height: 1.8; color: var(--stripe-text-secondary);">
    <li>a trader who routes through agents looks like they did nothing.</li>
    <li>an agent wallet looks like a standalone high-frequency trader.</li>
  </ul>

  <h2 class="stripe-heading-md" style="margin-top: 40px;">4. risk-adjusted returns</h2>
  <p class="stripe-text-secondary" style="margin-top: 12px; line-height: 1.7;">
    From a daily return series — built against an estimated capital base, with deposits and
    withdrawals removed — we compute the usual battery: Sharpe, Sortino, profit factor, win-rate-adjusted
    expectancy, max drawdown, recovery time, and monthly consistency (copy-traders care more about
    "doesn't blow up" than "spiky 10×").
  </p>
  <p class="stripe-text-secondary" style="margin-top: 12px; line-height: 1.7;">
    On top of that, the <strong>Probabilistic Sharpe Ratio</strong> (Bailey &amp; López de Prado,
    2012): the probability the true Sharpe beats a benchmark, given the sample's size, skewness, and
    kurtosis. A heavy-tailed strategy or a short history has to clear a higher bar — a great-looking
    Sharpe from twenty days barely registers.
  </p>
  <p class="stripe-text-secondary" style="margin-top: 12px; line-height: 1.7;">
    Sharpe and Sortino are weighted by track record: a one-month hot streak doesn't get
    extrapolated into a full year.
  </p>

  <h2 class="stripe-heading-md" style="margin-top: 40px;">5. the composite (0–100)</h2>
  <p class="stripe-text-secondary" style="margin-top: 12px; line-height: 1.7;">
    Each metric below is mapped onto a 0–100 scale by a curve calibrated against real Hyperliquid
    wallet histories. The composite is the <strong>median</strong> of the eight — median, not a sum
    or an average, so one freak metric can't inflate or tank the score.
  </p>
  <div class="k-table-wrap" style="margin-top: 16px;">
    <table class="stripe-table" style="min-width: 0;">
      <thead>
        <tr>
          <th style="text-align: left; padding-left: 20px;">Metric</th>
          <th style="text-align: left;">What it measures</th>
        </tr>
      </thead>
      <tbody>
        {#each [
          ['Sharpe', 'return per unit of total volatility (track-record weighted)'],
          ['Sortino', 'return per unit of downside volatility (track-record weighted)'],
          ['Probabilistic Sharpe', 'confidence the Sharpe is real, given sample size & tails'],
          ['Profit factor', 'gross winning vs. gross losing'],
          ['Expectancy', 'average outcome per trade'],
          ['Max drawdown', 'worst peak-to-trough decline (smaller is better)'],
          ['Recovery time', 'how fast they climb back from a drawdown (faster is better)'],
          ['Monthly consistency', 'share of months net-positive, penalising blow-up months'],
        ] as [label, what] (label)}
          <tr>
            <td style="text-align: left; padding-left: 20px;">{label}</td>
            <td style="text-align: left; color: var(--stripe-text-secondary);">{what}</td>
          </tr>
        {/each}
      </tbody>
    </table>
  </div>
  <p class="stripe-text-secondary" style="margin-top: 16px; line-height: 1.7;">
    A wallet with under ~90 days of history is capped and flagged <em>provisional</em>. It's the
    same number everywhere — the group tags below are filters over it, not separate scores.
  </p>

  <h2 class="stripe-heading-md" style="margin-top: 40px;">6. group tags</h2>
  <p class="stripe-text-secondary" style="margin-top: 12px; line-height: 1.7;">
    The score tells you "how good" — the tag tells you "what kind." A scalper and a swing trader
    with the same composite need different copy strategies; we don't merge them.
  </p>
  <div style="margin-top: 16px; display: grid; gap: 12px; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));">
    {#each [
      { tag: 'alpha_hunter', desc: 'Proven directional skill at meaningful sample — high PSR, plenty of trades, controlled drawdown.' },
      { tag: 'veteran', desc: 'Long history, large sample, performance that has held up over time.' },
      { tag: 'insider', desc: 'Fresh wallet with concentrated, event-driven activity.' },
      { tag: 'specialist', desc: 'Dominant in one asset or category — most of their volume in a single market.' },
      { tag: 'dark_horse', desc: 'Small sample but a strong, recent signal — one to watch, not yet proven.' },
    ] as item (item.tag)}
      <div class="k-card">
        <Tag tag={item.tag} />
        <p class="stripe-text-secondary" style="margin-top: 12px; font-size: 13px; line-height: 1.6;">
          {item.desc}
        </p>
      </div>
    {/each}
  </div>
  <p class="stripe-text-secondary" style="margin-top: 16px; line-height: 1.7;">
    Alongside the archetype, every trader carries lighter tags for cadence (scalp / intraday / swing
    / position), risk (conservative / balanced / aggressive), size (whale → micro by volume), and
    asset class (bluechip / altcoin / meme / stocks).
  </p>

  <h2 class="stripe-heading-md" style="margin-top: 40px;">7. staying current</h2>
  <p class="stripe-text-secondary" style="margin-top: 12px; line-height: 1.7;">
    The curated set is re-scored daily; drift shows up as a <code style="font-family: var(--font-mono); color: var(--stripe-accent);">decay</code>
    flag — recent rolling Sharpe versus peak. Equity, open positions, and last-trade time stream
    live for curated wallets; on-demand scores refresh on a short TTL. Each number on a trader's
    page carries an "as of" stamp so you know how fresh it is.
  </p>

  <h2 class="stripe-heading-md" style="margin-top: 40px;">limitations</h2>
  <ul style="margin-top: 12px; padding-left: 24px; line-height: 1.8; color: var(--stripe-text-secondary);">
    <li>Hyperliquid's fill history returns at most ~2,000 recent fills per wallet — for very active traders we score a recent window, not their entire lifetime.</li>
    <li>capital base is approximated as initial deposit + cumulative net deposits; sub-account transfers and vault flows we don't see can distort the daily-return series.</li>
    <li><code style="font-family: var(--font-mono); color: var(--stripe-accent);">extraAgents</code> returns currently-approved agents only — a leader who revoked an agent loses that agent's pre-revoke history.</li>
    <li>past performance, even bias-corrected, does not guarantee future results. none of this is financial advice.</li>
  </ul>

  <footer class="k-footer">
    <span>questions? read the <a href="https://github.com/hexcantcode/swash.finance">source</a></span>
    <a href="/about">about →</a>
  </footer>
</main>
