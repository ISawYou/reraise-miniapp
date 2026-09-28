import { PostgresTeamJoinRequestRepository } from "./PostgresTeamJoinRequestRepository";
import type { TeamJoinRequestRepository } from "./TeamJoinRequestRepository";

export type {
  TeamJoinRequestRepository,
  TeamJoinRequestRow,
  TeamJoinRequestStatus,
} from "./TeamJoinRequestRepository";

export const teamJoinRequestRepository: TeamJoinRequestRepository = new PostgresTeamJoinRequestRepository();
