import { SupabaseTournamentRepository } from "./SupabaseTournamentRepository";
import type { TournamentRepository } from "./TournamentRepository";

export type {
  TournamentRepository,
  TournamentInsert,
  TournamentPatch,
} from "./TournamentRepository";

export const tournamentRepository: TournamentRepository =
  new SupabaseTournamentRepository();
