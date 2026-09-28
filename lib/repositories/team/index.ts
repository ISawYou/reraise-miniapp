import { PostgresTeamRepository } from "./PostgresTeamRepository";
import type { TeamRepository } from "./TeamRepository";

export type { TeamRepository, TeamRow, TeamStatus } from "./TeamRepository";

export const teamRepository: TeamRepository = new PostgresTeamRepository();
