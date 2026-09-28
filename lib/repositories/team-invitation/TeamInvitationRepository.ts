// Data-access boundary for `team_invitations` -- read-only here, same
// reasoning as TeamRepository.ts.
export type TeamInvitationStatus = "pending" | "accepted" | "declined" | "cancelled";

export type TeamInvitationRow = {
  id: string;
  team_id: string;
  invited_player_id: string;
  invited_by_player_id: string;
  status: TeamInvitationStatus;
  created_at: string;
  responded_at: string | null;
};

export interface TeamInvitationRepository {
  findById(id: string): Promise<TeamInvitationRow | null>;
  // "Моя команда" shows pending invitations even for a player who belongs
  // to no team yet -- this is the one query that screen needs.
  findPendingByPlayerId(playerId: string): Promise<TeamInvitationRow[]>;
  findPendingByTeamAndPlayer(teamId: string, playerId: string): Promise<TeamInvitationRow | null>;
  // Captain's own invitation management list (pending + historical).
  listByTeamId(teamId: string): Promise<TeamInvitationRow[]>;
  // "active members + pending invitations >= 5" capacity-reservation rule
  // (features/teams.ts::inviteToTeam) -- just the pending count for one team.
  countPendingByTeamId(teamId: string): Promise<number>;
}
