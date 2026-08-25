import type { RatingFormulaVersion, RatingPlace, TournamentType } from "@/types/domain";

export type TournamentLateRegistrationRow = {
  tournament_id: string;
  arrived_players_count: number;
  initial_stacks_count: number;
  total_entries_count: number;
  rebuys_count: number;
  addons_count: number;
  tournament_type: TournamentType;
  rating_formula_version: RatingFormulaVersion;
  rating_guarantee: number | null;
  rating_places: RatingPlace[];
  closed_at: string;
};

export type TournamentLateRegistrationInsert = Omit<
  TournamentLateRegistrationRow,
  "closed_at"
>;

export interface TournamentLateRegistrationRepository {
  findByTournamentId(tournamentId: string): Promise<TournamentLateRegistrationRow | null>;
  // Insert-once semantics: a concurrent/repeated close returns the row that
  // won the unique tournament_id race and never overwrites its snapshot.
  insertIfAbsent(
    row: TournamentLateRegistrationInsert
  ): Promise<TournamentLateRegistrationRow>;
}
