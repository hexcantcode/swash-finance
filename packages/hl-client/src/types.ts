// Re-export the response and parameter types we use, so worker/web code
// imports from @copytrade/hl-client and never directly from @nktkas/hyperliquid.

export type {
  AllMidsResponse,
  ClearinghouseStateResponse,
  ExtraAgentsResponse,
  L2BookResponse,
  MetaResponse,
  MetaAndAssetCtxsResponse,
  PerpDexsResponse,
  RecentTradesResponse,
  SpotMetaResponse,
  UserFillsResponse,
  UserFillsByTimeResponse,
  UserFundingResponse,
  UserNonFundingLedgerUpdatesResponse,
} from '@nktkas/hyperliquid/api/info';

export type { TradesEvent } from '@nktkas/hyperliquid/api/subscription';

/** A response wrapper that carries observability metadata alongside the data. */
export interface HlResult<T> {
  data: T;
  weightCost: number;
  fromCache: boolean;
  fetchedAt: number;
}

/** Options accepted by every read call in our wrapper. */
export interface HlReadOptions {
  /** When true, skip the on-disk cache for this call. */
  bypassCache?: boolean;
  /** Custom TTL override in seconds. */
  cacheTtlSeconds?: number;
  /** Custom AbortSignal. */
  signal?: AbortSignal;
}

export interface HlClientOptions {
  cacheDir?: string | null;
  defaultCacheTtlSeconds?: number;
}
