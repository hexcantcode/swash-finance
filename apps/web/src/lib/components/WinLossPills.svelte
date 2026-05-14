<script lang="ts">
  interface Props {
    /** Closed round-trip outcomes, oldest first. Newer entries paint on the
     *  right so the strip reads as a left-to-right timeline. */
    results: Array<{ pnlUsd: number; closeTimeMs?: number }>;
    /** Total pill slots. Missing entries paint as inactive placeholders so
     *  short histories still render a fixed-width strip. */
    slots?: number;
  }
  let { results, slots = 5 }: Props = $props();

  // Right-align: pad-left so the newest result always sits in the rightmost
  // slot regardless of how many results we have. With slots=5 and a partial
  // `results.length=3`, slots 0..1 are null padding and slots 2..4 carry
  // results[0..2] — newest of the three lands on the right edge.
  const padded = $derived(
    Array.from({ length: slots }, (_, i) => {
      const offset = i - (slots - results.length);
      return offset < 0 ? null : (results[offset] ?? null);
    }),
  );

  // Same dimensions as ScoreBars so the column lines up visually with the
  // score column on the main leaderboard.
  const BAR_W = 5;
  const GAP = 2;
  const H = 12;
  const W = slots * BAR_W + (slots - 1) * GAP;
</script>

<svg
  class="k-winloss-pills"
  viewBox="0 0 {W} {H}"
  width={W}
  height={H}
  role="img"
  aria-label="Last {results.length} closed round trips"
>
  {#each padded as r, i (i)}
    <rect
      x={i * (BAR_W + GAP)}
      y="0"
      width={BAR_W}
      height={H}
      rx="1"
      fill={r === null
        ? 'rgba(255, 255, 255, 0.1)'
        : r.pnlUsd >= 0
          ? 'var(--stripe-success)'
          : 'var(--stripe-danger)'}
    >
      {#if r !== null}
        <title>{r.pnlUsd >= 0 ? '+' : ''}{r.pnlUsd.toFixed(2)} USD</title>
      {/if}
    </rect>
  {/each}
</svg>
