<svelte:head>
  <title>about — Swish</title>
</svelte:head>

<main id="main-content" class="stripe-content" style="max-width: 760px;">
  <p class="stripe-text-accent stripe-caption">About</p>
  <h1 class="stripe-heading-xl" style="margin-top: 8px;">a trader list, not a feed.</h1>
  <p class="stripe-text-secondary stripe-body" style="margin-top: 16px; line-height: 1.7;">
    Most "copytrade" interfaces show you names. The interesting question is which trader to follow
    in the first place. swish makes that the first-class problem.
  </p>

  <h2 class="stripe-heading-md" style="margin-top: 48px;">what we do</h2>
  <p class="stripe-text-secondary" style="margin-top: 12px; line-height: 1.7;">
    Continuously index every wallet active on Hyperliquid. Score each one with statistical methods
    that account for the multiple-comparisons problem. Tag them by how they actually trade — not
    just what they returned.
  </p>

  <h2 class="stripe-heading-md" style="margin-top: 40px;">what we don't do (yet)</h2>
  <p class="stripe-text-secondary" style="margin-top: 12px; line-height: 1.7;">
    v0.5 is read-only. You can browse, look at the data, decide who looks credible. There is no
    automated copy execution, no agent wallet flow, no payment of any kind. That ships in v1.
  </p>

  <h2 class="stripe-heading-md" style="margin-top: 40px;">why it's defensible</h2>
  <p class="stripe-text-secondary" style="margin-top: 12px; line-height: 1.7;">
    Behavioral classification (alpha hunter / veteran / insider / specialist / dark horse) layered
    on quantitative filters (PSR, DSR, profit factor, drawdown profile) is not available on
    Hyperdash, ASXN, or HypurrScan today. The trader list itself is the product.
  </p>

  <h2 class="stripe-heading-md" style="margin-top: 40px;">risk disclosure</h2>
  <p class="stripe-text-secondary" style="margin-top: 12px; line-height: 1.7;">
    Trading perpetuals is high-risk. Past performance does not predict future returns, even when
    statistically corrected. We surface raw fills and let you check our work — the
    <a href="/methodology" style="color: var(--stripe-accent);">methodology page</a>
    walks through every formula.
  </p>

  <footer class="k-footer">
    <span>swish · v0.5 discovery preview</span>
    <a href="/methodology">methodology →</a>
  </footer>
</main>
