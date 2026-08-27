ALTER TABLE "players" DROP CONSTRAINT "players_role_check";--> statement-breakpoint
ALTER TABLE "dealer_shifts" ADD COLUMN "tournament_id" uuid;--> statement-breakpoint
ALTER TABLE "dealer_shifts" ADD CONSTRAINT "dealer_shifts_tournament_id_tournaments_id_fk" FOREIGN KEY ("tournament_id") REFERENCES "public"."tournaments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "dealer_shifts_tournament_id_idx" ON "dealer_shifts" USING btree ("tournament_id");--> statement-breakpoint
ALTER TABLE "players" ADD CONSTRAINT "players_role_check" CHECK ("players"."role" IN ('player', 'operator', 'admin'));