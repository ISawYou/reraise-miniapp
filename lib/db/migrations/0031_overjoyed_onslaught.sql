CREATE TABLE "follows" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"follower_player_id" uuid NOT NULL,
	"followed_player_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "follows_no_self_follow" CHECK ("follows"."follower_player_id" <> "follows"."followed_player_id")
);
--> statement-breakpoint
ALTER TABLE "follows" ADD CONSTRAINT "follows_follower_player_id_players_id_fk" FOREIGN KEY ("follower_player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "follows" ADD CONSTRAINT "follows_followed_player_id_players_id_fk" FOREIGN KEY ("followed_player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "follows_follower_followed_key" ON "follows" USING btree ("follower_player_id","followed_player_id");--> statement-breakpoint
CREATE INDEX "follows_followed_created_idx" ON "follows" USING btree ("followed_player_id","created_at" DESC NULLS FIRST,"id" DESC NULLS FIRST);