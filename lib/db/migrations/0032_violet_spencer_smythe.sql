CREATE TABLE "tournament_notification_broadcasts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"broadcast_id" uuid NOT NULL,
	"payload_fingerprint" text NOT NULL,
	"tournament_id" uuid NOT NULL,
	"audience" text NOT NULL,
	"test_mode" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'processing' NOT NULL,
	"total_recipients" integer DEFAULT 0 NOT NULL,
	"success_count" integer DEFAULT 0 NOT NULL,
	"failed_count" integer DEFAULT 0 NOT NULL,
	"skipped_count" integer DEFAULT 0 NOT NULL,
	"errors" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "tournament_notification_broadcasts_status_check" CHECK ("tournament_notification_broadcasts"."status" IN ('processing', 'completed', 'failed')),
	CONSTRAINT "tournament_notification_broadcasts_audience_check" CHECK ("tournament_notification_broadcasts"."audience" IN ('registered', 'access'))
);
--> statement-breakpoint
ALTER TABLE "tournament_notification_broadcasts" ADD CONSTRAINT "tournament_notification_broadcasts_tournament_fk" FOREIGN KEY ("tournament_id") REFERENCES "public"."tournaments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "tournament_notification_broadcasts_broadcast_id_key" ON "tournament_notification_broadcasts" USING btree ("broadcast_id");--> statement-breakpoint
CREATE INDEX "tournament_notification_broadcasts_tournament_idx" ON "tournament_notification_broadcasts" USING btree ("tournament_id","created_at");