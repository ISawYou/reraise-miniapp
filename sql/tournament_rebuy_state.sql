-- Live Re-buy/Add-on state for kind='free' (rating/points) tournaments,
-- persisted the instant an admin edits the field (not only at tournament
-- completion). Deliberately NOT tournament_live_entries (that table's
-- registration_id FK / knockouts / place / sheet_row_number are specific to
-- paid/cash tournaments) and NOT results.reentries/results.addons (a frozen
-- snapshot written once at completion for the rating engine). Mirrors
-- tournament_attendance.sql's shape and rationale -- see
-- docs/POKER_CLOCK_REBUY_ADDON_INVESTIGATION.md §3-6 for the read-only
-- investigation that found free tournaments had no live storage for these
-- two fields at all before this table.
--
-- Stores the RAW admin-facing "Re-buy" value (Total Entries convention --
-- initial stack + every rebuy, see results.reentries's own doc comment),
-- not a pre-normalized rebuy-only count. Normalization into
-- initialStackTaken/rebuys for the Poker Clock integration contract happens
-- in application code (features/tournaments.ts::getArrivedPlayersForIntegration),
-- never here.
--
-- Concurrency: same accepted semantics as tournament_attendance -- plain
-- last-processed-wins on conflict, no client-supplied ordering token. Unlike
-- tournament_attendance.arrived_at, neither rebuys nor addons needs a
-- COALESCE-against-current-value on write, so a plain Supabase
-- `.upsert()` is enough here -- no RPC function required (contrast with
-- upsert_tournament_attendance below in tournament_attendance.sql).
CREATE TABLE IF NOT EXISTS tournament_rebuy_state (
  tournament_id uuid NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  player_id uuid NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  rebuys integer NOT NULL DEFAULT 0 CHECK (rebuys >= 0),
  addons integer NOT NULL DEFAULT 0 CHECK (addons >= 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tournament_id, player_id)
);
