CREATE TABLE "tournament_attendance" (
	"tournament_id" uuid NOT NULL,
	"player_id" uuid NOT NULL,
	"arrived" boolean DEFAULT false NOT NULL,
	"arrived_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tournament_attendance_tournament_id_player_id_pk" PRIMARY KEY("tournament_id","player_id")
);
--> statement-breakpoint
ALTER TABLE "tournament_attendance" ADD CONSTRAINT "tournament_attendance_tournament_id_tournaments_id_fk" FOREIGN KEY ("tournament_id") REFERENCES "public"."tournaments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tournament_attendance" ADD CONSTRAINT "tournament_attendance_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;