CREATE TABLE "dealer_profiles" (
	"player_id" uuid PRIMARY KEY NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"hourly_rate_rub" integer DEFAULT 500 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "dealer_profiles_hourly_rate_check" CHECK ("dealer_profiles"."hourly_rate_rub" >= 0)
);
--> statement-breakpoint
CREATE TABLE "dealer_shifts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"dealer_player_id" uuid NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone,
	"hourly_rate_rub" integer NOT NULL,
	"worked_minutes" integer,
	"paid_hours" integer,
	"amount_rub" integer,
	"created_by_player_id" uuid,
	"ended_by_player_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "dealer_shifts_hourly_rate_check" CHECK ("dealer_shifts"."hourly_rate_rub" >= 0),
	CONSTRAINT "dealer_shifts_worked_minutes_check" CHECK ("dealer_shifts"."worked_minutes" IS NULL OR "dealer_shifts"."worked_minutes" > 0),
	CONSTRAINT "dealer_shifts_paid_hours_check" CHECK ("dealer_shifts"."paid_hours" IS NULL OR "dealer_shifts"."paid_hours" > 0),
	CONSTRAINT "dealer_shifts_amount_check" CHECK ("dealer_shifts"."amount_rub" IS NULL OR "dealer_shifts"."amount_rub" >= 0),
	CONSTRAINT "dealer_shifts_ended_after_started_check" CHECK ("dealer_shifts"."ended_at" IS NULL OR "dealer_shifts"."ended_at" > "dealer_shifts"."started_at")
);
--> statement-breakpoint
ALTER TABLE "dealer_profiles" ADD CONSTRAINT "dealer_profiles_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dealer_shifts" ADD CONSTRAINT "dealer_shifts_dealer_player_id_players_id_fk" FOREIGN KEY ("dealer_player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dealer_shifts" ADD CONSTRAINT "dealer_shifts_created_by_player_id_players_id_fk" FOREIGN KEY ("created_by_player_id") REFERENCES "public"."players"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dealer_shifts" ADD CONSTRAINT "dealer_shifts_ended_by_player_id_players_id_fk" FOREIGN KEY ("ended_by_player_id") REFERENCES "public"."players"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "dealer_shifts_one_open_per_dealer" ON "dealer_shifts" USING btree ("dealer_player_id") WHERE "dealer_shifts"."ended_at" IS NULL;