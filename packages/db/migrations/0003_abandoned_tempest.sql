ALTER TABLE "leader_cache" ADD COLUMN "leverage" numeric(20, 4);--> statement-breakpoint
ALTER TABLE "leader_cache" ADD COLUMN "margin_used" numeric(30, 8);--> statement-breakpoint
ALTER TABLE "leader_cache" ADD COLUMN "last_trade_ms" bigint;--> statement-breakpoint
ALTER TABLE "leader_cache" ADD COLUMN "source" text;--> statement-breakpoint
ALTER TABLE "scores" DROP COLUMN "calmar";--> statement-breakpoint
ALTER TABLE "scores" DROP COLUMN "dsr";