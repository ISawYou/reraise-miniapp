import { PostgresTeamInvitationRepository } from "./PostgresTeamInvitationRepository";
import type { TeamInvitationRepository } from "./TeamInvitationRepository";

export type {
  TeamInvitationRepository,
  TeamInvitationRow,
  TeamInvitationStatus,
} from "./TeamInvitationRepository";

export const teamInvitationRepository: TeamInvitationRepository = new PostgresTeamInvitationRepository();
