ALTER TABLE "players" ADD COLUMN "club_discount_percent" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "results" ADD COLUMN "club_discount_percent" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "players" ADD CONSTRAINT "players_club_discount_percent_check" CHECK ("players"."club_discount_percent" BETWEEN 0 AND 100);--> statement-breakpoint
ALTER TABLE "results" ADD CONSTRAINT "results_club_discount_percent_check" CHECK ("results"."club_discount_percent" BETWEEN 0 AND 100);