// Data-access boundary for `team_join_requests` -- read-only here, same
// reasoning as TeamInvitationRepository.ts (writes are transactional and
// live in features/teams.ts alongside the teams/team_memberships writes
// they must stay atomic with).
export type TeamJoinRequestStatus = "pending" | "accepted" | "declined" | "cancelled";

export type TeamJoinRequestRow = {
  id: string;
  team_id: string;
  player_id: string;
  status: TeamJoinRequestStatus;
  created_at: string;
  responded_at: string | null;
};

export interface TeamJoinRequestRepository {
  findById(id: string): Promise<TeamJoinRequestRow | null>;
  // Own profile / "Моя команда": this player's own outgoing pending requests.
  findPendingByPlayerId(playerId: string): Promise<TeamJoinRequestRow[]>;
  findPendingByTeamAndPlayer(teamId: string, playerId: string): Promise<TeamJoinRequestRow | null>;
  // Captain's incoming-requests section.
  findPendingByTeamId(teamId: string): Promise<TeamJoinRequestRow[]>;
}
