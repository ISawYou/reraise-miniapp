CREATE TABLE "tournament_operation_audit" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tournament_id" uuid NOT NULL,
	"player_id" uuid NOT NULL,
	"actor_id" uuid NOT NULL,
	"before" jsonb,
	"after" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tournament_operations" (
	"tournament_id" uuid NOT NULL,
	"player_id" uuid NOT NULL,
	"paid" boolean,
	"payment_method" text,
	"free_reentries" integer,
	"knockouts" integer,
	"boss_knockouts" integer,
	"mystery_points" integer,
	"place" integer,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_by" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tournament_operations_tournament_id_player_id_pk" PRIMARY KEY("tournament_id","player_id"),
	CONSTRAINT "operations_nonnegative" CHECK (("tournament_operations"."free_reentries" is null or "tournament_operations"."free_reentries">=0) and ("tournament_operations"."knockouts" is null or "tournament_operations"."knockouts">=0) and ("tournament_operations"."boss_knockouts" is null or "tournament_operations"."boss_knockouts">=0) and ("tournament_operations"."mystery_points" is null or "tournament_operations"."mystery_points">=0) and ("tournament_operations"."place" is null or "tournament_operations"."place">0) and "tournament_operations"."version">0),
	CONSTRAINT "operations_payment_method" CHECK ("tournament_operations"."payment_method" is null or "tournament_operations"."payment_method" in ('cash','card','mixed'))
);
--> statement-breakpoint
ALTER TABLE "tournament_operations" ADD CONSTRAINT "tournament_operations_tournament_id_tournaments_id_fk" FOREIGN KEY ("tournament_id") REFERENCES "public"."tournaments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tournament_operations" ADD CONSTRAINT "tournament_operations_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;