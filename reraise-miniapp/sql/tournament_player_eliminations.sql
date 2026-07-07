-- Elimination tracking for the "Выбыл" checkbox on the tournament results page.
-- Stores eliminated status + timestamp per (tournament, player) independently of
-- Google Sheets, so it survives reloads/re-exports even before the tournament
-- is completed (free-flow drafts have no other DB-backed working table).
CREATE TABLE IF NOT EXISTS tournament_player_eliminations (
  tournament_id uuid NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  player_id uuid NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  eliminated boolean NOT NULL DEFAULT false,
  eliminated_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tournament_id, player_id)
);
