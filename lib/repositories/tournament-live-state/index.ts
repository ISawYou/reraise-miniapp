import { SupabaseTournamentLiveStateRepository } from "./SupabaseTournamentLiveStateRepository";
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

export const tournamentLiveStateRepository: TournamentLiveStateRepository =
  new SupabaseTournamentLiveStateRepository();
