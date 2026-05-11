CREATE TABLE "audit_log" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"actor" text,
	"action" text NOT NULL,
	"target" text,
	"details" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "discovery_queue" (
	"address" text PRIMARY KEY NOT NULL,
	"queued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"source" text NOT NULL,
	"processed" boolean DEFAULT false NOT NULL,
	"processed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "fills" (
	"tid" bigint NOT NULL,
	"user_address" text NOT NULL,
	"block_time_ms" bigint NOT NULL,
	"coin" text NOT NULL,
	"side" char(1) NOT NULL,
	"px" numeric(30, 8) NOT NULL,
	"sz" numeric(30, 8) NOT NULL,
	"fee" numeric(30, 8) NOT NULL,
	"fee_token" text NOT NULL,
	"builder_fee" numeric(30, 8) DEFAULT '0' NOT NULL,
	"oid" bigint,
	"hash" text NOT NULL,
	"crossed" boolean NOT NULL,
	"closed_pnl" numeric(30, 8) DEFAULT '0' NOT NULL,
	"start_position" numeric(30, 8),
	"liquidation_user" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fills_tid_user_address_pk" PRIMARY KEY("tid","user_address"),
	CONSTRAINT "fills_side_check" CHECK ("fills"."side" in ('B', 'A'))
);
--> statement-breakpoint
CREATE TABLE "fundings" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_address" text NOT NULL,
	"block_time_ms" bigint NOT NULL,
	"coin" text NOT NULL,
	"usdc" numeric(30, 8) NOT NULL,
	"szi" numeric(30, 8) NOT NULL,
	"funding_rate" numeric(30, 8) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "leader_cache" (
	"address" text PRIMARY KEY NOT NULL,
	"last_refreshed_at" timestamp with time zone,
	"next_refresh_after" timestamp with time zone,
	"account_value" numeric(30, 8),
	"positions_json" jsonb,
	"recent_fills_json" jsonb,
	"funding_30d_json" jsonb,
	"ledger_30d_json" jsonb,
	"refresh_count" integer DEFAULT 0 NOT NULL,
	"last_refresh_source" text
);
--> statement-breakpoint
CREATE TABLE "ledger_updates" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_address" text NOT NULL,
	"block_time_ms" bigint NOT NULL,
	"hash" text NOT NULL,
	"type" text NOT NULL,
	"usdc" numeric(30, 8),
	"details_json" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scores" (
	"address" text PRIMARY KEY NOT NULL,
	"computed_at" timestamp with time zone NOT NULL,
	"total_trades" integer NOT NULL,
	"total_round_trips" integer DEFAULT 0 NOT NULL,
	"total_volume_usd" numeric(30, 8) NOT NULL,
	"first_trade_at" timestamp with time zone,
	"last_trade_at" timestamp with time zone,
	"active_days" integer NOT NULL,
	"net_pnl_usd" numeric(30, 8) NOT NULL,
	"net_pnl_pct" numeric(20, 8),
	"sharpe" numeric(10, 4),
	"sortino" numeric(10, 4),
	"calmar" numeric(10, 4),
	"psr" numeric(10, 4),
	"dsr" numeric(10, 4),
	"profit_factor" numeric(10, 4),
	"win_rate" numeric(10, 4),
	"expectancy" numeric(20, 8),
	"max_drawdown_pct" numeric(10, 4),
	"recovery_time_days" integer,
	"avg_hold_seconds" bigint,
	"trades_per_day_avg" numeric(10, 4),
	"maker_taker_ratio" numeric(10, 4),
	"asset_concentration" numeric(10, 4),
	"primary_asset" text,
	"primary_dex" text,
	"long_short_ratio" numeric(10, 4),
	"funding_pnl_pct" numeric(10, 4),
	"rolling_30d_sharpe" numeric(10, 4),
	"rolling_7d_sharpe" numeric(10, 4),
	"decay_flag" text,
	"composite_score" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wallet_tags" (
	"address" text NOT NULL,
	"tag_type" text NOT NULL,
	"tag_value" text NOT NULL,
	"set_by" text DEFAULT 'auto' NOT NULL,
	"set_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "wallet_tags_address_tag_type_tag_value_pk" PRIMARY KEY("address","tag_type","tag_value")
);
--> statement-breakpoint
CREATE TABLE "wallets" (
	"address" text PRIMARY KEY NOT NULL,
	"master_address" text,
	"is_agent" boolean DEFAULT false NOT NULL,
	"is_vault" boolean DEFAULT false NOT NULL,
	"agent_name" text,
	"agent_valid_until" bigint,
	"first_seen_at" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone NOT NULL,
	"total_fills" bigint DEFAULT 0 NOT NULL,
	"total_volume_usd" numeric(30, 8) DEFAULT '0' NOT NULL,
	"account_value" numeric(30, 8),
	"composite_score" integer,
	"primary_tag" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "wallets_address_format" CHECK ("wallets"."address" ~ '^0x[a-f0-9]{40}$')
);
--> statement-breakpoint
CREATE INDEX "idx_audit_actor" ON "audit_log" USING btree ("actor","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_audit_action" ON "audit_log" USING btree ("action","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_discovery_queue_pending" ON "discovery_queue" USING btree ("queued_at") WHERE not "discovery_queue"."processed";--> statement-breakpoint
CREATE INDEX "idx_fills_user_time" ON "fills" USING btree ("user_address","block_time_ms" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_fills_coin_time" ON "fills" USING btree ("coin","block_time_ms" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_fills_block_time" ON "fills" USING btree ("block_time_ms" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "uq_fundings_event" ON "fundings" USING btree ("user_address","block_time_ms","coin");--> statement-breakpoint
CREATE INDEX "idx_fundings_user_time" ON "fundings" USING btree ("user_address","block_time_ms" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "uq_ledger_event" ON "ledger_updates" USING btree ("hash","user_address","type");--> statement-breakpoint
CREATE INDEX "idx_ledger_user_time" ON "ledger_updates" USING btree ("user_address","block_time_ms" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_wallet_tags_lookup" ON "wallet_tags" USING btree ("tag_type","tag_value");--> statement-breakpoint
CREATE INDEX "idx_wallets_master" ON "wallets" USING btree ("master_address") WHERE "wallets"."master_address" is not null;--> statement-breakpoint
CREATE INDEX "idx_wallets_score" ON "wallets" USING btree ("composite_score" DESC NULLS LAST) WHERE "wallets"."composite_score" is not null;--> statement-breakpoint
CREATE INDEX "idx_wallets_last_seen" ON "wallets" USING btree ("last_seen_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_wallets_primary_tag" ON "wallets" USING btree ("primary_tag") WHERE "wallets"."primary_tag" is not null;