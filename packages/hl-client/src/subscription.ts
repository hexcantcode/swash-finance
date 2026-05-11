import { SubscriptionClient, WebSocketTransport } from '@nktkas/hyperliquid';
import { normalizeAddress } from '@copytrade/shared';
import type { TradesEvent } from './types.js';

export interface TradesAggregatorOptions {
  /** Coins to subscribe to. */
  coins: string[];
  /** Maximum runtime in ms. The aggregator stops on its own at this point. */
  durationMs: number;
  /** Optional callback invoked for each trade event (lowercased addresses). */
  onTrade?: (trade: NormalizedTrade) => void;
  /** Custom WS URL override (defaults to mainnet). */
  url?: string | URL;
}

export interface NormalizedTrade {
  coin: string;
  side: 'B' | 'A';
  px: string;
  sz: string;
  time: number;
  hash: string;
  tid: number;
  /** Lowercased addresses: [maker, taker]. */
  users: readonly [string, string];
}

export interface AggregationResult {
  addresses: Map<string, AggregatedAddress>;
  tradeCount: number;
  durationMs: number;
}

export interface AggregatedAddress {
  address: string;
  fillCount: number;
  totalNotional: number;
  firstSeenMs: number;
  lastSeenMs: number;
  coins: Set<string>;
}

/**
 * Subscribe to trade events for `coins` for `durationMs`, then disconnect.
 * Returns a per-address aggregation suitable for seeding the wallets table.
 *
 * Useful as the "bootstrap discovery sweep" job (J-2 abridged).
 */
export async function aggregateTrades(opts: TradesAggregatorOptions): Promise<AggregationResult> {
  const transport = new WebSocketTransport(opts.url !== undefined ? { url: opts.url } : undefined);
  const client = new SubscriptionClient({ transport });

  const addresses = new Map<string, AggregatedAddress>();
  let tradeCount = 0;
  const startedAt = Date.now();

  const subs = await Promise.all(
    opts.coins.map((coin) =>
      client.trades({ coin }, (event) => {
        const events = event as unknown as TradesEvent;
        for (const t of events) {
          tradeCount += 1;
          const maker = normalizeAddress(t.users[0]);
          const taker = normalizeAddress(t.users[1]);
          const notional = Number.parseFloat(t.px) * Number.parseFloat(t.sz);
          const norm: NormalizedTrade = {
            coin: t.coin,
            side: t.side,
            px: t.px,
            sz: t.sz,
            time: t.time,
            hash: t.hash,
            tid: t.tid,
            users: [maker, taker],
          };
          opts.onTrade?.(norm);
          touch(addresses, maker, t.time, notional, t.coin);
          touch(addresses, taker, t.time, notional, t.coin);
        }
      }),
    ),
  );

  await sleep(opts.durationMs);

  await Promise.allSettled(subs.map((s) => s.unsubscribe()));
  await transport.close();

  return {
    addresses,
    tradeCount,
    durationMs: Date.now() - startedAt,
  };
}

function touch(
  map: Map<string, AggregatedAddress>,
  addr: string,
  timeMs: number,
  notional: number,
  coin: string,
): void {
  const existing = map.get(addr);
  if (existing) {
    existing.fillCount += 1;
    existing.totalNotional += notional;
    if (timeMs < existing.firstSeenMs) existing.firstSeenMs = timeMs;
    if (timeMs > existing.lastSeenMs) existing.lastSeenMs = timeMs;
    existing.coins.add(coin);
  } else {
    map.set(addr, {
      address: addr,
      fillCount: 1,
      totalNotional: notional,
      firstSeenMs: timeMs,
      lastSeenMs: timeMs,
      coins: new Set([coin]),
    });
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
