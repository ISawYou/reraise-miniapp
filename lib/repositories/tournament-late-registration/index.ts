import type { TournamentLateRegistrationRepository } from "./TournamentLateRegistrationRepository";
import { PostgresTournamentLateRegistrationRepository } from "./PostgresTournamentLateRegistrationRepository";
import { SupabaseTournamentLateRegistrationRepository } from "./SupabaseTournamentLateRegistrationRepository";

export type {
  TournamentLateRegistrationInsert,
  TournamentLateRegistrationRepository,
  TournamentLateRegistrationRow,
} from "./TournamentLateRegistrationRepository";

const usePostgres = process.env.DATABASE_PROVIDER === "postgres";

export const tournamentLateRegistrationRepository: TournamentLateRegistrationRepository =
  usePostgres
    ? new PostgresTournamentLateRegistrationRepository()
    : new SupabaseTournamentLateRegistrationRepository();
