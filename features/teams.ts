import "server-only";

import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { teams, teamMemberships, teamInvitations, teamJoinRequests } from "@/lib/db/schema";
import { extractPostgresError } from "@/lib/db/postgres-error";
import {
  playerRepository,
  resultRepository,
  seasonRepository,
  avatarStorageRepository,
  contentTypeToExtension,
} from "@/lib/repositories";
import { resolveCanonicalPlayer } from "@/lib/canonical-player";
import { isTeamEmblem, DEFAULT_TEAM_EMBLEM, type TeamEmblem } from "@/config/team-emblems";
import { sendTeamsTelegramNotification } from "@/lib/telegram-bot-notify";
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

export class JoinRequestNotFoundError extends Error {
  constructor() {
    super("Заявка не найдена");
    this.name = "JoinRequestNotFoundError";
  }
}

export class JoinRequestNotPendingError extends Error {
  constructor() {
    super("Эта заявка уже обработана");
    this.name = "JoinRequestNotPendingError";
  }
}

export class JoinRequestForbiddenError extends Error {
  constructor() {
    super("Эта заявка подана другим игроком");
    this.name = "JoinRequestForbiddenError";
  }
}

export class AlreadyRequestedError extends Error {
  constructor() {
    super("Вы уже подали заявку в эту команду");
    this.name = "AlreadyRequestedError";
  }
}

// team_invitations = captain -> player; team_join_requests = player ->
// captain -- deliberately never overloaded onto one table (see
// lib/db/schema/teams.ts's teamJoinRequests doc comment). If the player
// already holds a pending INVITATION from this exact team, a join request
// would be a redundant, confusing second channel to the same outcome --
// this error steers them back to the invitation flow instead.
export class AlreadyInvitedByTeamError extends Error {
  constructor() {
    super("Эта команда уже пригласила вас — примите приглашение");
    this.name = "AlreadyInvitedByTeamError";
  }
}

// Reuses NotCaptainError/TeamDisbandedError/TeamNotFoundError for the
// "not authorized"/"not active"/"missing" cases of avatar upload (same
// error, same HTTP mapping, no reason to duplicate). This one covers the
// upload-specific validation failures that have no existing equivalent.
export class InvalidTeamAvatarFileError extends Error {
  constructor(message = "Можно загрузить только изображение (JPEG, PNG или WebP) размером до 15 МБ") {
    super(message);
    this.name = "InvalidTeamAvatarFileError";
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
  avatar_url: string | null;
  status: "active" | "disbanded";
  points: number;
  // null = no OFFICIAL displayed rank -- a team only ever consumes a
  // ranking position once it has > 0 points in the selected scope (see
  // getTeamLeaderboard below). A zero-point team is still listed (never
  // hidden), just never shown as "#1".
  rank: number | null;
  member_count: number;
  // Up to 5 CURRENT active members, captain first -- just enough for the
  // squad-card's 5-slot avatar row (Teams v1 UI polish). Same player-safe
  // shape and same avatar-resolution helpers as everywhere else; no new
  // avatar logic.
  roster_preview: TeamRosterMember[];
};

export type TeamDetailView = {
  id: string;
  name: string;
  emblem: string;
  avatar_url: string | null;
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
  team_avatar_url: string | null;
  invited_by: PlayerSafeView;
  created_at: string;
};

export type OutgoingJoinRequestView = {
  request_id: string;
  team_id: string;
  team_name: string;
  team_emblem: string;
  team_avatar_url: string | null;
  created_at: string;
};

export type IncomingJoinRequestView = {
  request_id: string;
  team_id: string;
  applicant: PlayerSafeView;
  created_at: string;
};

export type MyTeamState = {
  team: TeamDetailView | null;
  pending_invitations: PendingInvitationView[];
  // This player's own outgoing requests to join OTHER teams -- always
  // empty once they belong to a team (accepting anything cancels the rest,
  // see acceptInvitation/acceptJoinRequest).
  pending_outgoing_join_requests: OutgoingJoinRequestView[];
  // Incoming requests TO the player's own team -- only ever populated when
  // is_captain is true; a plain member never sees another applicant's
  // request here.
  pending_incoming_join_requests: IncomingJoinRequestView[];
  // True only when the caller is the current team's captain -- drives which
  // management controls the client renders. Meaningless (false) if team is
  // null.
  is_captain: boolean;
};

// Public /teams/[id]'s per-VIEWER request/invite CTA state -- deliberately
// separate from the team's own public TeamDetailView (which has no
// per-viewer fields and stays the same for everyone, including anonymous
// visitors). Only ever requested for the currently authenticated caller,
// never for an arbitrary playerId.
export type TeamViewerState = {
  is_member: boolean;
  is_captain: boolean;
  has_other_active_team: boolean;
  pending_request_id: string | null;
  pending_invitation_id: string | null;
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

// Defense in depth on top of lib/telegram-bot-notify.ts's own internal
// try/catch: every call site below fires this AFTER its transaction has
// already committed, and a Telegram failure must NEVER surface as a
// failure of the mutation that already succeeded -- even if the notifier
// module itself somehow threw (a bug there, a mocked-out throw in a test,
// etc.), the outer create/accept/invite call must still resolve normally.
async function notifyBestEffort(send: () => Promise<unknown>): Promise<void> {
  try {
    await send();
  } catch (error) {
    console.warn("[teams] notification call threw unexpectedly (non-fatal):", error instanceof Error ? error.message : error);
  }
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
  const [allTeams, { totals }, activeMemberships] = await Promise.all([
    db.select().from(teams),
    computeAllTeamTotals(scope),
    db.select().from(teamMemberships).where(isNull(teamMemberships.leftAt)),
  ]);

  const memberCountByTeam = new Map<string, number>();
  const membershipsByTeam = new Map<string, MembershipRow[]>();
  for (const membership of activeMemberships) {
    memberCountByTeam.set(membership.teamId, (memberCountByTeam.get(membership.teamId) ?? 0) + 1);
    const list = membershipsByTeam.get(membership.teamId);
    if (list) list.push(membership);
    else membershipsByTeam.set(membership.teamId, [membership]);
  }

  const playerRows = await playerRepository.findByIds(activeMemberships.map((m) => m.playerId));
  const playerById = new Map(playerRows.map((p) => [p.id, p]));

  function rosterPreviewFor(team: TeamRow): TeamRosterMember[] {
    const members = membershipsByTeam.get(team.id) ?? [];
    return members
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
      .sort((a, b) => (a.is_captain === b.is_captain ? 0 : a.is_captain ? -1 : 1))
      .slice(0, MAX_ACTIVE_MEMBERS);
  }

  const visible = allTeams.filter((team) => {
    if (team.status === "active") return true;
    return (totals.get(team.id) ?? 0) > 0;
  });

  const withPoints = visible
    .map((team) => ({
      team_id: team.id,
      name: team.name,
      emblem: team.emblem,
      avatar_url: team.avatarUrl ?? null,
      status: team.status as "active" | "disbanded",
      points: totals.get(team.id) ?? 0,
      member_count: memberCountByTeam.get(team.id) ?? 0,
      roster_preview: rosterPreviewFor(team),
    }))
    // Stable presentation order within a tie: team name. The rank number
    // rankByPointsDescending assigns only ever depends on `points`, so this
    // secondary key can never change who shares a rank.
    .sort((a, b) => a.name.localeCompare(b.name, "ru"));

  // Only teams with a POSITIVE score consume an official ranking position
  // -- a freshly created team with 0 points is listed (never hidden) but
  // never displayed as "#1". Competition ranking (1, 1, 3) applies within
  // the positive-score group exactly as before; it simply never runs over
  // the zero-point tail.
  const rankByTeamId = new Map(
    rankByPointsDescending(withPoints.filter((row) => row.points > 0)).map((row) => [row.team_id, row.rank])
  );

  // Display order: points descending, `withPoints`'s stable name-sort above
  // breaking ties -- this is what makes the actual RETURNED array order
  // (not just the rank numbers) put zero-point teams at the bottom and
  // equal-score teams in a stable, deterministic order.
  const ordered = [...withPoints].sort((a, b) => b.points - a.points);

  return ordered.map((row) => ({
    team_id: row.team_id,
    name: row.name,
    emblem: row.emblem,
    avatar_url: row.avatar_url,
    status: row.status,
    points: row.points,
    rank: rankByTeamId.get(row.team_id) ?? null,
    member_count: row.member_count,
    roster_preview: row.roster_preview,
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
    avatar_url: team.avatarUrl ?? null,
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

export type PlayerTeamBadge = { team_id: string; name: string; emblem: string; avatar_url: string | null; rank: number | null };

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

  return { team_id: team.id, name: team.name, emblem: team.emblem, avatar_url: team.avatarUrl ?? null, rank: standing?.rank ?? null };
}

// "Моя команда" -- the caller's own team (if any), every pending
// invitation addressed to them, their own outgoing join requests, and (if
// they are a captain) incoming requests to their team -- all visible even
// with no team at all. Every list below is ONE bulk query plus ONE bulk
// team/player hydration, never a per-row lookup.
export async function getMyTeamState(actorId: string): Promise<MyTeamState> {
  const [activeMembership, pendingInvitationRows, outgoingRequestRows] = await Promise.all([
    db
      .select()
      .from(teamMemberships)
      .where(and(eq(teamMemberships.playerId, actorId), isNull(teamMemberships.leftAt)))
      .limit(1),
    db
      .select()
      .from(teamInvitations)
      .where(and(eq(teamInvitations.invitedPlayerId, actorId), eq(teamInvitations.status, "pending"))),
    db
      .select()
      .from(teamJoinRequests)
      .where(and(eq(teamJoinRequests.playerId, actorId), eq(teamJoinRequests.status, "pending"))),
  ]);

  let team: TeamDetailView | null = null;
  let isCaptain = false;
  let incomingRequestRows: (typeof teamJoinRequests.$inferSelect)[] = [];

  if (activeMembership[0]) {
    const [teamRow] = await db.select().from(teams).where(eq(teams.id, activeMembership[0].teamId)).limit(1);
    if (teamRow) {
      team = await buildTeamDetailView(teamRow, { kind: "current" });
      isCaptain = teamRow.captainPlayerId === actorId;
      if (isCaptain) {
        incomingRequestRows = await db
          .select()
          .from(teamJoinRequests)
          .where(and(eq(teamJoinRequests.teamId, teamRow.id), eq(teamJoinRequests.status, "pending")));
      }
    }
  }

  // One bulk hydration covering every team/player id referenced by ANY of
  // the three lists above.
  const teamIds = Array.from(
    new Set([...pendingInvitationRows.map((r) => r.teamId), ...outgoingRequestRows.map((r) => r.teamId)])
  );
  const playerIds = Array.from(
    new Set([...pendingInvitationRows.map((r) => r.invitedByPlayerId), ...incomingRequestRows.map((r) => r.playerId)])
  );
  const [teamRows, playerRows] = await Promise.all([
    teamIds.length > 0 ? db.select().from(teams).where(inArray(teams.id, teamIds)) : Promise.resolve([]),
    playerRepository.findByIds(playerIds),
  ]);
  const teamById = new Map(teamRows.map((t) => [t.id, t]));
  const playerById = new Map(playerRows.map((p) => [p.id, p]));

  const pendingInvitations: PendingInvitationView[] = pendingInvitationRows
    .map((row) => {
      const inviteTeam = teamById.get(row.teamId);
      const inviter = playerById.get(row.invitedByPlayerId);
      if (!inviteTeam || !inviter) return null;
      return {
        invitation_id: row.id,
        team_id: inviteTeam.id,
        team_name: inviteTeam.name,
        team_emblem: inviteTeam.emblem,
        team_avatar_url: inviteTeam.avatarUrl ?? null,
        invited_by: toPlayerSafeView(inviter),
        created_at: row.createdAt.toISOString(),
      };
    })
    .filter((row): row is PendingInvitationView => row !== null);

  const pendingOutgoingJoinRequests: OutgoingJoinRequestView[] = outgoingRequestRows
    .map((row) => {
      const requestTeam = teamById.get(row.teamId);
      if (!requestTeam) return null;
      return {
        request_id: row.id,
        team_id: requestTeam.id,
        team_name: requestTeam.name,
        team_emblem: requestTeam.emblem,
        team_avatar_url: requestTeam.avatarUrl ?? null,
        created_at: row.createdAt.toISOString(),
      };
    })
    .filter((row): row is OutgoingJoinRequestView => row !== null);

  const pendingIncomingJoinRequests: IncomingJoinRequestView[] = incomingRequestRows
    .map((row) => {
      const applicant = playerById.get(row.playerId);
      if (!applicant) return null;
      return {
        request_id: row.id,
        team_id: row.teamId,
        applicant: toPlayerSafeView(applicant),
        created_at: row.createdAt.toISOString(),
      };
    })
    .filter((row): row is IncomingJoinRequestView => row !== null);

  return {
    team,
    pending_invitations: pendingInvitations,
    pending_outgoing_join_requests: pendingOutgoingJoinRequests,
    pending_incoming_join_requests: pendingIncomingJoinRequests,
    is_captain: isCaptain,
  };
}

// Public /teams/[id]'s per-viewer CTA state -- see TeamViewerState's doc
// comment. Plain reads only (no lock): the actual mutation (requestToJoinTeam)
// re-validates everything itself under a real transaction, so this never
// needs to be more than "what should the button say right now".
export async function getTeamViewerState(teamId: string, actorId: string): Promise<TeamViewerState> {
  const [team] = await db.select().from(teams).where(eq(teams.id, teamId)).limit(1);
  if (!team) throw new TeamNotFoundError();

  const [activeMembershipRows, pendingRequestRows, pendingInvitationRows] = await Promise.all([
    db
      .select()
      .from(teamMemberships)
      .where(and(eq(teamMemberships.playerId, actorId), isNull(teamMemberships.leftAt)))
      .limit(1),
    db
      .select()
      .from(teamJoinRequests)
      .where(and(eq(teamJoinRequests.teamId, teamId), eq(teamJoinRequests.playerId, actorId), eq(teamJoinRequests.status, "pending")))
      .limit(1),
    db
      .select()
      .from(teamInvitations)
      .where(and(eq(teamInvitations.teamId, teamId), eq(teamInvitations.invitedPlayerId, actorId), eq(teamInvitations.status, "pending")))
      .limit(1),
  ]);

  const activeMembership = activeMembershipRows[0] ?? null;
  const isMember = activeMembership?.teamId === teamId;

  return {
    is_member: isMember,
    is_captain: isMember && team.captainPlayerId === actorId,
    has_other_active_team: Boolean(activeMembership) && !isMember,
    pending_request_id: pendingRequestRows[0]?.id ?? null,
    pending_invitation_id: pendingInvitationRows[0]?.id ?? null,
  };
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

// Captain-only. Pending invitations do NOT reserve a seat -- only CURRENT
// ACTIVE members count against MAX_ACTIVE_MEMBERS, so a captain may hold
// far more pending invitations than free slots (first acceptance wins the
// last seat; acceptInvitation re-verifies capacity under lock at that
// point, and cancels any other now-unfillable pending invitations/requests
// once the team reaches 5/5).
export async function inviteToTeam(actorId: string, teamId: string, invitedPlayerId: string): Promise<void> {
  const invitee = await resolveEligiblePlayer(invitedPlayerId);

  const teamName = await db.transaction(async (tx) => {
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

    if (activeCount >= MAX_ACTIVE_MEMBERS) {
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

    return team.name;
  });

  // Best-effort ONLY, fired after the transaction above has already
  // committed -- see lib/telegram-bot-notify.ts's doc comment. A Telegram
  // failure here can never roll back or invalidate the invitation that
  // already succeeded.
  if (invitee.telegram_id) {
    await notifyBestEffort(() =>
      sendTeamsTelegramNotification({
        telegramId: invitee.telegram_id!,
        text: `👥 Вас пригласили в команду «${teamName}» в RERAISE.\n\nОткройте приложение, чтобы принять или отклонить приглашение.`,
        buttonText: "Открыть приглашение",
        path: "/teams?tab=my-team",
      })
    );
  }
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
// re-check under lock: lock the team, recheck the invitation is still
// pending, recheck the player still has no active team, recheck ACTIVE
// member count < 5 (pending invitations never count here -- see
// inviteToTeam's doc comment), THEN create the membership, mark this
// invitation accepted, cancel every OTHER pending invitation for this
// player (atomically, same transaction), and -- if this acceptance just
// filled the team to 5/5 -- cancel every OTHER pending invitation AND
// pending join request still targeting THIS team, since it can no longer
// honor them.
//
// LOCK ORDER: the team row is locked BEFORE the invitation row, not after.
// This is required now that a full team's 5/5 sweep cancels OTHER pending
// invitations/requests for that team from inside the transaction that
// holds the team lock: if two concurrent acceptances for the SAME team
// each locked their own invitation/request row first and only then waited
// on the team lock, the one that wins the team lock could deadlock trying
// to UPDATE (i.e. implicitly lock) the other's still-row-locked invitation/
// request during its sweep, while that other transaction sits blocked
// waiting for the team lock it will never get. Locking the team FIRST
// means no transaction can be holding a competing invitation/request row
// lock while blocked on the team lock, so the sweep can never deadlock.
// acceptJoinRequest below follows the exact same team-first ordering, so
// one invitation acceptance racing one join-request acceptance for the
// same team's last seat is equally safe.
export async function acceptInvitation(actorId: string, invitationId: string): Promise<TeamDetailView> {
  const { teamId, captainPlayerId, teamName } = await db.transaction(async (tx) => {
    // Non-locking lookup ONLY to discover which team this invitation
    // targets. Its status/ownership is never trusted here -- the row is
    // re-read FOR UPDATE immediately after the team lock and every check
    // below runs against that fresh, locked read.
    const [invitationPreview] = await tx
      .select()
      .from(teamInvitations)
      .where(eq(teamInvitations.id, invitationId))
      .limit(1);
    if (!invitationPreview) throw new InvitationNotFoundError();

    const [team] = await tx.select().from(teams).where(eq(teams.id, invitationPreview.teamId)).for("update");
    if (!team) throw new TeamNotFoundError();
    if (team.status === "disbanded") throw new TeamDisbandedError();

    const [invitation] = await tx
      .select()
      .from(teamInvitations)
      .where(eq(teamInvitations.id, invitationId))
      .for("update");
    if (!invitation) throw new InvitationNotFoundError();
    if (invitation.invitedPlayerId !== actorId) throw new InvitationForbiddenError();
    if (invitation.status !== "pending") throw new InvitationNotPendingError();

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

    // If this acceptance just filled the team to 5/5, no other pending
    // invitation or join request targeting THIS team can ever be honored
    // -- auto-cancel them rather than leave them pending forever.
    if (activeCount + 1 >= MAX_ACTIVE_MEMBERS) {
      await tx
        .update(teamInvitations)
        .set({ status: "cancelled", respondedAt: now })
        .where(
          and(
            eq(teamInvitations.teamId, team.id),
            eq(teamInvitations.status, "pending"),
            sql`${teamInvitations.id} != ${invitationId}`
          )
        );
      await tx
        .update(teamJoinRequests)
        .set({ status: "cancelled", respondedAt: now })
        .where(and(eq(teamJoinRequests.teamId, team.id), eq(teamJoinRequests.status, "pending")));
    }

    return { teamId: team.id, captainPlayerId: team.captainPlayerId, teamName: team.name };
  });

  const detail = await getTeamDetail(teamId, { kind: "current" });
  if (!detail) throw new TeamNotFoundError();

  // Best-effort ONLY, after commit -- notify the captain their invitation
  // was accepted. See lib/telegram-bot-notify.ts's doc comment.
  const [accepter, captain] = await Promise.all([
    playerRepository.findById(actorId),
    playerRepository.findById(captainPlayerId),
  ]);
  if (accepter && captain?.telegram_id) {
    await notifyBestEffort(() =>
      sendTeamsTelegramNotification({
        telegramId: captain.telegram_id!,
        text: `✅ ${accepter.display_name} принял приглашение и вступил в «${teamName}».`,
        buttonText: "Открыть команду",
        path: "/teams?tab=my-team",
      })
    );
  }

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

// ---------------------------------------------------------------------
// Join requests (player -> captain) -- the mirror direction of the
// invitations above. See lib/db/schema/teams.ts's teamJoinRequests doc
// comment for why this is a separate table/flow rather than an overload of
// team_invitations. Same "one transaction, row-lock the team, DB unique
// index as the final backstop" discipline as every mutation above.
// ---------------------------------------------------------------------

// The player's own action. Join requests, like invitations, do NOT reserve
// a seat -- eligibility only checks the team's CURRENT active member
// count, never pending invitations or other pending requests. Capacity is
// re-checked again at acceptJoinRequest time under lock, since it can
// change between now and then.
export async function requestToJoinTeam(actorId: string, teamId: string): Promise<void> {
  const teamName = await db.transaction(async (tx) => {
    const [team] = await tx.select().from(teams).where(eq(teams.id, teamId)).for("update");
    if (!team) throw new TeamNotFoundError();
    if (team.status === "disbanded") throw new TeamDisbandedError();

    const [existingActive] = await tx
      .select()
      .from(teamMemberships)
      .where(and(eq(teamMemberships.playerId, actorId), isNull(teamMemberships.leftAt)))
      .limit(1);
    if (existingActive) throw new AlreadyOnActiveTeamError();

    // Already invited by this exact team -- steer back to the invitation
    // flow instead of creating a redundant second channel to the same
    // outcome.
    const [existingInvitation] = await tx
      .select()
      .from(teamInvitations)
      .where(
        and(
          eq(teamInvitations.teamId, teamId),
          eq(teamInvitations.invitedPlayerId, actorId),
          eq(teamInvitations.status, "pending")
        )
      )
      .limit(1);
    if (existingInvitation) throw new AlreadyInvitedByTeamError();

    const [existingRequest] = await tx
      .select()
      .from(teamJoinRequests)
      .where(
        and(
          eq(teamJoinRequests.teamId, teamId),
          eq(teamJoinRequests.playerId, actorId),
          eq(teamJoinRequests.status, "pending")
        )
      )
      .limit(1);
    if (existingRequest) throw new AlreadyRequestedError();

    const [{ activeCount }] = await tx
      .select({ activeCount: sql<number>`count(*)::int` })
      .from(teamMemberships)
      .where(and(eq(teamMemberships.teamId, teamId), isNull(teamMemberships.leftAt)));
    if (activeCount >= MAX_ACTIVE_MEMBERS) throw new TeamFullError();

    try {
      await tx.insert(teamJoinRequests).values({ teamId, playerId: actorId });
    } catch (error) {
      if (isUniqueViolation(error, "team_join_requests_one_pending")) {
        throw new AlreadyRequestedError();
      }
      throw error;
    }

    return team.name;
  });

  // Best-effort ONLY, after commit -- notify the captain of the new
  // applicant.
  const [applicant, team] = await Promise.all([
    playerRepository.findById(actorId),
    db.select().from(teams).where(eq(teams.id, teamId)).limit(1).then((rows) => rows[0] ?? null),
  ]);
  if (applicant && team) {
    const captain = await playerRepository.findById(team.captainPlayerId);
    if (captain?.telegram_id) {
      await notifyBestEffort(() =>
        sendTeamsTelegramNotification({
          telegramId: captain.telegram_id!,
          text: `👥 ${applicant.display_name} хочет вступить в команду «${teamName}».\n\nОткройте RERAISE, чтобы принять или отклонить заявку.`,
          buttonText: "Открыть заявки",
          path: "/teams?tab=my-team",
        })
      );
    }
  }
}

export async function cancelJoinRequest(actorId: string, requestId: string): Promise<void> {
  await db.transaction(async (tx) => {
    const [request] = await tx
      .select()
      .from(teamJoinRequests)
      .where(eq(teamJoinRequests.id, requestId))
      .for("update");
    if (!request) throw new JoinRequestNotFoundError();
    if (request.playerId !== actorId) throw new JoinRequestForbiddenError();
    if (request.status !== "pending") throw new JoinRequestNotPendingError();

    await tx
      .update(teamJoinRequests)
      .set({ status: "cancelled", respondedAt: new Date() })
      .where(eq(teamJoinRequests.id, requestId));
  });
}

export async function declineJoinRequest(actorId: string, requestId: string): Promise<void> {
  await db.transaction(async (tx) => {
    const [request] = await tx
      .select()
      .from(teamJoinRequests)
      .where(eq(teamJoinRequests.id, requestId))
      .for("update");
    if (!request) throw new JoinRequestNotFoundError();

    const [team] = await tx.select().from(teams).where(eq(teams.id, request.teamId)).limit(1);
    if (!team) throw new TeamNotFoundError();
    if (team.captainPlayerId !== actorId) throw new NotCaptainError();
    if (request.status !== "pending") throw new JoinRequestNotPendingError();

    await tx
      .update(teamJoinRequests)
      .set({ status: "declined", respondedAt: new Date() })
      .where(eq(teamJoinRequests.id, requestId));
  });
}

// Captain-only. Full transactional re-check under lock -- request still
// pending, team still active, actor still captain, requesting player still
// canonical/not-blocked/teamless, and (the CAPACITY RULE) ONLY active
// members count against MAX_ACTIVE_MEMBERS -- pending invitations never
// reserve seats, so a team with e.g. 3 active + 20 pending invitations
// still freely accepts a join request. On success: create the membership,
// mark this request accepted, cancel every OTHER pending join request AND
// every pending invitation for that player (any team), and -- if this
// acceptance just filled the team to 5/5 -- auto-cancel every other
// pending join request AND every pending invitation still targeting this
// same team, since it can no longer accept them. Never deletes a
// historical row.
//
// LOCK ORDER: the team row is locked BEFORE the join-request row -- see
// acceptInvitation's matching "LOCK ORDER" doc comment for why (the 5/5
// sweep cancelling other pending rows for this team can otherwise deadlock
// against a concurrent acceptance that locked its own row first). Both
// accept flows lock team-then-own-row, so a same-team invitation
// acceptance racing a join-request acceptance for the last seat is equally
// deadlock-safe.
export async function acceptJoinRequest(actorId: string, requestId: string): Promise<TeamDetailView> {
  // Non-locking lookup ONLY to discover the applicant's canonical identity
  // and which team this request targets -- its status/ownership is never
  // trusted here, the row is re-read FOR UPDATE inside the transaction
  // (after the team lock) and every check below runs against that fresh,
  // locked read.
  const requestPreview = await (async () => {
    const [request] = await db.select().from(teamJoinRequests).where(eq(teamJoinRequests.id, requestId)).limit(1);
    if (!request) throw new JoinRequestNotFoundError();
    return request;
  })();
  const canonicalApplicant = await resolveEligiblePlayer(requestPreview.playerId);

  const { teamId, teamName } = await db.transaction(async (tx) => {
    const [team] = await tx.select().from(teams).where(eq(teams.id, requestPreview.teamId)).for("update");
    if (!team) throw new TeamNotFoundError();
    if (team.status === "disbanded") throw new TeamDisbandedError();
    if (team.captainPlayerId !== actorId) throw new NotCaptainError();

    const [request] = await tx
      .select()
      .from(teamJoinRequests)
      .where(eq(teamJoinRequests.id, requestId))
      .for("update");
    if (!request) throw new JoinRequestNotFoundError();
    if (request.status !== "pending") throw new JoinRequestNotPendingError();

    const [existingActive] = await tx
      .select()
      .from(teamMemberships)
      .where(and(eq(teamMemberships.playerId, canonicalApplicant.id), isNull(teamMemberships.leftAt)))
      .for("update");
    if (existingActive) throw new AlreadyOnActiveTeamError();

    // Capacity rule: ONLY active members count -- pending invitations never
    // reserve seats.
    const [{ activeCount }] = await tx
      .select({ activeCount: sql<number>`count(*)::int` })
      .from(teamMemberships)
      .where(and(eq(teamMemberships.teamId, team.id), isNull(teamMemberships.leftAt)));
    if (activeCount >= MAX_ACTIVE_MEMBERS) {
      throw new TeamFullError();
    }

    try {
      await tx.insert(teamMemberships).values({ teamId: team.id, playerId: canonicalApplicant.id });
    } catch (error) {
      if (isUniqueViolation(error, "team_memberships_one_active_per_player")) {
        throw new AlreadyOnActiveTeamError();
      }
      throw error;
    }

    const now = new Date();
    await tx
      .update(teamJoinRequests)
      .set({ status: "accepted", respondedAt: now })
      .where(eq(teamJoinRequests.id, requestId));

    // Every OTHER pending join request this player had open (any team) is
    // cancelled atomically -- accepting one always resolves the rest.
    await tx
      .update(teamJoinRequests)
      .set({ status: "cancelled", respondedAt: now })
      .where(
        and(
          eq(teamJoinRequests.playerId, canonicalApplicant.id),
          eq(teamJoinRequests.status, "pending"),
          sql`${teamJoinRequests.id} != ${requestId}`
        )
      );

    // Every pending INVITATION this player was holding (any team) is
    // cancelled too -- they just joined a team, so no other captain's
    // invitation can still be accepted.
    await tx
      .update(teamInvitations)
      .set({ status: "cancelled", respondedAt: now })
      .where(and(eq(teamInvitations.invitedPlayerId, canonicalApplicant.id), eq(teamInvitations.status, "pending")));

    // If this acceptance just filled the team to 5/5, any OTHER pending
    // request AND any pending invitation still targeting this same team
    // can no longer be honored -- auto-cancel them rather than leave them
    // pending forever against a team that structurally cannot accept them.
    if (activeCount + 1 >= MAX_ACTIVE_MEMBERS) {
      await tx
        .update(teamJoinRequests)
        .set({ status: "cancelled", respondedAt: now })
        .where(and(eq(teamJoinRequests.teamId, team.id), eq(teamJoinRequests.status, "pending")));
      await tx
        .update(teamInvitations)
        .set({ status: "cancelled", respondedAt: now })
        .where(and(eq(teamInvitations.teamId, team.id), eq(teamInvitations.status, "pending")));
    }

    return { teamId: team.id, teamName: team.name };
  });

  const detail = await getTeamDetail(teamId, { kind: "current" });
  if (!detail) throw new TeamNotFoundError();

  // Best-effort ONLY, after commit -- notify the newly-accepted player.
  if (canonicalApplicant.telegram_id) {
    await notifyBestEffort(() =>
      sendTeamsTelegramNotification({
        telegramId: canonicalApplicant.telegram_id!,
        text: `✅ Вас приняли в команду «${teamName}».`,
        buttonText: "Открыть команду",
        path: "/teams?tab=my-team",
      })
    );
  }

  return detail;
}

// ---------------------------------------------------------------------
// Team avatar (captain-only) -- reuses avatarStorageRepository, the SAME
// local-filesystem-backed storage as player avatars (see
// lib/repositories/avatar-storage). This module never touches image
// bytes itself: the caller (the API route) is responsible for validating
// content-type/size and running lib/team-avatar-derivative.ts's Sharp
// normalization BEFORE calling this -- this function's own job is just
// the authorization check + the upload + the DB write, same division of
// labor as updateTeamIdentity above.
// ---------------------------------------------------------------------

export async function uploadTeamAvatar(
  actorId: string,
  teamId: string,
  processedBytes: Buffer,
  contentType: string
): Promise<TeamDetailView> {
  await db.transaction(async (tx) => {
    const [team] = await tx.select().from(teams).where(eq(teams.id, teamId)).for("update");
    if (!team) throw new TeamNotFoundError();
    if (team.status === "disbanded") throw new TeamDisbandedError();
    if (team.captainPlayerId !== actorId) throw new NotCaptainError();

    const filePath = `teams/${team.id}/avatar.${contentTypeToExtension(contentType)}`;
    const arrayBuffer = processedBytes.buffer.slice(
      processedBytes.byteOffset,
      processedBytes.byteOffset + processedBytes.byteLength
    ) as ArrayBuffer;
    const { error: uploadError } = await avatarStorageRepository.upload(filePath, arrayBuffer, contentType);
    if (uploadError) {
      throw new Error(uploadError);
    }

    const publicUrl = avatarStorageRepository.getPublicUrl(filePath);
    const versionedUrl = `${publicUrl}?v=${Date.now()}`;

    await tx.update(teams).set({ avatarUrl: versionedUrl, avatarUpdatedAt: new Date() }).where(eq(teams.id, teamId));
  });

  const detail = await getTeamDetail(teamId, { kind: "current" });
  if (!detail) throw new TeamNotFoundError();
  return detail;
}

export async function resetTeamAvatar(actorId: string, teamId: string): Promise<TeamDetailView> {
  await db.transaction(async (tx) => {
    const [team] = await tx.select().from(teams).where(eq(teams.id, teamId)).for("update");
    if (!team) throw new TeamNotFoundError();
    if (team.status === "disbanded") throw new TeamDisbandedError();
    if (team.captainPlayerId !== actorId) throw new NotCaptainError();

    await tx.update(teams).set({ avatarUrl: null, avatarUpdatedAt: new Date() }).where(eq(teams.id, teamId));
  });

  const detail = await getTeamDetail(teamId, { kind: "current" });
  if (!detail) throw new TeamNotFoundError();
  return detail;
}
