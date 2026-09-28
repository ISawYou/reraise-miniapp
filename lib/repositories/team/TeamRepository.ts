// Data-access boundary for `teams` -- deliberately READ-ONLY at this layer.
// Teams v1's writes are always multi-table, transactional operations
// (create team + captain membership, disband + close memberships + cancel
// invitations, accept invitation + create membership, ...) with row-lock
// discipline that a per-table repository method can't safely express --
// exactly like lib/player-merge.ts's executeMerge, they're written as a
// single db.transaction(...) directly against the Drizzle schema tables in
// features/teams.ts, not through repository write methods. This interface
// only serves the read paths (leaderboard, team detail, "моя команда").
export type TeamStatus = "active" | "disbanded";

export type TeamRow = {
  id: string;
  name: string;
  emblem: string;
  captain_player_id: string;
  status: TeamStatus;
  created_at: string;
  updated_at: string;
  disbanded_at: string | null;
};

export interface TeamRepository {
  findById(teamId: string): Promise<TeamRow | null>;
  findByIdOrThrow(teamId: string): Promise<TeamRow>;
  // Case-insensitive -- mirrors the teams_name_lower_unique_idx DB
  // constraint exactly, so a pre-check here and the constraint itself can
  // never disagree about whether a name is taken.
  findByNameCaseInsensitive(name: string): Promise<TeamRow | null>;
  // Every team regardless of status -- a disbanded team with historical
  // points must still appear in standings (see lib/team-scoring.ts), so
  // read paths filter/partition status themselves rather than this method
  // hiding disbanded rows.
  listAll(): Promise<TeamRow[]>;
}
