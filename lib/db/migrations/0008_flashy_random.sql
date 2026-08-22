CREATE TABLE "club_activity_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_type" text NOT NULL,
	"source" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"image_url" text,
	"cta_label" text,
	"cta_url" text,
	"player_id" uuid,
	"tournament_id" uuid,
	"achievement_code" text,
	"idempotency_key" text,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "club_activity_events_source_check" CHECK ("club_activity_events"."source" IN ('manual', 'automatic')),
	CONSTRAINT "club_activity_events_status_check" CHECK ("club_activity_events"."status" IN ('draft', 'published', 'archived')),
	CONSTRAINT "club_activity_events_title_length" CHECK (char_length("club_activity_events"."title") BETWEEN 1 AND 200),
	CONSTRAINT "club_activity_events_body_length" CHECK (char_length("club_activity_events"."body") BETWEEN 1 AND 5000),
	CONSTRAINT "club_activity_events_published_at_check" CHECK ("club_activity_events"."status" <> 'published' OR "club_activity_events"."published_at" IS NOT NULL),
	CONSTRAINT "club_activity_events_idempotency_check" CHECK (("club_activity_events"."source" = 'automatic' AND "club_activity_events"."idempotency_key" IS NOT NULL) OR ("club_activity_events"."source" = 'manual' AND "club_activity_events"."idempotency_key" IS NULL))
);
--> statement-breakpoint
ALTER TABLE "club_activity_events" ADD CONSTRAINT "club_activity_events_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "club_activity_events" ADD CONSTRAINT "club_activity_events_tournament_id_tournaments_id_fk" FOREIGN KEY ("tournament_id") REFERENCES "public"."tournaments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "club_activity_events_idempotency_key_idx" ON "club_activity_events" USING btree ("idempotency_key") WHERE "club_activity_events"."idempotency_key" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "club_activity_events_feed_idx" ON "club_activity_events" USING btree ("status","published_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "club_activity_events_created_idx" ON "club_activity_events" USING btree ("created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "club_activity_events_player_idx" ON "club_activity_events" USING btree ("player_id");--> statement-breakpoint
CREATE INDEX "club_activity_events_tournament_idx" ON "club_activity_events" USING btree ("tournament_id");