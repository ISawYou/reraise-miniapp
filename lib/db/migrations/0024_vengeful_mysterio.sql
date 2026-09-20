CREATE TABLE "admin_shifts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"admin_player_id" uuid NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone,
	"amount_rub" integer DEFAULT 4000 NOT NULL,
	"tournament_id" uuid,
	"created_by_player_id" uuid,
	"ended_by_player_id" uuid,
	"updated_by_player_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "admin_shifts_amount_check" CHECK ("admin_shifts"."amount_rub" >= 0),
	CONSTRAINT "admin_shifts_ended_after_started_check" CHECK ("admin_shifts"."ended_at" IS NULL OR "admin_shifts"."ended_at" >= "admin_shifts"."started_at")
);
--> statement-breakpoint
ALTER TABLE "admin_shifts" ADD CONSTRAINT "admin_shifts_admin_player_id_players_id_fk" FOREIGN KEY ("admin_player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admin_shifts" ADD CONSTRAINT "admin_shifts_tournament_id_tournaments_id_fk" FOREIGN KEY ("tournament_id") REFERENCES "public"."tournaments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admin_shifts" ADD CONSTRAINT "admin_shifts_created_by_player_id_players_id_fk" FOREIGN KEY ("created_by_player_id") REFERENCES "public"."players"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admin_shifts" ADD CONSTRAINT "admin_shifts_ended_by_player_id_players_id_fk" FOREIGN KEY ("ended_by_player_id") REFERENCES "public"."players"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admin_shifts" ADD CONSTRAINT "admin_shifts_updated_by_player_id_players_id_fk" FOREIGN KEY ("updated_by_player_id") REFERENCES "public"."players"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "admin_shifts_one_open_per_admin" ON "admin_shifts" USING btree ("admin_player_id") WHERE "admin_shifts"."ended_at" IS NULL;--> statement-breakpoint
CREATE INDEX "admin_shifts_tournament_id_idx" ON "admin_shifts" USING btree ("tournament_id");