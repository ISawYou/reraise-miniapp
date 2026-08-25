// Data-access boundary for the *operational* state of a live tournament —
// deliberately combines two tables, tournament_live_entries and
// tournament_player_eliminations, per the agreed architecture (both are
// read/written together during live play, feeding the Google Sheets
// live-sync; splitting them would fragment one operational concern across
// two repositories for no benefit).
//
// Deciding *whether* live mode applies (`kind === "free"` checks),
// building the rows to insert, and all Google Sheets sync stay in
// features/tournaments.ts, exactly as before.
export type LiveEntryPlayerJoin = {
  username?: string | null;
  display_name?: string;
  admin_display_name?: string | null;
} | null;

export type LiveEntryRegistrationJoin = { status?: string } | null;

export type LiveEntryWithDetailsRow = {
  id: string;
  tournament_id: string;
  registration_id: string;
  player_id: string;
  arrived: boolean;
  rebuys: number;
  addons: number;
  knockouts: number;
  boss_knockouts?: number;
  place: number | null;
  sheet_row_number: number | null;
  registrations: LiveEntryRegistrationJoin;
  players: LiveEntryPlayerJoin;
};

export type LiveEntryInsert = {
  tournament_id: string;
  player_id: string;
  registration_id: string;
  arrived: boolean;
  rebuys: number;
  addons: number;
  knockouts: number;
  boss_knockouts?: number;
  place: number | null;
};

export type LiveEntryPatch = {
  arrived: boolean;
  rebuys: number;
  addons: number;
  knockouts: number;
  boss_knockouts?: number;
  place: number | null;
  updated_at: string;
  sheet_row_number?: number;
};

export type EliminationStatus = {
  eliminated: boolean;
  eliminated_at: string | null;
};

export type EliminationUpsert = {
  tournament_id: string;
  player_id: string;
  eliminated: boolean;
  eliminated_at: string | null;
  updated_at: string;
};

export type AttendanceStatus = {
  arrived: boolean;
  arrived_at: string | null;
};

// No client-supplied ordering token here on purpose -- an earlier version
// added `write_seq` (client wall-clock ms) to guard against out-of-order
// writes, reverted because trusting a client device's clock as an
// authoritative DB-level revision is unsound (clock skew between an admin's
// own devices can make a genuinely later action look "older" and get
// silently rejected; a client could also send an arbitrarily large value
// and permanently block every future write for a player). Same-tab click
// ordering is instead guaranteed entirely client-side -- see
// lib/attendance-write-queue.ts: writes for one player are serialized,
// never more than one in flight, so upsertAttendance never needs to decide
// between two competing writes from the SAME client. Across two different
// tabs/devices, whichever write the server actually processes last simply
// wins -- accepted as fine for an admin-facing checkbox.
export type AttendanceUpsert = {
  tournament_id: string;
  player_id: string;
  arrived: boolean;
};

export type AttendanceWriteResult = {
  arrived: boolean;
  arrived_at: string | null;
};

// Player identity fields needed to build the integration-API nickname/avatar
// (getPreferredPlayerDisplayName + custom_avatar_url -> telegram_avatar_url
// -> null, the same canonical resolution used everywhere else in this
// domain) -- deliberately excludes email/telegram_id/username/role/access
// flags, none of which the integration surface is allowed to expose.
export type AttendedPlayerIdentity = {
  display_name: string;
  admin_display_name: string | null;
  custom_avatar_url: string | null;
  telegram_avatar_url: string | null;
} | null;

export type AttendedPlayerRow = {
  player_id: string;
  arrived_at: string | null;
  players: AttendedPlayerIdentity;
};

// --- tournament_rebuy_state ---
// Live Re-buy/Add-on state for kind='free' (rating/points) tournaments --
// see lib/db/schema/tournamentLiveState.ts's doc comment on
// tournamentRebuyState for why this is its own table, separate from
// tournament_live_entries (paid/cash-specific) and from the frozen
// results.reentries/results.addons written only at completion. Stores the
// RAW admin-facing "Re-buy" value (Total Entries convention); normalization
// happens at the feature layer, not here.
export type RebuyState = {
  rebuys: number;
  addons: number;
};

// Plain last-processed-wins upsert, same accepted semantics as
// AttendanceUpsert above -- no client-supplied ordering token, no
// COALESCE-style "preserve a prior value" logic needed (unlike
// arrived_at), since both rebuys and addons are always simple overwrites.
export type RebuyStateUpsert = {
  tournament_id: string;
  player_id: string;
  rebuys: number;
  addons: number;
};

export interface TournamentLiveStateRepository {
  // --- tournament_live_entries ---
  findPlayerIdsWithLiveEntry(tournamentId: string): Promise<string[]>;
  insertLiveEntries(rows: LiveEntryInsert[]): Promise<void>;
  findLiveEntriesWithDetails(tournamentId: string): Promise<LiveEntryWithDetailsRow[]>;
  updateLiveEntry(
    tournamentId: string,
    playerId: string,
    patch: LiveEntryPatch
  ): Promise<void>;
  deleteLiveEntriesByPlayerId(playerId: string): Promise<void>;

  // --- tournament_player_eliminations ---
  findEliminationsByTournamentId(
    tournamentId: string
  ): Promise<Map<string, EliminationStatus>>;
  findEliminatedAtByTournamentAndPlayer(
    tournamentId: string,
    playerId: string
  ): Promise<string | null>;
  upsertElimination(row: EliminationUpsert): Promise<void>;

  // --- tournament_attendance ---
  // Live "Пришёл" state -- see lib/db/schema/tournamentLiveState.ts's doc
  // comment on tournamentAttendance for why this is its own table, not
  // registrations.status or results.arrived.
  findAttendanceByTournamentId(
    tournamentId: string
  ): Promise<Map<string, AttendanceStatus>>;
  // Single atomic statement (not a separate read-then-decide-then-write --
  // that WAS the original implementation, and it left a real gap: two
  // concurrent calls could interleave between their own read and write).
  // `arrived` is unconditionally overwritten (last-processed-wins, see
  // AttendanceUpsert's doc comment); `arrived_at` is computed atomically in
  // the same statement via COALESCE against the row's own current value, so
  // its "first arrival time" semantics stay race-free even under genuinely
  // concurrent cross-tab writes, independent of `arrived`'s own
  // last-write-wins behavior.
  upsertAttendance(row: AttendanceUpsert): Promise<AttendanceWriteResult>;
  // arrived = true rows only, joined with player identity -- feeds the
  // integrations/v1 players endpoint directly (features/tournaments.ts
  // still does the rating lookup + nickname/avatar resolution, per
  // ARCHITECTURE_RULES.md principle 1: no business logic in Repository).
  findAttendedPlayersWithDetails(tournamentId: string): Promise<AttendedPlayerRow[]>;

  // --- tournament_rebuy_state ---
  findRebuyStateByTournamentId(tournamentId: string): Promise<Map<string, RebuyState>>;
  upsertRebuyState(row: RebuyStateUpsert): Promise<RebuyState>;
}
