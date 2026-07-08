import { SupabaseTournamentRepository } from "./SupabaseTournamentRepository";
import { PostgresTournamentRepository } from "./PostgresTournamentRepository";
import type { TournamentRepository } from "./TournamentRepository";

export type {
  TournamentRepository,
  TournamentInsert,
  TournamentPatch,
} from "./TournamentRepository";

const usePostgres = process.env.DATABASE_PROVIDER === "postgres";

export const tournamentRepository: TournamentRepository = usePostgres
  ? new PostgresTournamentRepository()
  : new SupabaseTournamentRepository();
