import { HttpTransport, InfoClient } from '@nktkas/hyperliquid';
import { normalizeAddress } from '@copytrade/shared';
import { FileCache } from './cache.js';
import { paginatedWeight, WEIGHTS } from './weight.js';
import type {
  AllMidsResponse,
  CandleSnapshotParameters,
  CandleSnapshotResponse,
  ClearinghouseStateResponse,
  ExtraAgentsResponse,
  HlClientOptions,
  HlReadOptions,
  HlResult,
  L2BookResponse,
  MetaResponse,
  MetaAndAssetCtxsResponse,
  PerpDexsResponse,
  RecentTradesResponse,
  SpotMetaResponse,
  UserFillsByTimeResponse,
  UserFillsResponse,
  UserFundingResponse,
  UserNonFundingLedgerUpdatesResponse,
} from './types.js';

const DAY = 24 * 60 * 60;

interface BuildClientOptions extends HlClientOptions {
  transport?: HttpTransport;
}

export class HlInfoClient {
  private readonly client: InfoClient;
  private readonly cache: FileCache;
  private readonly defaultTtl: number;

  constructor(options: BuildClientOptions = {}) {
    const transport = options.transport ?? new HttpTransport();
    this.client = new InfoClient({ transport });
    this.cache = new FileCache(options.cacheDir ?? null);
    this.defaultTtl = options.defaultCacheTtlSeconds ?? DAY;
  }

  // ───── slow-changing universe (cached aggressively) ──────────────────

  async meta(opts: HlReadOptions = {}): Promise<HlResult<MetaResponse>> {
    return this.cachedFetch({
      key: 'info:meta',
      weight: WEIGHTS.meta,
      ttl: opts.cacheTtlSeconds ?? this.defaultTtl,
      bypassCache: opts.bypassCache === true,
      fetcher: () => this.client.meta(opts.signal),
    });
  }

  async perpDexs(opts: HlReadOptions = {}): Promise<HlResult<PerpDexsResponse>> {
    return this.cachedFetch({
      key: 'info:perpDexs',
      weight: WEIGHTS.perpDexs,
      ttl: opts.cacheTtlSeconds ?? this.defaultTtl,
      bypassCache: opts.bypassCache === true,
      fetcher: () => this.client.perpDexs(opts.signal),
    });
  }

  async spotMeta(opts: HlReadOptions = {}): Promise<HlResult<SpotMetaResponse>> {
    return this.cachedFetch({
      key: 'info:spotMeta',
      weight: WEIGHTS.spotMeta,
      ttl: opts.cacheTtlSeconds ?? this.defaultTtl,
      bypassCache: opts.bypassCache === true,
      fetcher: () => this.client.spotMeta(opts.signal),
    });
  }

  // ───── fast-changing market data (cache off by default) ──────────────

  async allMids(opts: HlReadOptions = {}): Promise<HlResult<AllMidsResponse>> {
    const data = await this.client.allMids(opts.signal);
    return wrapFresh(data, WEIGHTS.allMids);
  }

  /** Perp meta (universe) + asset contexts (mark px, prev-day px, 24h volume,
   *  open interest, funding) for the main perp dex. Pass `dex` for a HIP-3 dex. */
  async metaAndAssetCtxs(
    opts: HlReadOptions & { dex?: string } = {},
  ): Promise<HlResult<MetaAndAssetCtxsResponse>> {
    const data = opts.dex
      ? await this.client.metaAndAssetCtxs({ dex: opts.dex }, opts.signal)
      : await this.client.metaAndAssetCtxs(opts.signal);
    return wrapFresh(data, WEIGHTS.metaAndAssetCtxs);
  }

  async l2Book(coin: string, opts: HlReadOptions = {}): Promise<HlResult<L2BookResponse>> {
    const data = await this.client.l2Book({ coin }, opts.signal);
    return wrapFresh(data, WEIGHTS.l2Book);
  }

  async recentTrades(
    coin: string,
    opts: HlReadOptions = {},
  ): Promise<HlResult<RecentTradesResponse>> {
    const data = await this.client.recentTrades({ coin }, opts.signal);
    const weight = paginatedWeight(WEIGHTS.recentTrades, data.length);
    return wrapFresh(data, weight);
  }

  /** Candlestick history (OHLCV). HL caps the response, so the array may end
   *  short of `endTime` for shorter intervals — call again with a later
   *  `startTime` if you need the full window. */
  async candleSnapshot(
    params: CandleSnapshotParameters,
    opts: HlReadOptions = {},
  ): Promise<HlResult<CandleSnapshotResponse>> {
    const data = await this.client.candleSnapshot(params, opts.signal);
    return wrapFresh(data, WEIGHTS.candleSnapshot);
  }

  // ───── per-user reads ────────────────────────────────────────────────

  /**
   * Perpetuals account summary. Defaults to the main dex; pass `dex` (a HIP-3
   * builder dex name like `xyz` or `cash`) to query that dex's slice. The
   * underlying SDK accepts `""` for main dex, but we elide the field entirely
   * in that case to keep the request body matching the existing main-dex form.
   */
  async clearinghouseState(
    user: string,
    opts: HlReadOptions & { dex?: string } = {},
  ): Promise<HlResult<ClearinghouseStateResponse>> {
    const u = asHexAddress(user);
    const req = opts.dex && opts.dex.length > 0
      ? { user: u, dex: opts.dex }
      : { user: u };
    const data = await this.client.clearinghouseState(req, opts.signal);
    return wrapFresh(data, WEIGHTS.clearinghouseState);
  }

  async userFills(user: string, opts: HlReadOptions = {}): Promise<HlResult<UserFillsResponse>> {
    const u = asHexAddress(user);
    const data = await this.client.userFills({ user: u }, opts.signal);
    return wrapFresh(data, paginatedWeight(WEIGHTS.userFills, data.length));
  }

  async userFillsByTime(
    user: string,
    startMs: number,
    endMs?: number,
    opts: HlReadOptions = {},
  ): Promise<HlResult<UserFillsByTimeResponse>> {
    const u = asHexAddress(user);
    const params = endMs !== undefined
      ? ({ user: u, startTime: startMs, endTime: endMs } as const)
      : ({ user: u, startTime: startMs } as const);
    const data = await this.client.userFillsByTime(params, opts.signal);
    return wrapFresh(data, paginatedWeight(WEIGHTS.userFillsByTime, data.length));
  }

  async userFunding(
    user: string,
    startMs: number,
    endMs?: number,
    opts: HlReadOptions = {},
  ): Promise<HlResult<UserFundingResponse>> {
    const u = asHexAddress(user);
    const params = endMs !== undefined
      ? ({ user: u, startTime: startMs, endTime: endMs } as const)
      : ({ user: u, startTime: startMs } as const);
    const data = await this.client.userFunding(params, opts.signal);
    return wrapFresh(data, paginatedWeight(WEIGHTS.userFunding, data.length));
  }

  async userNonFundingLedgerUpdates(
    user: string,
    startMs: number,
    endMs?: number,
    opts: HlReadOptions = {},
  ): Promise<HlResult<UserNonFundingLedgerUpdatesResponse>> {
    const u = asHexAddress(user);
    const params = endMs !== undefined
      ? ({ user: u, startTime: startMs, endTime: endMs } as const)
      : ({ user: u, startTime: startMs } as const);
    const data = await this.client.userNonFundingLedgerUpdates(params, opts.signal);
    return wrapFresh(data, paginatedWeight(WEIGHTS.userNonFundingLedgerUpdates, data.length));
  }

  async extraAgents(
    user: string,
    opts: HlReadOptions = {},
  ): Promise<HlResult<ExtraAgentsResponse>> {
    const u = asHexAddress(user);
    const data = await this.client.extraAgents({ user: u }, opts.signal);
    return wrapFresh(data, WEIGHTS.extraAgents);
  }

  // ───── internal ──────────────────────────────────────────────────────

  private async cachedFetch<T>(args: {
    key: string;
    weight: number;
    ttl: number;
    bypassCache: boolean;
    fetcher: () => Promise<T>;
  }): Promise<HlResult<T>> {
    if (!args.bypassCache && this.cache.isEnabled()) {
      const hit = await this.cache.get<T>(args.key, args.ttl);
      if (hit !== null) {
        return { data: hit, weightCost: 0, fromCache: true, fetchedAt: Date.now() };
      }
    }
    const data = await args.fetcher();
    if (this.cache.isEnabled()) {
      await this.cache.set(args.key, data);
    }
    return { data, weightCost: args.weight, fromCache: false, fetchedAt: Date.now() };
  }
}

function wrapFresh<T>(data: T, weight: number): HlResult<T> {
  return { data, weightCost: weight, fromCache: false, fetchedAt: Date.now() };
}

function asHexAddress(addr: string): `0x${string}` {
  return normalizeAddress(addr) as unknown as `0x${string}`;
}
