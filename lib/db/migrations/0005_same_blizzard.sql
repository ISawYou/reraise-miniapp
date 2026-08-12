ALTER TABLE "tournaments" ADD COLUMN "rating_formula_version" text;--> statement-breakpoint
-- Every tournament that exists at the time this migration runs was scored by
-- the pre-v2 formula (features/rating.ts, untouched) -- backfill them all to
-- "legacy" BEFORE the column gets its "v2" default, so re-opening/re-completing
-- any of them keeps dispatching to the old formula instead of silently picking
-- up v2 math just because the code changed underneath it. Only tournaments
-- created after this migration (and therefore after the column default takes
-- effect) get "v2".
UPDATE "tournaments" SET "rating_formula_version" = 'legacy' WHERE "rating_formula_version" IS NULL;--> statement-breakpoint
ALTER TABLE "tournaments" ALTER COLUMN "rating_formula_version" SET DEFAULT 'v2';--> statement-breakpoint
ALTER TABLE "tournaments" ALTER COLUMN "rating_formula_version" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "tournaments" ADD CONSTRAINT "tournaments_rating_formula_version_check" CHECK ("tournaments"."rating_formula_version" IN ('legacy', 'v2'));--> statement-breakpoint
ALTER TABLE "tournaments" ADD COLUMN "rating_guarantee" integer;--> statement-breakpoint
ALTER TABLE "tournaments" ADD CONSTRAINT "tournaments_rating_guarantee_check" CHECK ("tournaments"."rating_guarantee" IS NULL OR "tournaments"."rating_guarantee" >= 0);--> statement-breakpoint
-- addons: 0 for every pre-existing row is an honest placeholder (the legacy
-- formula never reads it), not a fabricated historical fact -- see
-- lib/db/schema/results.ts.
ALTER TABLE "results" ADD COLUMN "addons" integer DEFAULT 0 NOT NULL;
