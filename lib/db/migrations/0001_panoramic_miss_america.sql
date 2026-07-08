ALTER TABLE "tournaments" DROP CONSTRAINT "tournaments_tournament_type_check";--> statement-breakpoint
ALTER TABLE "results" ADD COLUMN "boss_knockouts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "tournament_live_entries" ADD COLUMN "boss_knockouts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "tournaments" ADD CONSTRAINT "tournaments_tournament_type_check" CHECK ("tournaments"."tournament_type" IN ('classic', 'phoenix', 'deep_stack', 'bounty', 'boss_bounty', 'win_the_button'));