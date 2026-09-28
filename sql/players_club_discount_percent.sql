-- Migration: Add club discount percent (Player.club_discount_percent)
-- See lib/db/schema/players.ts's clubDiscountPercent doc comment.
ALTER TABLE players
  ADD COLUMN IF NOT EXISTS club_discount_percent integer NOT NULL DEFAULT 0;

-- Run once; DO NOT re-run after it has already applied (plain ADD
-- CONSTRAINT, not idempotent, unlike the ADD COLUMN above).
ALTER TABLE players
  ADD CONSTRAINT players_club_discount_percent_check
  CHECK (club_discount_percent BETWEEN 0 AND 100);
