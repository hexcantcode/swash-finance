ALTER TABLE "wallets" ADD COLUMN "curated" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "wallets" ADD COLUMN "curated_since" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "idx_wallets_curated" ON "wallets" USING btree ("curated") WHERE "wallets"."curated";