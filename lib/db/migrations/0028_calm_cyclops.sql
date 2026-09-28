CREATE TABLE "team_join_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"team_id" uuid NOT NULL,
	"player_id" uuid NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"responded_at" timestamp with time zone,
	CONSTRAINT "team_join_requests_status_check" CHECK ("team_join_requests"."status" IN ('pending', 'accepted', 'declined', 'cancelled')),
	CONSTRAINT "team_join_requests_responded_at_consistency_check" CHECK (("team_join_requests"."status" = 'pending' AND "team_join_requests"."responded_at" IS NULL) OR ("team_join_requests"."status" != 'pending' AND "team_join_requests"."responded_at" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "teams" ADD COLUMN "avatar_url" text;--> statement-breakpoint
ALTER TABLE "teams" ADD COLUMN "avatar_updated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "team_join_requests" ADD CONSTRAINT "team_join_requests_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_join_requests" ADD CONSTRAINT "team_join_requests_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "team_join_requests_one_pending_per_team_player_idx" ON "team_join_requests" USING btree ("team_id","player_id") WHERE "team_join_requests"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "team_join_requests_team_id_idx" ON "team_join_requests" USING btree ("team_id");--> statement-breakpoint
CREATE INDEX "team_join_requests_player_id_idx" ON "team_join_requests" USING btree ("player_id");--> statement-breakpoint
CREATE INDEX "team_join_requests_status_idx" ON "team_join_requests" USING btree ("status");