ALTER TABLE "wallets" ADD COLUMN "ingest_state" text DEFAULT 'observed' NOT NULL;--> statement-breakpoint
CREATE INDEX "idx_wallets_ingest_state" ON "wallets" USING btree ("ingest_state");