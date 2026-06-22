/**
 * Hyperdash copytraders source.
 *
 *   POST https://api.hyperdash.com/graphql   (operation GetSystemGroupTraders)
 *
 * The endpoint is public (no auth) but rejects non-browser User-Agents with
 * {"code":"BLOCKED_USER_AGENT"}, so we send a browser UA + the site
 * origin/referer. groupId "copytraders" is the curated "Best Wallets to
 * Copytrade" top-100. Full provenance + field reference live in the project
 * skill `.claude/skills/hyperdash-top-traders/`.
 */

const HYPERDASH_GRAPHQL = 'https://api.hyperdash.com/graphql';

const QUERY = `query GetSystemGroupTraders($groupId: ID!) {
  getSystemGroupTraders(groupId: $groupId) {
    address label displayName verified
    pnl perpsEquity winrate copyScore lastTradeAt
  }
}`;

/** One trader as returned by Hyperdash (numeric fields arrive as strings). */
export interface HyperdashTrader {
  address: string;
  /** Curated label (e.g. "Cumberland #1"); often null. */
  label: string | null;
  /** User-set display name; often null. */
  displayName: string | null;
  verified: boolean;
  /** Cohort cumulative PnL (USD) as a string. Not a 30d figure — we don't
   *  persist it; Swash's scoring recomputes the displayed numbers. */
  pnl: string | null;
  /** Live perps equity (USD) as a string. Used to seed `wallets.accountValue`. */
  perpsEquity: string | null;
  /** Win rate, already 0–100. */
  winrate: number | null;
  /** Hyperdash's copyability score, float 0–100. Internal selection signal only. */
  copyScore: number | null;
  lastTradeAt: number | null;
}

/**
 * Fetch a Hyperdash system group. Returns the raw trader rows (no filtering);
 * the caller decides what to persist. Throws on transport / GraphQL errors.
 */
export async function fetchHyperdashGroup(groupId = 'copytraders'): Promise<HyperdashTrader[]> {
  const res = await fetch(HYPERDASH_GRAPHQL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin: 'https://hyperdash.com',
      referer: 'https://hyperdash.com/',
      // A browser UA is REQUIRED — the API blocks default fetch/curl agents.
      'user-agent':
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
        '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    },
    body: JSON.stringify({
      operationName: 'GetSystemGroupTraders',
      variables: { groupId },
      query: QUERY,
    }),
  });

  if (!res.ok) {
    throw new Error(`hyperdash ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
  const json = (await res.json()) as {
    data?: { getSystemGroupTraders?: HyperdashTrader[] };
    errors?: unknown;
  };
  if (json.errors) {
    throw new Error(`hyperdash graphql errors: ${JSON.stringify(json.errors).slice(0, 200)}`);
  }
  const rows = json.data?.getSystemGroupTraders;
  if (!rows) {
    throw new Error(`hyperdash: unexpected response ${JSON.stringify(json).slice(0, 200)}`);
  }
  return rows;
}

/** A wallet is copy-enabled when it has a real copy score and live equity. */
export function isCopyEnabled(t: HyperdashTrader): boolean {
  return (t.copyScore ?? 0) > 0 && Number.parseFloat(t.perpsEquity ?? '0') > 0;
}
