CREATE TABLE "club_activity_comments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"player_id" uuid NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "club_activity_comments_body_length" CHECK (char_length("club_activity_comments"."body") BETWEEN 1 AND 1000)
);
--> statement-breakpoint
CREATE TABLE "club_activity_likes" (
	"event_id" uuid NOT NULL,
	"player_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "club_activity_likes_event_player_pk" PRIMARY KEY("event_id","player_id")
);
--> statement-breakpoint
ALTER TABLE "club_activity_comments" ADD CONSTRAINT "club_activity_comments_event_id_club_activity_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."club_activity_events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "club_activity_comments" ADD CONSTRAINT "club_activity_comments_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "club_activity_likes" ADD CONSTRAINT "club_activity_likes_event_id_club_activity_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."club_activity_events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "club_activity_likes" ADD CONSTRAINT "club_activity_likes_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "club_activity_comments_event_created_idx" ON "club_activity_comments" USING btree ("event_id","created_at");--> statement-breakpoint
CREATE INDEX "club_activity_comments_player_idx" ON "club_activity_comments" USING btree ("player_id");--> statement-breakpoint
CREATE INDEX "club_activity_likes_player_idx" ON "club_activity_likes" USING btree ("player_id");