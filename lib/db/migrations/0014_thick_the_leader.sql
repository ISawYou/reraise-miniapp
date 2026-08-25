CREATE TABLE "tournament_late_registration" (
	"tournament_id" uuid PRIMARY KEY NOT NULL,
	"arrived_players_count" integer NOT NULL,
	"initial_stacks_count" integer NOT NULL,
	"total_entries_count" integer NOT NULL,
	"rebuys_count" integer NOT NULL,
	"addons_count" integer NOT NULL,
	"tournament_type" text NOT NULL,
	"rating_formula_version" text NOT NULL,
	"rating_guarantee" integer,
	"rating_places" jsonb NOT NULL,
	"closed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tournament_late_registration_arrived_players_check" CHECK ("tournament_late_registration"."arrived_players_count" > 0),
	CONSTRAINT "tournament_late_registration_initial_stacks_check" CHECK ("tournament_late_registration"."initial_stacks_count" >= 0 AND "tournament_late_registration"."initial_stacks_count" <= "tournament_late_registration"."arrived_players_count"),
	CONSTRAINT "tournament_late_registration_entries_check" CHECK ("tournament_late_registration"."total_entries_count" >= 0 AND "tournament_late_registration"."rebuys_count" >= 0 AND "tournament_late_registration"."addons_count" >= 0),
	CONSTRAINT "tournament_late_registration_formula_check" CHECK ("tournament_late_registration"."rating_formula_version" IN ('legacy', 'v2')),
	CONSTRAINT "tournament_late_registration_guarantee_check" CHECK ("tournament_late_registration"."rating_guarantee" IS NULL OR "tournament_late_registration"."rating_guarantee" >= 0),
	CONSTRAINT "tournament_late_registration_places_check" CHECK (jsonb_typeof("tournament_late_registration"."rating_places") = 'array')
);
--> statement-breakpoint
ALTER TABLE "tournament_late_registration" ADD CONSTRAINT "tournament_late_registration_tournament_id_tournaments_id_fk" FOREIGN KEY ("tournament_id") REFERENCES "public"."tournaments"("id") ON DELETE cascade ON UPDATE no action;