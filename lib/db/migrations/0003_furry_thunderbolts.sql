CREATE TABLE "tournament_mystery_bounty" (
	"tournament_id" uuid PRIMARY KEY NOT NULL,
	"status" text DEFAULT 'pending_envelopes' NOT NULL,
	"players_count" integer NOT NULL,
	"rebuys_count" integer NOT NULL,
	"addons_count" integer NOT NULL,
	"active_players_count" integer NOT NULL,
	"mystery_pool" integer NOT NULL,
	"envelope_count" integer NOT NULL,
	"small_count" integer NOT NULL,
	"small_value" integer NOT NULL,
	"medium_count" integer NOT NULL,
	"medium_value" integer NOT NULL,
	"jackpot_value" integer NOT NULL,
	"closed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"activated_at" timestamp with time zone,
	"recalculated_at" timestamp with time zone,
	CONSTRAINT "tournament_mystery_bounty_status_check" CHECK ("tournament_mystery_bounty"."status" IN ('pending_envelopes', 'active')),
	CONSTRAINT "tournament_mystery_bounty_players_check" CHECK ("tournament_mystery_bounty"."players_count" >= 0),
	CONSTRAINT "tournament_mystery_bounty_active_players_check" CHECK ("tournament_mystery_bounty"."active_players_count" >= 2),
	CONSTRAINT "tournament_mystery_bounty_pool_check" CHECK ("tournament_mystery_bounty"."mystery_pool" >= 0)
);
--> statement-breakpoint
ALTER TABLE "tournaments" DROP CONSTRAINT "tournaments_tournament_type_check";--> statement-breakpoint
ALTER TABLE "results" ADD COLUMN "mystery_bounty_points" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "tournament_mystery_bounty" ADD CONSTRAINT "tournament_mystery_bounty_tournament_id_tournaments_id_fk" FOREIGN KEY ("tournament_id") REFERENCES "public"."tournaments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tournaments" ADD CONSTRAINT "tournaments_tournament_type_check" CHECK ("tournaments"."tournament_type" IN ('classic', 'phoenix', 'deep_stack', 'bounty', 'boss_bounty', 'win_the_button', 'mystery_bounty'));