/**
 * HL info-endpoint weight costs, per spec section 9 (rate limit budgeting).
 * For variable-cost endpoints, the base + per-page cost is encoded.
 */
export const WEIGHTS = {
  meta: 20,
  metaAndAssetCtxs: 20,
  perpDexs: 20,
  spotMeta: 20,
  allMids: 2,
  clearinghouseState: 2,
  l2Book: 2,
  userFills: { base: 20, perItems: 20 },
  userFillsByTime: { base: 20, perItems: 20 },
  userFunding: { base: 20, perItems: 20 },
  userNonFundingLedgerUpdates: { base: 20, perItems: 20 },
  recentTrades: { base: 20, perItems: 20 },
  extraAgents: 20,
  orderStatus: 2,
  // Generous fallback when we can't be sure of the actual cost.
  unknown: 20,
} as const;

export function paginatedWeight(
  cost: { base: number; perItems: number },
  itemCount: number,
): number {
  return cost.base + Math.ceil(Math.max(itemCount, 0) / 20) * cost.perItems;
}
