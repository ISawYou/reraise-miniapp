CREATE TABLE "tournament_pko_events" (
  "tournament_id" uuid NOT NULL,
  "sequence" integer NOT NULL,
  "event_id" text NOT NULL,
  "event_data" jsonb NOT NULL,
  "actor_id" uuid NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "tournament_pko_events_tournament_id_tournaments_id_fk" FOREIGN KEY ("tournament_id") REFERENCES "tournaments"("id") ON DELETE CASCADE,
  CONSTRAINT "tournament_pko_events_actor_id_players_id_fk" FOREIGN KEY ("actor_id") REFERENCES "players"("id") ON DELETE RESTRICT,
  CONSTRAINT "tournament_pko_events_pk" PRIMARY KEY ("tournament_id", "sequence"),
  CONSTRAINT "tournament_pko_events_sequence_check" CHECK ("sequence" > 0),
  CONSTRAINT "tournament_pko_events_event_id_check" CHECK (char_length("event_id") BETWEEN 1 AND 128),
  CONSTRAINT "tournament_pko_events_payload_check" CHECK (
    jsonb_typeof("event_data") = 'object'
    AND "event_data"->>'eventId' = "event_id"
    AND "event_data"->>'kind' IN ('entry', 'knockout', 'void_knockout', 'finish')
  )
);--> statement-breakpoint
CREATE UNIQUE INDEX "tournament_pko_events_event_id_uk" ON "tournament_pko_events" USING btree ("tournament_id", "event_id");
--> statement-breakpoint
ALTER TABLE "tournaments" DROP CONSTRAINT "tournaments_tournament_type_check";
--> statement-breakpoint
ALTER TABLE "tournaments" ADD CONSTRAINT "tournaments_tournament_type_check" CHECK ("tournaments"."tournament_type" IN ('qualification_final', 'classic', 'phoenix', 'deep_stack', 'bounty', 'boss_bounty', 'win_the_button', 'mystery_bounty', 'crazy_pineapple', 'bomb_pot', 'boost_rating', 'free_roll', 'omaha_holdem_mix', 'progressive_knockout'));
