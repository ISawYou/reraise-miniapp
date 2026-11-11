CREATE TABLE "support_messages" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"thread_id" uuid NOT NULL,
	"sender_id" uuid,
	"sender_name" text NOT NULL,
	"sender_kind" text NOT NULL,
	"client_id" uuid NOT NULL,
	"body" text,
	"body_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "support_message_kind" CHECK ("support_messages"."sender_kind" IN ('player','staff')),
	CONSTRAINT "support_message_length" CHECK ("support_messages"."body" IS NULL OR char_length("support_messages"."body") BETWEEN 1 AND 4000)
);
--> statement-breakpoint
CREATE TABLE "support_notice_outbox" (
	"thread_id" uuid NOT NULL,
	"generation" integer NOT NULL,
	"recipient_id" uuid NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"available_at" timestamp with time zone DEFAULT now() NOT NULL,
	"claimed_at" timestamp with time zone,
	CONSTRAINT "support_notice_outbox_thread_id_generation_recipient_id_pk" PRIMARY KEY("thread_id","generation","recipient_id"),
	CONSTRAINT "support_notice_state" CHECK ("support_notice_outbox"."status" IN ('pending','sending','sent','failed','skipped') AND "support_notice_outbox"."attempts" BETWEEN 0 AND 3)
);
--> statement-breakpoint
CREATE TABLE "support_threads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"player_id" uuid NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"last_player_id" bigint DEFAULT 0 NOT NULL,
	"last_staff_id" bigint DEFAULT 0 NOT NULL,
	"staff_read_through" bigint DEFAULT 0 NOT NULL,
	"generation" integer DEFAULT 0 NOT NULL,
	"last_activity_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone,
	"purged_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "support_thread_state" CHECK ("support_threads"."status" IN ('open','closed') AND ("support_threads"."status"='closed')=("support_threads"."closed_at" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "support_messages" ADD CONSTRAINT "support_messages_thread_id_support_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."support_threads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_messages" ADD CONSTRAINT "support_messages_sender_id_players_id_fk" FOREIGN KEY ("sender_id") REFERENCES "public"."players"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_notice_outbox" ADD CONSTRAINT "support_notice_outbox_thread_id_support_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."support_threads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_notice_outbox" ADD CONSTRAINT "support_notice_outbox_recipient_id_players_id_fk" FOREIGN KEY ("recipient_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_threads" ADD CONSTRAINT "support_threads_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "support_message_client_key" ON "support_messages" USING btree ("thread_id","client_id");--> statement-breakpoint
CREATE INDEX "support_message_history_idx" ON "support_messages" USING btree ("thread_id","id");--> statement-breakpoint
CREATE INDEX "support_message_rate_idx" ON "support_messages" USING btree ("sender_id","created_at");--> statement-breakpoint
CREATE INDEX "support_notice_pending_idx" ON "support_notice_outbox" USING btree ("available_at") WHERE "support_notice_outbox"."status"='pending';--> statement-breakpoint
CREATE UNIQUE INDEX "support_thread_player_key" ON "support_threads" USING btree ("player_id");--> statement-breakpoint
CREATE INDEX "support_thread_inbox_idx" ON "support_threads" USING btree ("status","last_activity_at");--> statement-breakpoint
CREATE INDEX "support_thread_unread_idx" ON "support_threads" USING btree ("last_activity_at") WHERE "support_threads"."last_player_id">"support_threads"."staff_read_through";--> statement-breakpoint
CREATE INDEX "support_thread_expiry_idx" ON "support_threads" USING btree ("closed_at") WHERE "support_threads"."status"='closed';