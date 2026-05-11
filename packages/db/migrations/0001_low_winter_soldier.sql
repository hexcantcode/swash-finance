ALTER TABLE "wallets" ADD COLUMN "hl_pnl_7d_usd" numeric(30, 8);--> statement-breakpoint
ALTER TABLE "wallets" ADD COLUMN "hl_roi_7d" numeric(20, 8);--> statement-breakpoint
ALTER TABLE "wallets" ADD COLUMN "hl_volume_7d_usd" numeric(30, 8);--> statement-breakpoint
ALTER TABLE "wallets" ADD COLUMN "hl_pnl_30d_usd" numeric(30, 8);--> statement-breakpoint
ALTER TABLE "wallets" ADD COLUMN "hl_roi_30d" numeric(20, 8);--> statement-breakpoint
ALTER TABLE "wallets" ADD COLUMN "hl_metrics_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "idx_wallets_hl_roi_7d" ON "wallets" USING btree ("hl_roi_7d" DESC NULLS LAST) WHERE "wallets"."hl_roi_7d" is not null;