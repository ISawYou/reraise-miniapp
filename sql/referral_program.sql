-- Migration: Add referral program fields to players table
ALTER TABLE players
  ADD COLUMN IF NOT EXISTS referral_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS free_reentries_balance integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS yandex_review_bonus_claimed boolean NOT NULL DEFAULT false;
