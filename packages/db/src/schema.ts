import { sql } from 'drizzle-orm';
import {
  bigint,
  bigserial,
  boolean,
  char,
  check,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

const ADDR_RE_SQL = sql`'^0x[a-f0-9]{40}$'`;
const NUMERIC_PRECISION = numeric({ precision: 30, scale: 8 });

export const wallets = pgTable(
  'wallets',
  {
    address: text('address').primaryKey(),
    masterAddress: text('master_address'),
    isAgent: boolean('is_agent').notNull().default(false),
    isVault: boolean('is_vault').notNull().default(false),
    agentName: text('agent_name'),
    agentValidUntil: bigint('agent_valid_until', { mode: 'number' }),

    firstSeenAt: timestamp('first_seen_at', { withTimezone: true }).notNull(),
    // Internal discovery signal (last seen on a watched market). NOT a display field — UI shows max(fills.blockTimeMs) / leaderCache.lastTradeMs instead.
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull(),

    // TODO(later phase): retire as display fields; UI shows scores.* instead.
    totalFills: bigint('total_fills', { mode: 'number' }).notNull().default(0),
    totalVolumeUsd: numeric('total_volume_usd', { precision: 30, scale: 8 }).notNull().default('0'),
    accountValue: numeric('account_value', { precision: 30, scale: 8 }),

    compositeScore: integer('composite_score'),
    primaryTag: text('primary_tag'),

    // HL leaderboard snapshot — populated by `leaderboard-ingest` job.
    // ROI fields are signed decimals (0.05 = +5%).
    hlPnl7dUsd: numeric('hl_pnl_7d_usd', { precision: 30, scale: 8 }),
    hlRoi7d: numeric('hl_roi_7d', { precision: 20, scale: 8 }),
    hlVolume7dUsd: numeric('hl_volume_7d_usd', { precision: 30, scale: 8 }),
    hlPnl30dUsd: numeric('hl_pnl_30d_usd', { precision: 30, scale: 8 }),
    hlRoi30d: numeric('hl_roi_30d', { precision: 20, scale: 8 }),
    hlMetricsAt: timestamp('hl_metrics_at', { withTimezone: true }),

    // Ingest-state machine:
    //   observed  → wallet exists, we have HL leaderboard metrics or trade
    //                events, but no fill history pulled.
    //   queued    → in discovery_queue waiting for J-5 refresh.
    //   ingested  → fills/fundings/ledger pulled, ready to score.
    //   scored    → composite score + tags computed.
    // Monotonic upgrade only — workers shouldn't downgrade state.
    ingestState: text('ingest_state').notNull().default('observed'),

    // Curated = passes the eligibility gate AND composite >= 70 (with ~65 hysteresis). Drives which wallets the live-tier WS subscriber holds subscriptions for.
    curated: boolean('curated').notNull().default(false),
    curatedSince: timestamp('curated_since', { withTimezone: true }),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('wallets_address_format', sql`${t.address} ~ ${ADDR_RE_SQL}`),
    index('idx_wallets_master').on(t.masterAddress).where(sql`${t.masterAddress} is not null`),
    index('idx_wallets_score').on(t.compositeScore.desc()).where(sql`${t.compositeScore} is not null`),
    index('idx_wallets_last_seen').on(t.lastSeenAt.desc()),
    index('idx_wallets_primary_tag').on(t.primaryTag).where(sql`${t.primaryTag} is not null`),
    index('idx_wallets_hl_roi_7d').on(t.hlRoi7d.desc()).where(sql`${t.hlRoi7d} is not null`),
    index('idx_wallets_ingest_state').on(t.ingestState),
    index('idx_wallets_curated').on(t.curated).where(sql`${t.curated}`),
  ],
);

export const fills = pgTable(
  'fills',
  {
    tid: bigint('tid', { mode: 'number' }).notNull(),
    userAddress: text('user_address').notNull(),

    blockTimeMs: bigint('block_time_ms', { mode: 'number' }).notNull(),

    coin: text('coin').notNull(),
    side: char('side', { length: 1 }).notNull(),
    px: numeric('px', { precision: 30, scale: 8 }).notNull(),
    sz: numeric('sz', { precision: 30, scale: 8 }).notNull(),

    fee: numeric('fee', { precision: 30, scale: 8 }).notNull(),
    feeToken: text('fee_token').notNull(),
    builderFee: numeric('builder_fee', { precision: 30, scale: 8 }).notNull().default('0'),

    oid: bigint('oid', { mode: 'number' }),
    hash: text('hash').notNull(),
    crossed: boolean('crossed').notNull(),

    closedPnl: numeric('closed_pnl', { precision: 30, scale: 8 }).notNull().default('0'),
    startPosition: numeric('start_position', { precision: 30, scale: 8 }),

    liquidationUser: text('liquidation_user'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.tid, t.userAddress] }),
    check('fills_side_check', sql`${t.side} in ('B', 'A')`),
    index('idx_fills_user_time').on(t.userAddress, t.blockTimeMs.desc()),
    index('idx_fills_coin_time').on(t.coin, t.blockTimeMs.desc()),
    index('idx_fills_block_time').on(t.blockTimeMs.desc()),
  ],
);

export const fundings = pgTable(
  'fundings',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    userAddress: text('user_address').notNull(),
    blockTimeMs: bigint('block_time_ms', { mode: 'number' }).notNull(),
    coin: text('coin').notNull(),
    usdc: numeric('usdc', { precision: 30, scale: 8 }).notNull(),
    szi: numeric('szi', { precision: 30, scale: 8 }).notNull(),
    fundingRate: numeric('funding_rate', { precision: 30, scale: 8 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('uq_fundings_event').on(t.userAddress, t.blockTimeMs, t.coin),
    index('idx_fundings_user_time').on(t.userAddress, t.blockTimeMs.desc()),
  ],
);

export const ledgerUpdates = pgTable(
  'ledger_updates',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    userAddress: text('user_address').notNull(),
    blockTimeMs: bigint('block_time_ms', { mode: 'number' }).notNull(),
    hash: text('hash').notNull(),
    type: text('type').notNull(),
    usdc: numeric('usdc', { precision: 30, scale: 8 }),
    detailsJson: jsonb('details_json'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('uq_ledger_event').on(t.hash, t.userAddress, t.type),
    index('idx_ledger_user_time').on(t.userAddress, t.blockTimeMs.desc()),
  ],
);

export const scores = pgTable('scores', {
  address: text('address').primaryKey(),
  computedAt: timestamp('computed_at', { withTimezone: true }).notNull(),

  totalTrades: integer('total_trades').notNull(),
  totalRoundTrips: integer('total_round_trips').notNull().default(0),
  totalVolumeUsd: numeric('total_volume_usd', { precision: 30, scale: 8 }).notNull(),
  firstTradeAt: timestamp('first_trade_at', { withTimezone: true }),
  lastTradeAt: timestamp('last_trade_at', { withTimezone: true }),
  activeDays: integer('active_days').notNull(),

  netPnlUsd: numeric('net_pnl_usd', { precision: 30, scale: 8 }).notNull(),
  netPnlPct: numeric('net_pnl_pct', { precision: 20, scale: 8 }),

  sharpe: numeric('sharpe', { precision: 10, scale: 4 }),
  sortino: numeric('sortino', { precision: 10, scale: 4 }),
  psr: numeric('psr', { precision: 10, scale: 4 }),
  profitFactor: numeric('profit_factor', { precision: 10, scale: 4 }),
  winRate: numeric('win_rate', { precision: 10, scale: 4 }),
  expectancy: numeric('expectancy', { precision: 20, scale: 8 }),
  maxDrawdownPct: numeric('max_drawdown_pct', { precision: 10, scale: 4 }),
  recoveryTimeDays: integer('recovery_time_days'),

  avgHoldSeconds: bigint('avg_hold_seconds', { mode: 'number' }),
  tradesPerDayAvg: numeric('trades_per_day_avg', { precision: 10, scale: 4 }),
  makerTakerRatio: numeric('maker_taker_ratio', { precision: 10, scale: 4 }),
  assetConcentration: numeric('asset_concentration', { precision: 10, scale: 4 }),
  primaryAsset: text('primary_asset'),
  primaryDex: text('primary_dex'),
  longShortRatio: numeric('long_short_ratio', { precision: 10, scale: 4 }),
  fundingPnlPct: numeric('funding_pnl_pct', { precision: 10, scale: 4 }),

  rolling30dSharpe: numeric('rolling_30d_sharpe', { precision: 10, scale: 4 }),
  rolling7dSharpe: numeric('rolling_7d_sharpe', { precision: 10, scale: 4 }),
  decayFlag: text('decay_flag'),

  compositeScore: integer('composite_score').notNull(),

  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const walletTags = pgTable(
  'wallet_tags',
  {
    address: text('address').notNull(),
    tagType: text('tag_type').notNull(),
    tagValue: text('tag_value').notNull(),
    setBy: text('set_by').notNull().default('auto'),
    setAt: timestamp('set_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.address, t.tagType, t.tagValue] }),
    index('idx_wallet_tags_lookup').on(t.tagType, t.tagValue),
  ],
);

// Live-tier snapshot per wallet: WS subscriber for curated wallets, on-demand REST pull for the long tail.
export const leaderCache = pgTable('leader_cache', {
  address: text('address').primaryKey(),
  lastRefreshedAt: timestamp('last_refreshed_at', { withTimezone: true }),
  nextRefreshAfter: timestamp('next_refresh_after', { withTimezone: true }),

  accountValue: numeric('account_value', { precision: 30, scale: 8 }),
  leverage: numeric('leverage', { precision: 20, scale: 4 }),
  marginUsed: numeric('margin_used', { precision: 30, scale: 8 }),
  positionsJson: jsonb('positions_json'),
  recentFillsJson: jsonb('recent_fills_json'),
  funding30dJson: jsonb('funding_30d_json'),
  ledger30dJson: jsonb('ledger_30d_json'),

  lastTradeMs: bigint('last_trade_ms', { mode: 'number' }),
  // Convention values: 'ws' | 'rest' — no DB enum, just text.
  source: text('source'),

  refreshCount: integer('refresh_count').notNull().default(0),
  lastRefreshSource: text('last_refresh_source'),
});

export const discoveryQueue = pgTable(
  'discovery_queue',
  {
    address: text('address').primaryKey(),
    queuedAt: timestamp('queued_at', { withTimezone: true }).notNull().defaultNow(),
    source: text('source').notNull(),
    processed: boolean('processed').notNull().default(false),
    processedAt: timestamp('processed_at', { withTimezone: true }),
  },
  (t) => [index('idx_discovery_queue_pending').on(t.queuedAt).where(sql`not ${t.processed}`)],
);

export const auditLog = pgTable(
  'audit_log',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    actor: text('actor'),
    action: text('action').notNull(),
    target: text('target'),
    details: jsonb('details'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('idx_audit_actor').on(t.actor, t.createdAt.desc()),
    index('idx_audit_action').on(t.action, t.createdAt.desc()),
  ],
);

// Suppress unused-imports warning for NUMERIC_PRECISION (kept as a doc anchor).
void NUMERIC_PRECISION;

export type Wallet = typeof wallets.$inferSelect;
export type NewWallet = typeof wallets.$inferInsert;
export type Fill = typeof fills.$inferSelect;
export type NewFill = typeof fills.$inferInsert;
export type Funding = typeof fundings.$inferSelect;
export type NewFunding = typeof fundings.$inferInsert;
export type LedgerUpdate = typeof ledgerUpdates.$inferSelect;
export type NewLedgerUpdate = typeof ledgerUpdates.$inferInsert;
export type Score = typeof scores.$inferSelect;
export type NewScore = typeof scores.$inferInsert;
export type WalletTag = typeof walletTags.$inferSelect;
export type NewWalletTag = typeof walletTags.$inferInsert;
export type LeaderCacheRow = typeof leaderCache.$inferSelect;
export type NewLeaderCacheRow = typeof leaderCache.$inferInsert;
export type DiscoveryQueueRow = typeof discoveryQueue.$inferSelect;
export type NewDiscoveryQueueRow = typeof discoveryQueue.$inferInsert;
export type AuditLogRow = typeof auditLog.$inferSelect;
export type NewAuditLogRow = typeof auditLog.$inferInsert;
