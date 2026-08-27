CREATE TABLE "season_rating_exclusions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"season_id" uuid NOT NULL,
	"player_id" uuid NOT NULL,
	"created_by_player_id" uuid,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "season_rating_exclusions" ADD CONSTRAINT "season_rating_exclusions_season_id_seasons_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."seasons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "season_rating_exclusions" ADD CONSTRAINT "season_rating_exclusions_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "season_rating_exclusions" ADD CONSTRAINT "season_rating_exclusions_created_by_player_id_players_id_fk" FOREIGN KEY ("created_by_player_id") REFERENCES "public"."players"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "season_rating_exclusions_season_player_idx" ON "season_rating_exclusions" USING btree ("season_id","player_id");--> statement-breakpoint
CREATE INDEX "season_rating_exclusions_season_id_idx" ON "season_rating_exclusions" USING btree ("season_id");