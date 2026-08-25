-- Live "Пришёл" state for the tournament results page checkbox, persisted the
-- instant an admin toggles it (not only at tournament completion). Deliberately
-- separate from registrations.status (registration lifecycle; "attended" there
-- is only set in bulk at completion, not a live check-in signal) and from
-- results.arrived (a frozen snapshot written once at completion for the rating
-- engine). Mirrors tournament_player_eliminations.sql's shape and rationale.
--
-- Concurrency: NOT a versioned/optimistic-concurrency table. A client-supplied
-- ordering token (write_seq = Date.now()) was tried and reverted -- trusting a
-- client device's wall clock as an authoritative DB-level ordering guard is
-- unsound (clock skew between an admin's own devices can make a genuinely
-- later action look "older" and get silently rejected; a client could also
-- send an arbitrarily large value and permanently block every future write
-- for a player). Same-tab click ordering is instead guaranteed entirely
-- client-side (see lib/attendance-write-queue.ts -- writes for one player are
-- serialized, never more than one in flight). Across two different
-- tabs/devices, plain last-processed-wins applies -- accepted as fine for an
-- admin-facing checkbox.
CREATE TABLE IF NOT EXISTS tournament_attendance (
  tournament_id uuid NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  player_id uuid NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  arrived boolean NOT NULL DEFAULT false,
  arrived_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tournament_id, player_id)
);

-- Supabase's PostgREST/JS-client .upsert() can only do an unconditional
-- column overwrite on conflict -- it has no way to express "arrived_at =
-- COALESCE(the row's own current value, now())" in one round-trip, which is
-- what keeps arrived_at's "first arrival time" computation race-free even
-- under two genuinely concurrent cross-tab writes (no separate SELECT before
-- the write, so no read-then-write gap for THAT column). `arrived` itself
-- just gets unconditionally overwritten (last-processed-wins, no guard) --
-- see the table's own doc comment for why that's an accepted, explicit
-- product decision, not an oversight. Callable via
-- `supabase.rpc('upsert_tournament_attendance', {...})`
-- (see SupabaseTournamentLiveStateRepository.ts::upsertAttendance) --
-- functionally identical to PostgresTournamentLiveStateRepository.ts's
-- Drizzle version, kept in sync with it by hand.
CREATE OR REPLACE FUNCTION upsert_tournament_attendance(
  p_tournament_id uuid,
  p_player_id uuid,
  p_arrived boolean
) RETURNS TABLE (arrived boolean, arrived_at timestamptz) AS $$
  INSERT INTO tournament_attendance (tournament_id, player_id, arrived, arrived_at, updated_at)
  VALUES (
    p_tournament_id,
    p_player_id,
    p_arrived,
    CASE WHEN p_arrived THEN now() ELSE NULL END,
    now()
  )
  ON CONFLICT (tournament_id, player_id) DO UPDATE SET
    arrived = excluded.arrived,
    arrived_at = CASE
      WHEN excluded.arrived THEN COALESCE(tournament_attendance.arrived_at, excluded.arrived_at)
      ELSE tournament_attendance.arrived_at
    END,
    updated_at = excluded.updated_at
  RETURNING tournament_attendance.arrived, tournament_attendance.arrived_at;
$$ LANGUAGE sql;
