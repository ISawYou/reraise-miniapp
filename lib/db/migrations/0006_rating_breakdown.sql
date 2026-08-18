ALTER TABLE "results" ADD COLUMN "arrived" boolean;--> statement-breakpoint
ALTER TABLE "results" ADD COLUMN "participation_points" integer;--> statement-breakpoint
ALTER TABLE "results" ADD COLUMN "knockout_points" integer;--> statement-breakpoint
ALTER TABLE "results" ADD COLUMN "boss_bounty_points" integer;--> statement-breakpoint
ALTER TABLE "results" ADD COLUMN "itm_points" integer;--> statement-breakpoint
ALTER TABLE "results" ADD CONSTRAINT "results_participation_points_check" CHECK ("results"."participation_points" >= 0);--> statement-breakpoint
ALTER TABLE "results" ADD CONSTRAINT "results_knockout_points_check" CHECK ("results"."knockout_points" >= 0);--> statement-breakpoint
ALTER TABLE "results" ADD CONSTRAINT "results_boss_bounty_points_check" CHECK ("results"."boss_bounty_points" >= 0);--> statement-breakpoint
ALTER TABLE "results" ADD CONSTRAINT "results_itm_points_check" CHECK ("results"."itm_points" >= 0);--> statement-breakpoint
ALTER TABLE "results" ADD CONSTRAINT "results_rating_points_breakdown_check" CHECK ("results"."rating_points" = "results"."participation_points" + "results"."knockout_points" + "results"."boss_bounty_points" + "results"."mystery_bounty_points" + "results"."itm_points");