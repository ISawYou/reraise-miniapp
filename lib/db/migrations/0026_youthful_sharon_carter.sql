CREATE TABLE "team_invitations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"team_id" uuid NOT NULL,
	"invited_player_id" uuid NOT NULL,
	"invited_by_player_id" uuid NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"responded_at" timestamp with time zone,
	CONSTRAINT "team_invitations_status_check" CHECK ("team_invitations"."status" IN ('pending', 'accepted', 'declined', 'cancelled')),
	CONSTRAINT "team_invitations_responded_at_consistency_check" CHECK (("team_invitations"."status" = 'pending' AND "team_invitations"."responded_at" IS NULL) OR ("team_invitations"."status" != 'pending' AND "team_invitations"."responded_at" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "team_memberships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"team_id" uuid NOT NULL,
	"player_id" uuid NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	"left_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "team_memberships_left_after_joined_check" CHECK ("team_memberships"."left_at" IS NULL OR "team_memberships"."left_at" >= "team_memberships"."joined_at")
);
--> statement-breakpoint
CREATE TABLE "teams" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"emblem" text DEFAULT '♠️' NOT NULL,
	"captain_player_id" uuid NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"disbanded_at" timestamp with time zone,
	CONSTRAINT "teams_name_length_check" CHECK (char_length(btrim("teams"."name")) BETWEEN 2 AND 40),
	CONSTRAINT "teams_status_check" CHECK ("teams"."status" IN ('active', 'disbanded')),
	CONSTRAINT "teams_emblem_check" CHECK ("teams"."emblem" IN ('♠️', '♥️', '♦️', '♣️', '👑', '🔥', '⚡', '🐺', '🦈', '🐉', '💎', '🏆')),
	CONSTRAINT "teams_disbanded_at_consistency_check" CHECK (("teams"."status" = 'disbanded' AND "teams"."disbanded_at" IS NOT NULL) OR ("teams"."status" = 'active' AND "teams"."disbanded_at" IS NULL))
);
--> statement-breakpoint
ALTER TABLE "team_invitations" ADD CONSTRAINT "team_invitations_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_invitations" ADD CONSTRAINT "team_invitations_invited_player_id_players_id_fk" FOREIGN KEY ("invited_player_id") REFERENCES "public"."players"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_invitations" ADD CONSTRAINT "team_invitations_invited_by_player_id_players_id_fk" FOREIGN KEY ("invited_by_player_id") REFERENCES "public"."players"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_memberships" ADD CONSTRAINT "team_memberships_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_memberships" ADD CONSTRAINT "team_memberships_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teams" ADD CONSTRAINT "teams_captain_player_id_players_id_fk" FOREIGN KEY ("captain_player_id") REFERENCES "public"."players"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "team_invitations_one_pending_per_team_player_idx" ON "team_invitations" USING btree ("team_id","invited_player_id") WHERE "team_invitations"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "team_invitations_team_id_idx" ON "team_invitations" USING btree ("team_id");--> statement-breakpoint
CREATE INDEX "team_invitations_invited_player_id_idx" ON "team_invitations" USING btree ("invited_player_id");--> statement-breakpoint
CREATE INDEX "team_invitations_status_idx" ON "team_invitations" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "team_memberships_one_active_per_player_idx" ON "team_memberships" USING btree ("player_id") WHERE "team_memberships"."left_at" IS NULL;--> statement-breakpoint
CREATE INDEX "team_memberships_team_id_idx" ON "team_memberships" USING btree ("team_id");--> statement-breakpoint
CREATE INDEX "team_memberships_player_id_idx" ON "team_memberships" USING btree ("player_id");--> statement-breakpoint
CREATE INDEX "team_memberships_joined_at_idx" ON "team_memberships" USING btree ("joined_at");--> statement-breakpoint
CREATE INDEX "team_memberships_left_at_idx" ON "team_memberships" USING btree ("left_at");--> statement-breakpoint
CREATE UNIQUE INDEX "teams_name_lower_unique_idx" ON "teams" USING btree (lower("name"));--> statement-breakpoint
CREATE INDEX "teams_status_idx" ON "teams" USING btree ("status");--> statement-breakpoint
CREATE INDEX "teams_captain_player_id_idx" ON "teams" USING btree ("captain_player_id");