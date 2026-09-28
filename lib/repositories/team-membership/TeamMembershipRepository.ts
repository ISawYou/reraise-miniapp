// Data-access boundary for `team_memberships` -- read-only here, same
// reasoning as TeamRepository.ts (writes are transactional and live in
// features/teams.ts alongside the teams/team_invitations writes they must
// stay atomic with).
export type TeamMembershipRow = {
  id: string;
  team_id: string;
  player_id: string;
  joined_at: string;
  left_at: string | null;
  created_at: string;
};

export interface TeamMembershipRepository {
  // At most one row can ever match (team_memberships_one_active_per_player_idx).
  findActiveByPlayerId(playerId: string): Promise<TeamMembershipRow | null>;
  findActiveByTeamId(teamId: string): Promise<TeamMembershipRow[]>;
  countActiveByTeamId(teamId: string): Promise<number>;
  // Every membership row that ever existed, across every team and player --
  // the full history lib/team-scoring.ts's temporal attribution reads in
  // bulk (small dataset: a handful of rows per player over the club's
  // lifetime, not per-result fan-out).
  listAll(): Promise<TeamMembershipRow[]>;
}
