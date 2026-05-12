ALTER TABLE "wallets" ADD COLUMN "winner" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "wallets" ADD COLUMN "winner_rank" integer;--> statement-breakpoint
CREATE INDEX "idx_wallets_winner" ON "wallets" USING btree ("winner") WHERE "wallets"."winner";