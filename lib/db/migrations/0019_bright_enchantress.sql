ALTER TABLE "results" ADD COLUMN "free_reentries" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "dealer_shifts" ADD COLUMN "taxi_allowance_rub" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "results" ADD CONSTRAINT "results_free_reentries_check" CHECK ("results"."free_reentries" >= 0);--> statement-breakpoint
ALTER TABLE "dealer_shifts" ADD CONSTRAINT "dealer_shifts_taxi_allowance_check" CHECK ("dealer_shifts"."taxi_allowance_rub" IN (0, 500));