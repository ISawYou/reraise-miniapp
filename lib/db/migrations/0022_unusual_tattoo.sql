CREATE TABLE "player_merge_intents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"target_player_id" uuid NOT NULL,
	"source_player_id" uuid NOT NULL,
	"email" text NOT NULL,
	"otp_verification_id" uuid,
	"status" text DEFAULT 'pending' NOT NULL,
	"conflict_reason" text,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	CONSTRAINT "player_merge_intents_status_check" CHECK ("player_merge_intents"."status" IN ('pending', 'conflict', 'completed', 'expired', 'cancelled')),
	CONSTRAINT "player_merge_intents_not_self" CHECK ("player_merge_intents"."target_player_id" != "player_merge_intents"."source_player_id")
);
--> statement-breakpoint
ALTER TABLE "players" ADD COLUMN "merged_into_player_id" uuid;--> statement-breakpoint
ALTER TABLE "players" ADD COLUMN "merged_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "player_merge_intents" ADD CONSTRAINT "player_merge_intents_target_player_id_players_id_fk" FOREIGN KEY ("target_player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_merge_intents" ADD CONSTRAINT "player_merge_intents_source_player_id_players_id_fk" FOREIGN KEY ("source_player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "player_merge_intents" ADD CONSTRAINT "player_merge_intents_otp_verification_id_email_otp_codes_id_fk" FOREIGN KEY ("otp_verification_id") REFERENCES "public"."email_otp_codes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "player_merge_intents_target_idx" ON "player_merge_intents" USING btree ("target_player_id");--> statement-breakpoint
CREATE INDEX "player_merge_intents_source_idx" ON "player_merge_intents" USING btree ("source_player_id");--> statement-breakpoint
CREATE INDEX "player_merge_intents_status_idx" ON "player_merge_intents" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "player_merge_intents_pending_unique" ON "player_merge_intents" USING btree ("target_player_id","source_player_id") WHERE "player_merge_intents"."status" = 'pending';--> statement-breakpoint
ALTER TABLE "players" ADD CONSTRAINT "players_merged_into_player_id_players_id_fk" FOREIGN KEY ("merged_into_player_id") REFERENCES "public"."players"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "players_merged_into_player_id_idx" ON "players" USING btree ("merged_into_player_id");--> statement-breakpoint
ALTER TABLE "players" ADD CONSTRAINT "players_merged_into_not_self" CHECK ("players"."merged_into_player_id" IS NULL OR "players"."merged_into_player_id" != "players"."id");