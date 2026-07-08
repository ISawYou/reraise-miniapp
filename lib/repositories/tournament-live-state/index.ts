import { SupabaseTournamentLiveStateRepository } from "./SupabaseTournamentLiveStateRepository";
import { PostgresTournamentLiveStateRepository } from "./PostgresTournamentLiveStateRepository";
import type { TournamentLiveStateRepository } from "./TournamentLiveStateRepository";

export type {
  TournamentLiveStateRepository,
  LiveEntryInsert,
  LiveEntryPatch,
  LiveEntryWithDetailsRow,
  LiveEntryPlayerJoin,
  LiveEntryRegistrationJoin,
  EliminationStatus,
  EliminationUpsert,
} from "./TournamentLiveStateRepository";

const usePostgres = process.env.DATABASE_PROVIDER === "postgres";

export const tournamentLiveStateRepository: TournamentLiveStateRepository = usePostgres
  ? new PostgresTournamentLiveStateRepository()
  : new SupabaseTournamentLiveStateRepository();
