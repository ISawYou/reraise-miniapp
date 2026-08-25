CREATE TABLE "tournament_rebuy_state" (
	"tournament_id" uuid NOT NULL,
	"player_id" uuid NOT NULL,
	"rebuys" integer DEFAULT 0 NOT NULL,
	"addons" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tournament_rebuy_state_tournament_id_player_id_pk" PRIMARY KEY("tournament_id","player_id"),
	CONSTRAINT "tournament_rebuy_state_rebuys_check" CHECK ("tournament_rebuy_state"."rebuys" >= 0),
	CONSTRAINT "tournament_rebuy_state_addons_check" CHECK ("tournament_rebuy_state"."addons" >= 0)
);
--> statement-breakpoint
ALTER TABLE "tournament_rebuy_state" ADD CONSTRAINT "tournament_rebuy_state_tournament_id_tournaments_id_fk" FOREIGN KEY ("tournament_id") REFERENCES "public"."tournaments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tournament_rebuy_state" ADD CONSTRAINT "tournament_rebuy_state_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;