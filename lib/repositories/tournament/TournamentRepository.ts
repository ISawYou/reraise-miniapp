import type { Tournament, TournamentStatus } from "@/types/domain";
import type { TournamentRow } from "@/types/database";

// Data-access boundary for `tournaments`. Deliberately a thin CRUD surface:
// visibility-by-player-access-kind filtering, live-mode eligibility
// (`kind === "free"` checks), and all orchestration around
// completing/creating a tournament stay in features/tournaments.ts and
// app/api/admin/tournaments/route.ts, exactly as before.
export type TournamentInsert = Partial<TournamentRow>;
export type TournamentPatch = Partial<TournamentRow>;

export interface TournamentRepository {
  findById(tournamentId: string): Promise<Tournament>;
  // Mirrors the several call sites that only need id+season_id, not the
  // full row (completeTournamentFromLiveEntries, saveTournamentResults).
  findSeasonIdById(tournamentId: string): Promise<{ id: string; season_id: string | null }>;

  listOpen(): Promise<Tournament[]>;
  listCompleted(): Promise<Tournament[]>;
  listExcludingStatus(status: TournamentStatus): Promise<Tournament[]>;
  listByStatuses(statuses: TournamentStatus[]): Promise<Tournament[]>;

  create(data: TournamentInsert): Promise<Tournament>;
  // With select-back — used where the caller needs the updated row.
  update(tournamentId: string, patch: TournamentPatch): Promise<Tournament>;
  // Without select-back — mirrors the fire-and-forget status/field updates
  // (setTournamentGoogleSheetTabName, the two "mark completed" updates)
  // that never read the result today.
  patch(tournamentId: string, patch: TournamentPatch): Promise<void>;
  delete(tournamentId: string): Promise<void>;
}
