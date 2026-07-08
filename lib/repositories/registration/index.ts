import { SupabaseRegistrationRepository } from "./SupabaseRegistrationRepository";
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

export const registrationRepository: RegistrationRepository =
  new SupabaseRegistrationRepository();
