ALTER TABLE "tournaments" ADD COLUMN "source_mode" text DEFAULT 'POSTGRESQL' NOT NULL;--> statement-breakpoint
UPDATE "tournaments" SET "source_mode"='LEGACY_GOOGLE_SHEETS' WHERE nullif(btrim("google_sheet_tab_name"),'') IS NOT NULL;
--> statement-breakpoint
ALTER TABLE "tournaments" ADD CONSTRAINT "tournaments_source_mode" CHECK ("tournaments"."source_mode" in ('LEGACY_GOOGLE_SHEETS','POSTGRESQL'));
