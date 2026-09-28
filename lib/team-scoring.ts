// Teams v1 -- THE one pure, framework-free temporal-attribution helper
// (mirrors features/rating-v2.ts's own "pure, framework-free" convention:
// no DB import, no "server-only", directly unit-testable). There is no
// second rating formula here and no team_points cache/snapshot anywhere in
// the app -- every team total is DERIVED, at read time, from exactly these
// two already-persisted facts:
//
//   1. results.rating_points (frozen at tournament completion -- read as an
//      opaque number, never recalculated from place/KO/etc here)
//   2. team_memberships history (who was on which team, when)
//
// CORE RULE (non-negotiable, see the Teams v1 product spec): a result
// belongs to the team the player was an ACTIVE member of AT TOURNAMENT
// START TIME (tournaments.start_at), never results.created_at. A
// membership interval [joined_at, left_at) "contains" a tournament's
// start_at iff:
//
//   joined_at <= start_at AND (left_at IS NULL OR start_at < left_at)
//
// Exactly one membership interval may match a given (player, tournament)
// pair. Corrupted data that produces MORE THAN ONE match must fail loudly
// (AmbiguousTeamMembershipError) rather than silently pick one and risk
// double-counting or an arbitrary choice.

export type TeamScoringResultInput = {
  tournament_id: string;
  player_id: string;
  rating_points: number;
  season_id: string | null;
  // ISO 8601 timestamp (tournaments.start_at).
  tournament_start_at: string;
};

export type TeamMembershipInterval = {
  id: string;
  team_id: string;
  player_id: string;
  // ISO 8601 timestamps.
  joined_at: string;
  left_at: string | null;
};

export type AttributedResult = {
  tournament_id: string;
  player_id: string;
  team_id: string;
  rating_points: number;
};

export class AmbiguousTeamMembershipError extends Error {
  readonly playerId: string;
  readonly tournamentId: string;
  readonly matchingMembershipIds: string[];

  constructor(playerId: string, tournamentId: string, matchingMembershipIds: string[]) {
    super(
      `Corrupted team membership history: player ${playerId} has ${matchingMembershipIds.length} ` +
        `overlapping membership intervals covering tournament ${tournamentId}'s start time ` +
        `(membership ids: ${matchingMembershipIds.join(", ")}) -- refusing to guess which team ` +
        `should receive these points.`
    );
    this.name = "AmbiguousTeamMembershipError";
    this.playerId = playerId;
    this.tournamentId = tournamentId;
    this.matchingMembershipIds = matchingMembershipIds;
  }
}

function toEpochMs(iso: string): number {
  const ms = new Date(iso).getTime();
  if (Number.isNaN(ms)) {
    throw new Error(`Invalid ISO timestamp passed to team-scoring: ${JSON.stringify(iso)}`);
  }
  return ms;
}

// The one membership interval (if any) that was active for `playerId` at
// `tournamentStartAtIso`. Exported on its own (not just inlined in
// attributeResultsToTeams) so both the bulk scoring path AND any future
// single-lookup caller (e.g. a diagnostic tool) share exactly one
// implementation of the interval-containment rule.
export function findActiveMembershipAt(
  memberships: readonly TeamMembershipInterval[],
  playerId: string,
  tournamentStartAtIso: string
): TeamMembershipInterval | null {
  const startAt = toEpochMs(tournamentStartAtIso);

  const matches = memberships.filter((m) => {
    if (m.player_id !== playerId) return false;
    if (toEpochMs(m.joined_at) > startAt) return false;
    if (m.left_at === null) return true;
    return startAt < toEpochMs(m.left_at);
  });

  if (matches.length > 1) {
    throw new AmbiguousTeamMembershipError(
      playerId,
      "(single-lookup, no tournament id in scope)",
      matches.map((m) => m.id)
    );
  }

  return matches[0] ?? null;
}

// Bulk version -- the one this app's read paths actually call. Groups
// memberships by player up front so this is O(results + memberships), not
// O(results * memberships).
export function attributeResultsToTeams(
  results: readonly TeamScoringResultInput[],
  memberships: readonly TeamMembershipInterval[]
): AttributedResult[] {
  const byPlayer = new Map<string, TeamMembershipInterval[]>();
  for (const membership of memberships) {
    const list = byPlayer.get(membership.player_id);
    if (list) {
      list.push(membership);
    } else {
      byPlayer.set(membership.player_id, [membership]);
    }
  }

  const attributed: AttributedResult[] = [];

  for (const result of results) {
    const candidates = byPlayer.get(result.player_id) ?? [];
    const startAt = toEpochMs(result.tournament_start_at);

    const matches = candidates.filter((membership) => {
      if (toEpochMs(membership.joined_at) > startAt) return false;
      if (membership.left_at === null) return true;
      return startAt < toEpochMs(membership.left_at);
    });

    if (matches.length > 1) {
      throw new AmbiguousTeamMembershipError(
        result.player_id,
        result.tournament_id,
        matches.map((m) => m.id)
      );
    }

    const match = matches[0];
    if (!match) {
      // No team was active at tournament start -- this result contributes
      // to no team's total. Never falls back to results.created_at or any
      // other signal.
      continue;
    }

    attributed.push({
      tournament_id: result.tournament_id,
      player_id: result.player_id,
      team_id: match.team_id,
      rating_points: result.rating_points,
    });
  }

  return attributed;
}

export type ScoringScope = { kind: "season"; seasonId: string } | { kind: "all_time" };

// Current season / archive season are the SAME "season" scope shape (just
// a different seasonId) -- there is no separate code path for "archive",
// only a different seasonId supplied by the caller (features/teams.ts
// picks it from lib/repositories/season, exactly like the rest of the app's
// season infrastructure).
export function filterResultsForScope(
  results: readonly TeamScoringResultInput[],
  scope: ScoringScope
): TeamScoringResultInput[] {
  if (scope.kind === "all_time") {
    return [...results];
  }
  return results.filter((result) => result.season_id === scope.seasonId);
}

export type TeamTotal = { team_id: string; points: number };

export function aggregateTeamTotals(attributed: readonly AttributedResult[]): TeamTotal[] {
  const totals = new Map<string, number>();
  for (const row of attributed) {
    totals.set(row.team_id, (totals.get(row.team_id) ?? 0) + row.rating_points);
  }
  return Array.from(totals.entries()).map(([team_id, points]) => ({ team_id, points }));
}

export type MemberContribution = { team_id: string; player_id: string; points: number };

// Member contribution rows for ONE team's detail page -- grouped by player
// within that team. Summing every row for a given team_id always equals
// that team's aggregateTeamTotals() entry exactly (same underlying
// `attributed` rows, just grouped one level finer) -- there is no separate
// accumulation rule that could let the two numbers drift apart.
export function aggregateMemberContributions(attributed: readonly AttributedResult[]): MemberContribution[] {
  const totals = new Map<string, { team_id: string; player_id: string; points: number }>();
  for (const row of attributed) {
    const key = `${row.team_id}\u0000${row.player_id}`;
    const existing = totals.get(key);
    if (existing) {
      existing.points += row.rating_points;
    } else {
      totals.set(key, { team_id: row.team_id, player_id: row.player_id, points: row.rating_points });
    }
  }
  return Array.from(totals.values());
}

export type RankedTeam<T extends { points: number }> = T & { rank: number };

// Competition ranking (1, 1, 3 -- never 1, 1, 2 and never an arbitrary
// tie-break that invents a winner). Callers control presentation order
// WITHIN a tied group by how they sort `teams` before calling this (e.g.
// by team name) -- the rank NUMBER assigned only ever depends on `points`,
// regardless of input order, so a caller's stable secondary sort key can
// never change who shares a rank.
export function rankByPointsDescending<T extends { points: number }>(teams: readonly T[]): RankedTeam<T>[] {
  const sorted = [...teams].sort((a, b) => b.points - a.points);
  const ranked: RankedTeam<T>[] = [];
  let currentRank = 0;
  let previousPoints: number | null = null;

  sorted.forEach((team, index) => {
    if (previousPoints === null || team.points !== previousPoints) {
      currentRank = index + 1;
      previousPoints = team.points;
    }
    ranked.push({ ...team, rank: currentRank });
  });

  return ranked;
}
