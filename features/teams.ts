import "server-only";

import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { teams, teamMemberships, teamInvitations } from "@/lib/db/schema";
import { extractPostgresError } from "@/lib/db/postgres-error";
import { playerRepository, resultRepository, seasonRepository } from "@/lib/repositories";
import { resolveCanonicalPlayer } from "@/lib/canonical-player";
import { isTeamEmblem, DEFAULT_TEAM_EMBLEM, type TeamEmblem } from "@/config/team-emblems";
import {
  attributeResultsToTeams,
  aggregateTeamTotals,
  aggregateMemberContributions,
  filterResultsForScope,
  rankByPointsDescending,
  type ScoringScope,
  type TeamMembershipInterval,
} from "@/lib/team-scoring";
import type { Player } from "@/types/domain";

// Teams v1 -- feature/service layer. Every mutation below is authored to
// be called from an API route that has ALREADY resolved `actorId` via
// lib/teams-auth.ts::resolveTeamsActor() (Telegram-initData/session-cookie
// verified, canonical, not blocked) -- these functions trust `actorId` as
// a fact, never as client-submitted data, and never re-derive it from a
// request body. See docs comment on resolveTeamsActor for why that is
// sufficient (same strength /api/dealer/me already relies on).
//
// No team_points column/cache exists anywhere: every total below is
// derived at read time from results.rating_points + team_memberships
// history via lib/team-scoring.ts's pure temporal-attribution helper.

// ---------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------

export class TeamNotFoundError extends Error {
  constructor() {
    super("Команда не найдена");
    this.name = "TeamNotFoundError";
  }
}

export class TeamDisbandedError extends Error {
  constructor() {
    super("Команда распущена и доступна только для чтения");
    this.name = "TeamDisbandedError";
  }
}

export class InvalidTeamNameError extends Error {
  constructor(message = "Название команды должно быть от 2 до 40 символов") {
    super(message);
    this.name = "InvalidTeamNameError";
  }
}

export class TeamNameTakenError extends Error {
  constructor() {
    super("Это название команды уже занято");
    this.name = "TeamNameTakenError";
  }
}

export class InvalidEmblemError extends Error {
  constructor() {
    super("Недопустимая эмблема команды");
    this.name = "InvalidEmblemError";
  }
}

export class AlreadyOnActiveTeamError extends Error {
  constructor() {
    super("Вы уже состоите в активной команде");
    this.name = "AlreadyOnActiveTeamError";
  }
}

export class NotCaptainError extends Error {
  constructor() {
    super("Это действие доступно только капитану команды");
    this.name = "NotCaptainError";
  }
}

export class CaptainCannotLeaveError extends Error {
  constructor() {
    super("Капитан не может покинуть команду — сначала передайте капитанство или распустите команду");
    this.name = "CaptainCannotLeaveError";
  }
}

export class CaptainCannotBeRemovedError extends Error {
  constructor() {
    super("Нельзя исключить капитана из команды");
    this.name = "CaptainCannotBeRemovedError";
  }
}

export class NotActiveTeamMemberError extends Error {
  constructor() {
    super("Игрок не состоит в этой команде");
    this.name = "NotActiveTeamMemberError";
  }
}

export class TeamFullError extends Error {
  constructor() {
    super("В команде уже максимум участников (5/5)");
    this.name = "TeamFullError";
  }
}

export class InviteTargetUnavailableError extends Error {
  constructor(message = "Этого игрока сейчас нельзя пригласить") {
    super(message);
    this.name = "InviteTargetUnavailableError";
  }
}

export class InvitationNotFoundError extends Error {
  constructor() {
    super("Приглашение не найдено");
    this.name = "InvitationNotFoundError";
  }
}

export class InvitationNotPendingError extends Error {
  constructor() {
    super("Это приглашение уже обработано");
    this.name = "InvitationNotPendingError";
  }
}

export class InvitationForbiddenError extends Error {
  constructor() {
    super("Это приглашение адресовано другому игроку");
    this.name = "InvitationForbiddenError";
  }
}

export class PlayerNotFoundError extends Error {
  constructor() {
    super("Игрок не найден");
    this.name = "PlayerNotFoundError";
  }
}

// ---------------------------------------------------------------------
// Player-safe view types -- never expose telegram_id/email/admin fields.
// ---------------------------------------------------------------------

export type PlayerSafeView = {
  player_id: string;
  display_name: string;
  username: string | null;
  telegram_avatar_url: string | null;
  custom_avatar_url: string | null;
};

function toPlayerSafeView(player: Player): PlayerSafeView {
  return {
    player_id: player.id,
    display_name: player.display_name,
    username: player.username,
    telegram_avatar_url: player.telegram_avatar_url ?? null,
    custom_avatar_url: player.custom_avatar_url ?? null,
  };
}

export type TeamRosterMember = PlayerSafeView & {
  is_captain: boolean;
  joined_at: string;
};

export type TeamContributionRow = PlayerSafeView & {
  points: number;
  is_current_member: boolean;
};

export type TeamStandingRow = {
  team_id: string;
  name: string;
  emblem: TeamEmblem | string;
  status: "active" | "disbanded";
  points: number;
  rank: number;
  member_count: number;
};

export type TeamDetailView = {
  id: string;
  name: string;
  emblem: string;
  status: "active" | "disbanded";
  disbanded_at: string | null;
  captain_player_id: string;
  points: number;
  rank: number | null;
  roster: TeamRosterMember[];
  contributions: TeamContributionRow[];
};

export type PendingInvitationView = {
  invitation_id: string;
  team_id: string;
  team_name: string;
  team_emblem: string;
  invited_by: PlayerSafeView;
  created_at: string;
};

export type MyTeamState = {
  team: TeamDetailView | null;
  pending_invitations: PendingInvitationView[];
  // True only when the caller is the current team's captain -- drives which
  // management controls the client renders. Meaningless (false) if team is
  // null.
  is_captain: boolean;
};

export type TeamScopeInput =
  | { kind: "current" }
  | { kind: "archive"; seasonId: string }
  | { kind: "all_time" };

// ---------------------------------------------------------------------
// Small internal helpers
// ---------------------------------------------------------------------

function normalizeTeamName(rawName: string): string {
  const trimmed = rawName.trim();
  if (trimmed.length < 2 || trimmed.length > 40) {
    throw new InvalidTeamNameError();
  }
  return trimmed;
}

function normalizeEmblem(rawEmblem: string): TeamEmblem {
  if (!isTeamEmblem(rawEmblem)) {
    throw new InvalidEmblemError();
  }
  return rawEmblem;
}

// The ONE canonical-resolution + eligibility gate for a candidate invite
// target (or, equivalently, any playerId a captain/actor supplies that
// isn't already the verified acting caller). Silently resolves a
// merged-away id to its canonical target (same transparent-resolution
// policy resolveCanonicalPlayer/resolveCurrentServerActor already use
// elsewhere) -- a merged-away player row itself is never the id that ends
// up in a membership/invitation row.
async function resolveEligiblePlayer(playerId: string): Promise<Player> {
  const raw = await playerRepository.findById(playerId);
  const canonical = await resolveCanonicalPlayer(raw);
  if (!canonical) {
    throw new PlayerNotFoundError();
  }
  if (canonical.is_blocked) {
    throw new InviteTargetUnavailableError("Этот игрок заблокирован");
  }
  return canonical;
}

function isUniqueViolation(error: unknown, constraintNameFragment: string): boolean {
  const info = extractPostgresError(error);
  if (!info || info.code !== "23505") {
    return false;
  }
  return !info.constraint || info.constraint.includes(constraintNameFragment);
}

type TeamRow = typeof teams.$inferSelect;
type MembershipRow = typeof teamMemberships.$inferSelect;

function membershipRowToInterval(row: MembershipRow): TeamMembershipInterval {
  return {
    id: row.id,
    team_id: row.teamId,
    player_id: row.playerId,
    joined_at: row.joinedAt.toISOString(),
    left_at: row.leftAt ? row.leftAt.toISOString() : null,
  };
}

// Resolves a TeamScopeInput to lib/team-scoring.ts's ScoringScope, reading
// the active season only when actually needed ("current"). Returns null
// for "current" when there is currently no active season at all -- callers
// treat that exactly like an empty season (see getPlayerRatingSummary's own
// `currentSeason: null` precedent), never an error.
async function resolveScoringScope(scope: TeamScopeInput): Promise<ScoringScope | null> {
  if (scope.kind === "all_time") {
    return { kind: "all_time" };
  }
  if (scope.kind === "archive") {
    return { kind: "season", seasonId: scope.seasonId };
  }
  const activeSeason = await seasonRepository.findActive();
  return activeSeason ? { kind: "season", seasonId: activeSeason.id } : null;
}

// ---------------------------------------------------------------------
// Scoring read paths
// ---------------------------------------------------------------------

async function computeAllTeamTotals(scope: TeamScopeInput) {
  const scoringScope = await resolveScoringScope(scope);
  const [allResults, allMemberships] = await Promise.all([
    resultRepository.findAllForTeamScoring(),
    db.select().from(teamMemberships),
  ]);

  if (!scoringScope) {
    return { totals: new Map<string, number>(), memberContributions: [] as ReturnType<typeof aggregateMemberContributions> };
  }

  const intervals = allMemberships.map(membershipRowToInterval);
  const filtered = filterResultsForScope(allResults, scoringScope);
  const attributed = attributeResultsToTeams(filtered, intervals);

  const totalsList = aggregateTeamTotals(attributed);
  const totals = new Map(totalsList.map((t) => [t.team_id, t.points]));
  const memberContributions = aggregateMemberContributions(attributed);

  return { totals, memberContributions };
}

// Public "Рейтинг" leaderboard -- every ACTIVE team, plus any DISBANDED
// team that still has points > 0 in this exact scope (a disbanded team
// with zero points in this scope has nothing worth preserving in THIS
// view -- it simply doesn't appear, same as it never having existed for
// this scope). Competition ranking (1, 1, 3); ties broken for DISPLAY
// order only by team name, never affecting the rank number itself.
export async function getTeamLeaderboard(scope: TeamScopeInput): Promise<TeamStandingRow[]> {
  const [allTeams, { totals }, activeCounts] = await Promise.all([
    db.select().from(teams),
    computeAllTeamTotals(scope),
    db
      .select({ teamId: teamMemberships.teamId, count: sql<number>`count(*)::int` })
      .from(teamMemberships)
      .where(isNull(teamMemberships.leftAt))
      .groupBy(teamMemberships.teamId),
  ]);

  const memberCountByTeam = new Map(activeCounts.map((row) => [row.teamId, row.count]));

  const visible = allTeams.filter((team) => {
    if (team.status === "active") return true;
    return (totals.get(team.id) ?? 0) > 0;
  });

  const withPoints = visible
    .map((team) => ({
      team_id: team.id,
      name: team.name,
      emblem: team.emblem,
      status: team.status as "active" | "disbanded",
      points: totals.get(team.id) ?? 0,
      member_count: memberCountByTeam.get(team.id) ?? 0,
    }))
    // Stable presentation order within a tie: team name. The rank number
    // rankByPointsDescending assigns only ever depends on `points`, so this
    // secondary key can never change who shares a rank.
    .sort((a, b) => a.name.localeCompare(b.name, "ru"));

  return rankByPointsDescending(withPoints).map((row) => ({
    team_id: row.team_id,
    name: row.name,
    emblem: row.emblem,
    status: row.status,
    points: row.points,
    rank: row.rank,
    member_count: row.member_count,
  }));
}

async function buildTeamDetailView(team: TeamRow, scope: TeamScopeInput): Promise<TeamDetailView> {
  const [activeMemberships, { totals, memberContributions }, leaderboard] = await Promise.all([
    db
      .select()
      .from(teamMemberships)
      .where(and(eq(teamMemberships.teamId, team.id), isNull(teamMemberships.leftAt))),
    computeAllTeamTotals(scope),
    getTeamLeaderboard(scope),
  ]);

  const contributionsForTeam = memberContributions.filter((row) => row.team_id === team.id);
  const activePlayerIds = new Set(activeMemberships.map((m) => m.playerId));

  const allPlayerIds = Array.from(
    new Set([...activeMemberships.map((m) => m.playerId), ...contributionsForTeam.map((c) => c.player_id)])
  );
  const playerRows = await playerRepository.findByIds(allPlayerIds);
  const playerById = new Map(playerRows.map((p) => [p.id, p]));

  const roster: TeamRosterMember[] = activeMemberships
    .map((membership) => {
      const player = playerById.get(membership.playerId);
      if (!player) return null;
      return {
        ...toPlayerSafeView(player),
        is_captain: player.id === team.captainPlayerId,
        joined_at: membership.joinedAt.toISOString(),
      };
    })
    .filter((row): row is TeamRosterMember => row !== null)
    .sort((a, b) => (a.is_captain === b.is_captain ? 0 : a.is_captain ? -1 : 1));

  const contributions: TeamContributionRow[] = contributionsForTeam
    .map((row) => {
      const player = playerById.get(row.player_id);
      if (!player) return null;
      return {
        ...toPlayerSafeView(player),
        points: row.points,
        is_current_member: activePlayerIds.has(row.player_id),
      };
    })
    .filter((row): row is TeamContributionRow => row !== null)
    .sort((a, b) => b.points - a.points);

  const standing = leaderboard.find((row) => row.team_id === team.id);

  return {
    id: team.id,
    name: team.name,
    emblem: team.emblem,
    status: team.status as "active" | "disbanded",
    disbanded_at: team.disbandedAt ? team.disbandedAt.toISOString() : null,
    captain_player_id: team.captainPlayerId,
    points: standing?.points ?? totals.get(team.id) ?? 0,
    rank: standing?.rank ?? null,
    roster,
    contributions,
  };
}

export async function getTeamDetail(teamId: string, scope: TeamScopeInput): Promise<TeamDetailView | null> {
  const [team] = await db.select().from(teams).where(eq(teams.id, teamId)).limit(1);
  if (!team) return null;
  return buildTeamDetailView(team, scope);
}

export type PlayerTeamBadge = { team_id: string; name: string; emblem: string; rank: number | null };

// Player profile "Team card" (own AND public profiles) -- just enough to
// render "[emblem] TEAM NAME · #N в командном рейтинге" without the caller
// having to pull the whole team detail (roster/contributions) it doesn't
// need. Current season's rank only, current-team membership only (a former
// member shows nothing here -- see the product spec's profile section).
export async function getPlayerActiveTeamSummary(playerId: string): Promise<PlayerTeamBadge | null> {
  const [activeMembership] = await db
    .select()
    .from(teamMemberships)
    .where(and(eq(teamMemberships.playerId, playerId), isNull(teamMemberships.leftAt)))
    .limit(1);
  if (!activeMembership) return null;

  const [team] = await db.select().from(teams).where(eq(teams.id, activeMembership.teamId)).limit(1);
  if (!team) return null;

  const leaderboard = await getTeamLeaderboard({ kind: "current" });
  const standing = leaderboard.find((row) => row.team_id === team.id);

  return { team_id: team.id, name: team.name, emblem: team.emblem, rank: standing?.rank ?? null };
}

// "Моя команда" -- the caller's own team (if any) plus every pending
// invitation addressed to them, visible even with no team at all.
export async function getMyTeamState(actorId: string): Promise<MyTeamState> {
  const [activeMembership, pendingInvitationRows] = await Promise.all([
    db
      .select()
      .from(teamMemberships)
      .where(and(eq(teamMemberships.playerId, actorId), isNull(teamMemberships.leftAt)))
      .limit(1),
    db
      .select()
      .from(teamInvitations)
      .where(and(eq(teamInvitations.invitedPlayerId, actorId), eq(teamInvitations.status, "pending"))),
  ]);

  let team: TeamDetailView | null = null;
  let isCaptain = false;

  if (activeMembership[0]) {
    const [teamRow] = await db.select().from(teams).where(eq(teams.id, activeMembership[0].teamId)).limit(1);
    if (teamRow) {
      team = await buildTeamDetailView(teamRow, { kind: "current" });
      isCaptain = teamRow.captainPlayerId === actorId;
    }
  }

  let pendingInvitations: PendingInvitationView[] = [];
  if (pendingInvitationRows.length > 0) {
    const teamIds = Array.from(new Set(pendingInvitationRows.map((row) => row.teamId)));
    const inviterIds = Array.from(new Set(pendingInvitationRows.map((row) => row.invitedByPlayerId)));
    const [teamRows, inviterRows] = await Promise.all([
      db.select().from(teams).where(inArray(teams.id, teamIds)),
      playerRepository.findByIds(inviterIds),
    ]);
    const teamById = new Map(teamRows.map((t) => [t.id, t]));
    const inviterById = new Map(inviterRows.map((p) => [p.id, p]));

    pendingInvitations = pendingInvitationRows
      .map((row) => {
        const inviteTeam = teamById.get(row.teamId);
        const inviter = inviterById.get(row.invitedByPlayerId);
        if (!inviteTeam || !inviter) return null;
        return {
          invitation_id: row.id,
          team_id: inviteTeam.id,
          team_name: inviteTeam.name,
          team_emblem: inviteTeam.emblem,
          invited_by: toPlayerSafeView(inviter),
          created_at: row.createdAt.toISOString(),
        };
      })
      .filter((row): row is PendingInvitationView => row !== null);
  }

  return { team, pending_invitations: pendingInvitations, is_captain: isCaptain };
}

// Player-safe search for the captain's invite picker -- display_name/
// username/avatars ONLY, never telegram_id/email/role/admin fields.
// Excludes: the searching player themself, blocked players, merged-away
// players, and anyone already on an active team (they can't be invited
// successfully anyway). Capped at 20 results.
export async function searchInvitablePlayers(actorId: string, query: string): Promise<PlayerSafeView[]> {
  const trimmed = query.trim();
  if (trimmed.length < 2) {
    return [];
  }

  const [allPlayers, activeMemberships] = await Promise.all([
    playerRepository.listOrderedByDisplayName(),
    db.select({ playerId: teamMemberships.playerId }).from(teamMemberships).where(isNull(teamMemberships.leftAt)),
  ]);

  const onActiveTeam = new Set(activeMemberships.map((row) => row.playerId));
  const needle = trimmed.toLowerCase();

  return allPlayers
    .filter((player) => player.id !== actorId)
    .filter((player) => !player.is_blocked)
    .filter((player) => !player.merged_into_player_id)
    .filter((player) => !onActiveTeam.has(player.id))
    .filter((player) => {
      const haystack = `${player.display_name} ${player.username ?? ""}`.toLowerCase();
      return haystack.includes(needle);
    })
    .slice(0, 20)
    .map(toPlayerSafeView);
}

// ---------------------------------------------------------------------
// Mutations -- every write below is one transaction, row-locking the team
// (and, where relevant, the player's own active-membership row) so
// concurrent requests against the SAME team/player serialize through
// Postgres's row locks. Uniqueness invariants (one active team per player,
// case-insensitive team name, one pending invite per team+player) are
// additionally enforced by real DB unique indexes -- the row locks make the
// common race harmless and give a clean domain error; the indexes are the
// actual, unconditional guarantee against corruption.
// ---------------------------------------------------------------------

const MAX_ACTIVE_MEMBERS = 5;

export async function createTeam(
  actorId: string,
  input: { name: string; emblem?: string }
): Promise<TeamDetailView> {
  const name = normalizeTeamName(input.name);
  const emblem = normalizeEmblem(input.emblem ?? DEFAULT_TEAM_EMBLEM);

  const teamId = await db.transaction(async (tx) => {
    const [existingActive] = await tx
      .select()
      .from(teamMemberships)
      .where(and(eq(teamMemberships.playerId, actorId), isNull(teamMemberships.leftAt)))
      .for("update");
    if (existingActive) {
      throw new AlreadyOnActiveTeamError();
    }

    const [existingName] = await tx
      .select()
      .from(teams)
      .where(sql`lower(${teams.name}) = lower(${name})`)
      .limit(1);
    if (existingName) {
      throw new TeamNameTakenError();
    }

    let created;
    try {
      [created] = await tx
        .insert(teams)
        .values({ name, emblem, captainPlayerId: actorId })
        .returning();
    } catch (error) {
      if (isUniqueViolation(error, "teams_name_lower")) {
        throw new TeamNameTakenError();
      }
      throw error;
    }

    try {
      await tx.insert(teamMemberships).values({ teamId: created.id, playerId: actorId });
    } catch (error) {
      if (isUniqueViolation(error, "team_memberships_one_active_per_player")) {
        throw new AlreadyOnActiveTeamError();
      }
      throw error;
    }

    return created.id;
  });

  const detail = await getTeamDetail(teamId, { kind: "current" });
  if (!detail) throw new TeamNotFoundError();
  return detail;
}

export async function updateTeamIdentity(
  actorId: string,
  teamId: string,
  patch: { name?: string; emblem?: string }
): Promise<TeamDetailView> {
  await db.transaction(async (tx) => {
    const [team] = await tx.select().from(teams).where(eq(teams.id, teamId)).for("update");
    if (!team) throw new TeamNotFoundError();
    if (team.status === "disbanded") throw new TeamDisbandedError();
    if (team.captainPlayerId !== actorId) throw new NotCaptainError();

    const nextName = patch.name !== undefined ? normalizeTeamName(patch.name) : undefined;
    const nextEmblem = patch.emblem !== undefined ? normalizeEmblem(patch.emblem) : undefined;

    if (nextName === undefined && nextEmblem === undefined) {
      return;
    }

    if (nextName !== undefined) {
      const [existingName] = await tx
        .select()
        .from(teams)
        .where(and(sql`lower(${teams.name}) = lower(${nextName})`, sql`${teams.id} != ${teamId}`))
        .limit(1);
      if (existingName) throw new TeamNameTakenError();
    }

    try {
      await tx
        .update(teams)
        .set({ ...(nextName !== undefined ? { name: nextName } : {}), ...(nextEmblem !== undefined ? { emblem: nextEmblem } : {}) })
        .where(eq(teams.id, teamId));
    } catch (error) {
      if (isUniqueViolation(error, "teams_name_lower")) {
        throw new TeamNameTakenError();
      }
      throw error;
    }
  });

  const detail = await getTeamDetail(teamId, { kind: "current" });
  if (!detail) throw new TeamNotFoundError();
  return detail;
}

// Captain-only. Reserves a seat the moment an invitation is sent (active
// members + pending invitations >= 5 is rejected up front) -- acceptance
// re-verifies capacity anyway, since a captain could send several
// invitations in a row before any is accepted.
export async function inviteToTeam(actorId: string, teamId: string, invitedPlayerId: string): Promise<void> {
  const invitee = await resolveEligiblePlayer(invitedPlayerId);

  await db.transaction(async (tx) => {
    const [team] = await tx.select().from(teams).where(eq(teams.id, teamId)).for("update");
    if (!team) throw new TeamNotFoundError();
    if (team.status === "disbanded") throw new TeamDisbandedError();
    if (team.captainPlayerId !== actorId) throw new NotCaptainError();

    const [inviteeActiveMembership] = await tx
      .select()
      .from(teamMemberships)
      .where(and(eq(teamMemberships.playerId, invitee.id), isNull(teamMemberships.leftAt)))
      .limit(1);
    if (inviteeActiveMembership) {
      throw new InviteTargetUnavailableError("Этот игрок уже состоит в другой команде");
    }

    const [existingPending] = await tx
      .select()
      .from(teamInvitations)
      .where(
        and(
          eq(teamInvitations.teamId, teamId),
          eq(teamInvitations.invitedPlayerId, invitee.id),
          eq(teamInvitations.status, "pending")
        )
      )
      .limit(1);
    if (existingPending) {
      throw new InviteTargetUnavailableError("Этому игроку уже отправлено приглашение от этой команды");
    }

    const [{ activeCount }] = await tx
      .select({ activeCount: sql<number>`count(*)::int` })
      .from(teamMemberships)
      .where(and(eq(teamMemberships.teamId, teamId), isNull(teamMemberships.leftAt)));
    const [{ pendingCount }] = await tx
      .select({ pendingCount: sql<number>`count(*)::int` })
      .from(teamInvitations)
      .where(and(eq(teamInvitations.teamId, teamId), eq(teamInvitations.status, "pending")));

    if (activeCount + pendingCount >= MAX_ACTIVE_MEMBERS) {
      throw new TeamFullError();
    }

    try {
      await tx.insert(teamInvitations).values({
        teamId,
        invitedPlayerId: invitee.id,
        invitedByPlayerId: actorId,
      });
    } catch (error) {
      if (isUniqueViolation(error, "team_invitations_one_pending")) {
        throw new InviteTargetUnavailableError("Этому игроку уже отправлено приглашение от этой команды");
      }
      throw error;
    }
  });
}

export async function cancelInvitation(actorId: string, invitationId: string): Promise<void> {
  await db.transaction(async (tx) => {
    const [invitation] = await tx
      .select()
      .from(teamInvitations)
      .where(eq(teamInvitations.id, invitationId))
      .for("update");
    if (!invitation) throw new InvitationNotFoundError();

    const [team] = await tx.select().from(teams).where(eq(teams.id, invitation.teamId)).limit(1);
    if (!team) throw new TeamNotFoundError();
    if (team.captainPlayerId !== actorId) throw new NotCaptainError();

    if (invitation.status !== "pending") {
      throw new InvitationNotPendingError();
    }

    await tx
      .update(teamInvitations)
      .set({ status: "cancelled", respondedAt: new Date() })
      .where(eq(teamInvitations.id, invitationId));
  });
}

// The invited player's own action. Full transactional capacity/uniqueness
// re-check under lock -- see the "CAPACITY / CONCURRENCY" contract this
// mirrors exactly: lock the team, recheck active/pending, recheck the
// invitation is still pending, recheck the player still has no active
// team, recheck capacity < 5, THEN create the membership, mark this
// invitation accepted, and cancel every OTHER pending invitation for this
// player (atomically, same transaction).
export async function acceptInvitation(actorId: string, invitationId: string): Promise<TeamDetailView> {
  const teamId = await db.transaction(async (tx) => {
    const [invitation] = await tx
      .select()
      .from(teamInvitations)
      .where(eq(teamInvitations.id, invitationId))
      .for("update");
    if (!invitation) throw new InvitationNotFoundError();
    if (invitation.invitedPlayerId !== actorId) throw new InvitationForbiddenError();
    if (invitation.status !== "pending") throw new InvitationNotPendingError();

    const [team] = await tx.select().from(teams).where(eq(teams.id, invitation.teamId)).for("update");
    if (!team) throw new TeamNotFoundError();
    if (team.status === "disbanded") throw new TeamDisbandedError();

    const [existingActive] = await tx
      .select()
      .from(teamMemberships)
      .where(and(eq(teamMemberships.playerId, actorId), isNull(teamMemberships.leftAt)))
      .for("update");
    if (existingActive) throw new AlreadyOnActiveTeamError();

    const [{ activeCount }] = await tx
      .select({ activeCount: sql<number>`count(*)::int` })
      .from(teamMemberships)
      .where(and(eq(teamMemberships.teamId, team.id), isNull(teamMemberships.leftAt)));
    if (activeCount >= MAX_ACTIVE_MEMBERS) {
      throw new TeamFullError();
    }

    try {
      await tx.insert(teamMemberships).values({ teamId: team.id, playerId: actorId });
    } catch (error) {
      if (isUniqueViolation(error, "team_memberships_one_active_per_player")) {
        throw new AlreadyOnActiveTeamError();
      }
      throw error;
    }

    const now = new Date();
    await tx
      .update(teamInvitations)
      .set({ status: "accepted", respondedAt: now })
      .where(eq(teamInvitations.id, invitationId));

    // Every OTHER pending invitation this player was holding is cancelled
    // atomically, in the same transaction -- a player may be invited by
    // several teams at once, but accepting one always resolves them all.
    await tx
      .update(teamInvitations)
      .set({ status: "cancelled", respondedAt: now })
      .where(
        and(
          eq(teamInvitations.invitedPlayerId, actorId),
          eq(teamInvitations.status, "pending"),
          sql`${teamInvitations.id} != ${invitationId}`
        )
      );

    return team.id;
  });

  const detail = await getTeamDetail(teamId, { kind: "current" });
  if (!detail) throw new TeamNotFoundError();
  return detail;
}

export async function declineInvitation(actorId: string, invitationId: string): Promise<void> {
  await db.transaction(async (tx) => {
    const [invitation] = await tx
      .select()
      .from(teamInvitations)
      .where(eq(teamInvitations.id, invitationId))
      .for("update");
    if (!invitation) throw new InvitationNotFoundError();
    if (invitation.invitedPlayerId !== actorId) throw new InvitationForbiddenError();
    if (invitation.status !== "pending") throw new InvitationNotPendingError();

    await tx
      .update(teamInvitations)
      .set({ status: "declined", respondedAt: new Date() })
      .where(eq(teamInvitations.id, invitationId));
  });
}

// Non-captain member leaving freely. Closing left_at is the ONLY mutation
// -- the row is never deleted, and every tournament this player already
// played for this team stays attributed to it (see lib/team-scoring.ts).
export async function leaveTeam(actorId: string, teamId: string): Promise<void> {
  await db.transaction(async (tx) => {
    const [team] = await tx.select().from(teams).where(eq(teams.id, teamId)).for("update");
    if (!team) throw new TeamNotFoundError();
    if (team.status === "disbanded") throw new TeamDisbandedError();

    if (team.captainPlayerId === actorId) {
      throw new CaptainCannotLeaveError();
    }

    const [membership] = await tx
      .select()
      .from(teamMemberships)
      .where(and(eq(teamMemberships.teamId, teamId), eq(teamMemberships.playerId, actorId), isNull(teamMemberships.leftAt)))
      .for("update");
    if (!membership) throw new NotActiveTeamMemberError();

    await tx.update(teamMemberships).set({ leftAt: new Date() }).where(eq(teamMemberships.id, membership.id));
  });
}

// Captain kicking another active member. The captain can never target
// themself this way (CaptainCannotBeRemovedError) -- they must transfer
// captaincy or disband instead, exactly like leaveTeam's own rule.
export async function removeMember(actorId: string, teamId: string, targetPlayerId: string): Promise<void> {
  await db.transaction(async (tx) => {
    const [team] = await tx.select().from(teams).where(eq(teams.id, teamId)).for("update");
    if (!team) throw new TeamNotFoundError();
    if (team.status === "disbanded") throw new TeamDisbandedError();
    if (team.captainPlayerId !== actorId) throw new NotCaptainError();

    if (targetPlayerId === team.captainPlayerId) {
      throw new CaptainCannotBeRemovedError();
    }

    const [membership] = await tx
      .select()
      .from(teamMemberships)
      .where(
        and(
          eq(teamMemberships.teamId, teamId),
          eq(teamMemberships.playerId, targetPlayerId),
          isNull(teamMemberships.leftAt)
        )
      )
      .for("update");
    if (!membership) throw new NotActiveTeamMemberError();

    await tx.update(teamMemberships).set({ leftAt: new Date() }).where(eq(teamMemberships.id, membership.id));
  });
}

export async function transferCaptain(actorId: string, teamId: string, newCaptainPlayerId: string): Promise<void> {
  await db.transaction(async (tx) => {
    const [team] = await tx.select().from(teams).where(eq(teams.id, teamId)).for("update");
    if (!team) throw new TeamNotFoundError();
    if (team.status === "disbanded") throw new TeamDisbandedError();
    if (team.captainPlayerId !== actorId) throw new NotCaptainError();

    if (newCaptainPlayerId === actorId) {
      // A no-op transfer to yourself is meaningless but harmless -- reject
      // it explicitly rather than silently "succeeding" at nothing.
      throw new NotActiveTeamMemberError();
    }

    const [targetMembership] = await tx
      .select()
      .from(teamMemberships)
      .where(
        and(
          eq(teamMemberships.teamId, teamId),
          eq(teamMemberships.playerId, newCaptainPlayerId),
          isNull(teamMemberships.leftAt)
        )
      )
      .limit(1);
    if (!targetMembership) throw new NotActiveTeamMemberError();

    await tx.update(teams).set({ captainPlayerId: newCaptainPlayerId }).where(eq(teams.id, teamId));
  });
}

// Captain-only, one transaction: disband + close every active membership +
// cancel every pending invitation, all at the SAME timestamp. Never
// deletes the team, its memberships, or its invitations -- a disbanded
// team is read-only forever after, and its historical standings stay
// reproducible via lib/team-scoring.ts exactly as before.
export async function disbandTeam(actorId: string, teamId: string): Promise<void> {
  await db.transaction(async (tx) => {
    const [team] = await tx.select().from(teams).where(eq(teams.id, teamId)).for("update");
    if (!team) throw new TeamNotFoundError();
    if (team.status === "disbanded") throw new TeamDisbandedError();
    if (team.captainPlayerId !== actorId) throw new NotCaptainError();

    const now = new Date();

    await tx.update(teams).set({ status: "disbanded", disbandedAt: now }).where(eq(teams.id, teamId));

    await tx
      .update(teamMemberships)
      .set({ leftAt: now })
      .where(and(eq(teamMemberships.teamId, teamId), isNull(teamMemberships.leftAt)));

    await tx
      .update(teamInvitations)
      .set({ status: "cancelled", respondedAt: now })
      .where(and(eq(teamInvitations.teamId, teamId), eq(teamInvitations.status, "pending")));
  });
}
