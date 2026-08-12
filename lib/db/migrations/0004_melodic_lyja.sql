ALTER TABLE "tournament_mystery_bounty" ADD COLUMN "total_entries_count" integer;--> statement-breakpoint
-- Backfill for rows created before this migration: the pre-fix code summed
-- the raw "Re-buy" field straight into rebuys_count, which is actually Total
-- Entries (Initial Entries + Rebuys), not a rebuy count on its own. So for
-- any existing row, rebuys_count already IS the historical total_entries_count
-- value -- copy it across, then re-derive rebuys_count as
-- max(0, total_entries_count - players_count) so it reflects true rebuys
-- going forward. mystery_pool and any already-awarded results.* points are
-- left untouched -- they are historical fact for whatever was actually paid
-- out at the event, not something this migration should rewrite.
UPDATE "tournament_mystery_bounty" SET "total_entries_count" = "rebuys_count" WHERE "total_entries_count" IS NULL;--> statement-breakpoint
UPDATE "tournament_mystery_bounty" SET "rebuys_count" = GREATEST(0, "rebuys_count" - "players_count") WHERE "total_entries_count" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "tournament_mystery_bounty" ALTER COLUMN "total_entries_count" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "tournament_mystery_bounty" ADD CONSTRAINT "tournament_mystery_bounty_total_entries_check" CHECK ("tournament_mystery_bounty"."total_entries_count" >= "tournament_mystery_bounty"."players_count");
