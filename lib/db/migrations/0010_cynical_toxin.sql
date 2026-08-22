CREATE TABLE "player_featured_achievements" (
	"player_id" uuid PRIMARY KEY NOT NULL,
	"achievement_keys" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "player_featured_achievements_array_check" CHECK (jsonb_typeof("player_featured_achievements"."achievement_keys") = 'array'),
	CONSTRAINT "player_featured_achievements_limit_check" CHECK (jsonb_array_length("player_featured_achievements"."achievement_keys") <= 3)
);
--> statement-breakpoint
ALTER TABLE "player_featured_achievements" ADD CONSTRAINT "player_featured_achievements_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;