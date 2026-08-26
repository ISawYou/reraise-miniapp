-- Migration: Add player blocking (admin moderation) support
ALTER TABLE players
  ADD COLUMN IF NOT EXISTS is_blocked boolean NOT NULL DEFAULT false;
