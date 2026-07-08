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
  place: number | null;
};

export type LiveEntryPatch = {
  arrived: boolean;
  rebuys: number;
  addons: number;
  knockouts: number;
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
}
