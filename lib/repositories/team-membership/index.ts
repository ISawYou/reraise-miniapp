import { PostgresTeamMembershipRepository } from "./PostgresTeamMembershipRepository";
import type { TeamMembershipRepository } from "./TeamMembershipRepository";

export type { TeamMembershipRepository, TeamMembershipRow } from "./TeamMembershipRepository";

export const teamMembershipRepository: TeamMembershipRepository = new PostgresTeamMembershipRepository();
