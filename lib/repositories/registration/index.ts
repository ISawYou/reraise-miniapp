import { SupabaseRegistrationRepository } from "./SupabaseRegistrationRepository";
import { PostgresRegistrationRepository } from "./PostgresRegistrationRepository";
import type { RegistrationRepository } from "./RegistrationRepository";

export type {
  RegistrationRepository,
  RegistrationInsert,
  PlayerJoin,
  RegistrationWithTournamentRow,
  ExportParticipantRow,
  ParticipantWithRatingRow,
  ResultsDraftParticipantRow,
  AdminParticipantRow,
  LiveEligibleRow,
  NotificationRecipientRow,
} from "./RegistrationRepository";

const usePostgres = process.env.DATABASE_PROVIDER === "postgres";

export const registrationRepository: RegistrationRepository = usePostgres
  ? new PostgresRegistrationRepository()
  : new SupabaseRegistrationRepository();
