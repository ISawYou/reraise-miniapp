"use server";

import {
  playerRepository,
  seasonRepository,
  tournamentRepository,
  registrationRepository,
  tournamentLiveStateRepository,
  resultRepository,
} from "@/lib/repositories";
import type { LiveEntryPatch } from "@/lib/repositories";
import { syncPlayersAchievementsIfEnabled } from "@/features/achievements";
import { publishTournamentWinnerEvent } from "@/features/club-activity";
import { resolveSeasonForTournamentDate } from "@/features/seasons";
import { calculateRatingPointsForTournament } from "@/features/rating-v2";
import { isRatingEligibleTournament } from "@/lib/tournament-helpers";
import { assertValidResultPlaces } from "@/lib/tournament-results-validation";
import { computeDerivedEliminationPlaces } from "@/lib/tournament-placement";
import { TournamentNotFoundError } from "@/lib/tournament-errors";
import { assertPlayerActive } from "@/features/auth-server";
import { assertServerActorRole } from "@/lib/admin-auth";
import {
  FINAL_CANCELLATION_REJECTED_MESSAGE,
  FINAL_REGISTRATION_REJECTED_MESSAGE,
} from "@/lib/tournament-final-policy";
import type {
  Registration,
  RegistrationStatus,
  Tournament,
  TournamentKind,
  TournamentType,
  TournamentLiveEntry,
  TournamentParticipant,
  TournamentResult,
  TournamentResultInput,
  TournamentStatus,
} from "@/types/domain";
import type {
  RegistrationRow,
  TournamentLiveEntryRow,
  TournamentRow,
} from "@/types/database";
import type { PublicActiveTournamentPlayer } from "@/types/poker-clock-live-state";

const TOURNAMENT_NOTIFICATION_STATUSES: RegistrationStatus[] = [
  "registered",
  "waitlist",
  "attended",
];

export type TournamentNotificationAudience = "registered" | "access";

export type TournamentNotificationRecipient = {
  player_id: string;
  telegram_id: number;
  display_name: string;
  registration_status: RegistrationStatus | null;
};

export type TournamentLiveSheetRow = {
  player_id: string;
  registration_id: string;
  display_name: string;
  username: string | null;
  registration_status: "registered" | "attended";
  arrived: boolean;
  rebuys: number;
  addons: number;
  knockouts: number;
  boss_knockouts?: number;
  place: number | null;
  sheet_row_number: number | null;
};

export type AdminTournamentParticipant = {
  registration_id: string;
  player_id: string;
  admin_nick: string;
  status: "registered" | "attended" | "waitlist";
  custom_avatar_url?: string;
  telegram_avatar_url?: string;
};

function getPreferredPlayerDisplayName(player: {
  admin_display_name?: string | null;
  display_name?: string | null;
}) {
  const adminDisplayName = player.admin_display_name?.trim();
  const displayName = player.display_name?.trim();

  return adminDisplayName || displayName || "Игрок";
}

// Duplicated (intentionally) from lib/repositories/tournament — needed here
// for the two results/registrations queries that embed a full tournament
// row (getMyTournaments, getMyTournamentHistory). See
// lib/repositories/result/SupabaseResultRepository.ts's comment.
// `row.is_final ?? false`: defensive default only, same as
// rating_formula_version/rating_guarantee above it -- this embed is
// populated by either the Postgres or the (legacy/compatibility-only,
// see SupabaseTournamentRepository's mapTournamentRow comment) Supabase
// repository depending on DATABASE_PROVIDER, which is "postgres" in
// production.
function mapTournamentRow(row: TournamentRow): Tournament {
  return {
    id: row.id,
    title: row.title,
    description: row.description ?? undefined,
    location: row.location ?? undefined,
    google_sheet_tab_name: row.google_sheet_tab_name ?? null,
    start_at: row.start_at,
    max_players: row.max_players,
    kind: "free",
    tournament_type: row.tournament_type ?? "classic",
    season_id: row.season_id,
    status: row.status as TournamentStatus,
    created_at: row.created_at,
    rating_formula_version: row.rating_formula_version ?? "legacy",
    rating_guarantee: row.rating_guarantee ?? null,
    is_final: row.is_final ?? false,
  };
}

function mapRegistrationRow(row: RegistrationRow): Registration {
  return {
    id: row.id,
    player_id: row.player_id,
    tournament_id: row.tournament_id,
    status: row.status as RegistrationStatus,
    created_at: row.created_at,
  };
}

function mapTournamentLiveEntryRow(
  row: TournamentLiveEntryRow
): TournamentLiveEntry {
  return {
    id: row.id,
    tournament_id: row.tournament_id,
    registration_id: row.registration_id,
    player_id: row.player_id,
    display_name: "",
    username: null,
    registration_status: "registered",
    arrived: row.arrived,
    rebuys: row.rebuys,
    addons: row.addons,
    knockouts: row.knockouts,
    boss_knockouts: row.boss_knockouts ?? 0,
    place: row.place,
    sheet_row_number: row.sheet_row_number,
  };
}


function getAllowedTournamentKinds(player: {
  can_access_free?: boolean;
  can_access_paid?: boolean;
  can_access_cash?: boolean;
}): TournamentKind[] {
  const allowedKinds: TournamentKind[] = [];

  if (player.can_access_free ?? true) {
    allowedKinds.push("free");
  }

  if (player.can_access_paid) {
    allowedKinds.push("paid");
  }

  if (player.can_access_cash) {
    allowedKinds.push("cash");
  }

  return allowedKinds;
}

export async function getOpenTournaments() {
  return tournamentRepository.listOpen();
}

export async function getVisibleOpenTournamentsForPlayer(player: {
  can_access_free?: boolean;
  can_access_paid?: boolean;
  can_access_cash?: boolean;
}) {
  return tournamentRepository.listOpen();
}

export async function getCompletedTournaments() {
  return tournamentRepository.listCompleted();
}

export async function getAdminNotificationTournaments() {
  return tournamentRepository.listExcludingStatus("completed");
}

export async function getVisibleCompletedTournamentsForPlayer(player: {
  can_access_free?: boolean;
  can_access_paid?: boolean;
  can_access_cash?: boolean;
}) {
  return tournamentRepository.listCompleted();
}

export async function getVisibleTournamentsForPlayer(player: {
  can_access_free?: boolean;
  can_access_paid?: boolean;
  can_access_cash?: boolean;
}): Promise<{ open: Tournament[]; completed: Tournament[] }> {
  const rows = await tournamentRepository.listByStatuses(["open", "completed"]);

  return {
    open: rows.filter((t) => t.status === "open").reverse(),
    completed: rows.filter((t) => t.status === "completed"),
  };
}

export async function getTournamentById(tournamentId: string) {
  return tournamentRepository.findById(tournamentId);
}

export async function getVisibleTournamentByIdForPlayer(
  tournamentId: string,
  player: {
    can_access_free?: boolean;
    can_access_paid?: boolean;
    can_access_cash?: boolean;
  }
) {
  return getTournamentById(tournamentId);

  const tournament = await getTournamentById(tournamentId);

  if (!getAllowedTournamentKinds(player).includes(tournament.kind)) {
    throw new Error("Турнир недоступен");
  }

  return tournament;
}

export async function getPlayerRegistrations(playerId: string) {
  return registrationRepository.findActiveByPlayerId(playerId);
}

export async function getPlayerRegistrationForTournament(
  playerId: string,
  tournamentId: string
) {
  return registrationRepository.findActiveByPlayerAndTournament(playerId, tournamentId);
}

export async function getTournamentRegistrationCounts() {
  const rows = await registrationRepository.findRegisteredTournamentIds();

  return rows.reduce<Record<string, number>>((acc, row) => {
    acc[row.tournament_id] = (acc[row.tournament_id] ?? 0) + 1;
    return acc;
  }, {});
}

export async function registerPlayerForTournament(
  playerId: string,
  tournamentId: string
) {
  // Registration only ever receives a bare playerId, no session cookie --
  // re-check the player is still active server-side so a blocked player
  // can't register through a direct call to this action while their
  // existing signed session is still technically valid.
  await assertPlayerActive(playerId);

  const existingRegistrationData = await registrationRepository.findLatestByPlayerAndTournament(
    playerId,
    tournamentId
  );

  const existingRegistration = existingRegistrationData[0]
    ? mapRegistrationRow(existingRegistrationData[0])
    : null;

  if (existingRegistration?.status === "registered") {
    return existingRegistration;
  }

  if (existingRegistration?.status === "waitlist") {
    return existingRegistration;
  }

  const tournament = await getTournamentById(tournamentId);

  // Fail closed, server-side: a "Финал месяца" tournament's composition is
  // invite-only, set up entirely through the admin manual-participant flow
  // (addAdminTournamentParticipant / addExistingPlayerToTournament, which
  // write via registrationRepository directly and never call this
  // function). Checked before any registered/waitlist entry is
  // created/reactivated below -- title/description/tournament_type must
  // never be used to infer this, only tournament.is_final.
  if (tournament.is_final) {
    throw new Error(FINAL_REGISTRATION_REJECTED_MESSAGE);
  }

  const counts = await getTournamentRegistrationCounts();
  const registeredCount = counts[tournamentId] ?? 0;

  const nextStatus: RegistrationStatus =
    registeredCount < tournament.max_players ? "registered" : "waitlist";

  if (existingRegistration?.status === "attended") {
    throw new Error("Нельзя заново зарегистрироваться в завершённый турнир");
  }

  if (existingRegistration?.status === "cancelled") {
    return registrationRepository.updateStatus(existingRegistration.id, nextStatus);
  }

  return registrationRepository.create({
    player_id: playerId,
    tournament_id: tournamentId,
    status: nextStatus,
  });
}

export async function cancelPlayerRegistration(
  playerId: string,
  tournamentId: string
) {
  // Same direct-call exposure as registerPlayerForTournament above -- only
  // a bare playerId in hand, no session cookie to fall back on.
  await assertPlayerActive(playerId);

  const tournament = await getTournamentById(tournamentId);

  // A manually-added final participant must not be able to self-remove --
  // only the admin manual-participant flow (removeAdminTournamentParticipant,
  // a separate code path) can change a final's composition.
  if (tournament.is_final) {
    throw new Error(FINAL_CANCELLATION_REJECTED_MESSAGE);
  }

  const currentRegistration =
    await registrationRepository.findActiveOrWaitlistByPlayerAndTournamentOrThrow(
      playerId,
      tournamentId
    );

  await registrationRepository.updateStatusSilent(currentRegistration.id, "cancelled");

  if (currentRegistration.status === "registered") {
    const waitlistData = await registrationRepository.findOldestWaitlisted(tournamentId);
    const nextWaitlistPlayer = waitlistData[0];

    if (nextWaitlistPlayer) {
      await registrationRepository.updateStatusSilent(nextWaitlistPlayer.id, "registered");
    }
  }
}

export async function getMyTournaments(playerId: string) {
  const rows = await registrationRepository.findWithTournamentByPlayerId(playerId);

  return rows
    .map((row) => {
      const t = row.tournament;
      if (!t) return null;
      return {
        registration: mapRegistrationRow(row),
        tournament: mapTournamentRow(t as TournamentRow),
      };
    })
    .filter(Boolean) as Array<{
      registration: Registration;
      tournament: Tournament;
    }>;
}

export async function getTournamentSheetExportData(tournamentId: string) {
  const tournament = await getTournamentById(tournamentId);

  const [rows, resultsData] = await Promise.all([
    registrationRepository.findExportParticipants(tournamentId),
    resultRepository.findRatingPointsByTournamentId(tournamentId),
  ]);

  const ratingMap = new Map(
    resultsData.map((r) => [r.player_id, r.rating_points])
  );

  return {
    tournament,
    rows: rows.map((row) => {
      const player = row.players;

      return {
        player_id: row.player_id,
        display_name: getPreferredPlayerDisplayName(player ?? {}),
        username: player?.username ?? null,
        registration_status: row.status,
        rating_points: ratingMap.get(row.player_id) ?? null,
      };
    }),
  };
}

export async function setTournamentGoogleSheetTabName(
  tournamentId: string,
  tabName: string
) {
  await tournamentRepository.patch(tournamentId, { google_sheet_tab_name: tabName });
}

export async function getMyTournamentHistory(playerId: string) {
  const rows = await resultRepository.findHistoryWithTournamentByPlayerId(playerId);

  return rows
    .map((row) => {
      const t = row.tournament;
      if (!t) return null;
      return {
        tournament: mapTournamentRow(t as TournamentRow),
        result: {
          player_id: row.player_id,
          place: row.place,
          knockouts: row.knockouts,
          boss_knockouts: row.boss_knockouts ?? 0,
          reentries: row.reentries,
          rating_points: row.rating_points,
          username: null,
          display_name: "",
        } as TournamentResult,
      };
    })
    .filter(Boolean) as Array<{
      tournament: Tournament;
      result: TournamentResult;
    }>;
}

export async function getPlayerTournamentHistory(playerId: string) {
  return getMyTournamentHistory(playerId);
}

export async function getPlayerRating(playerId: string): Promise<number> {
  const rows = await resultRepository.findRatingPointsByPlayerId(playerId);

  return rows.reduce((sum, row) => sum + (row.rating_points ?? 0), 0);
}

export async function getPlayedTournamentsCount(
  playerId: string
): Promise<number> {
  return resultRepository.countByPlayerId(playerId);
}

// Season assignment is date-based, NOT "whichever season happens to be
// active" -- see lib/season-resolver.ts / features/seasons.ts::
// resolveSeasonForTournamentDate, the ONE canonical resolution used
// everywhere (admin preview, resync, this function). A September
// tournament created while an older season is still active correctly
// resolves to a future, still-inactive September season. No manual season
// selector exists anywhere in the create UI -- this is the entire
// assignment mechanism. Throws (NoSeasonForDateError /
// AmbiguousSeasonError, see lib/season-resolver.ts) rather than ever
// falling back to the active season.
export async function createTournament(input: {
  title: string;
  description: string;
  location: string;
  start_at: string;
  max_players: number;
  tournament_type: TournamentType;
  rating_guarantee?: number | null;
  // Absent/undefined is treated exactly like false -- every pre-existing
  // caller that doesn't know about "Финал месяца" keeps creating normal,
  // publicly self-registerable tournaments unchanged.
  is_final?: boolean;
}) {
  const season = await resolveSeasonForTournamentDate(input.start_at);

  return tournamentRepository.create({
    title: input.title,
    description: input.description,
    location: input.location,
    start_at: input.start_at,
    max_players: input.max_players,
    kind: "free",
    tournament_type: input.tournament_type,
    status: "open",
    season_id: season.id,
    rating_guarantee: input.rating_guarantee ?? null,
    is_final: input.is_final ?? false,
  });
}

// Invoked directly from app/admin/tournaments/[id]/edit/page.tsx as a
// Server Action -- this bypasses middleware.ts's /api/admin/:path* matcher
// entirely (a Server Action hits its own Next.js RPC endpoint, not that
// URL), so it must authorize itself. Staff (operator or Super Admin) --
// "operator can edit tournament" is explicitly allowed.
//
// season_id: a COMPLETED tournament is historical -- its season membership
// is frozen and never silently recalculated here, even if start_at is
// edited (e.g. a typo fix) or season ranges change later. A non-completed
// tournament (draft/open/closed) gets season_id re-resolved from whatever
// start_at ends up being saved, same canonical resolver createTournament
// uses -- editing its date across a season boundary correctly moves it.
export async function updateTournament(
  tournamentId: string,
  input: {
    title: string;
    description: string;
    location: string;
    start_at: string;
    max_players: number;
    tournament_type: TournamentType;
    rating_guarantee?: number | null;
    // Same absent-means-false contract as createTournament.
    is_final?: boolean;
  }
) {
  await assertServerActorRole(["admin", "operator"]);

  const current = await tournamentRepository.findById(tournamentId);
  const seasonPatch =
    current.status === "completed"
      ? {}
      : { season_id: (await resolveSeasonForTournamentDate(input.start_at)).id };

  return tournamentRepository.update(tournamentId, {
    title: input.title,
    description: input.description,
    location: input.location,
    start_at: input.start_at,
    max_players: input.max_players,
    tournament_type: input.tournament_type,
    rating_guarantee: input.rating_guarantee ?? null,
    is_final: input.is_final ?? false,
    ...seasonPatch,
  });
}

// Same bypass-of-middleware reasoning as updateTournament above -- but
// tournament deletion is explicitly Super-Admin-only ("operator must NOT
// be able to DELETE a tournament").
export async function deleteTournament(tournamentId: string) {
  await assertServerActorRole(["admin"]);

  await tournamentRepository.delete(tournamentId);
}

export async function getTournamentParticipants(
  tournamentId: string
): Promise<TournamentParticipant[]> {
  const tournament = await getTournamentById(tournamentId);
  const rows = await registrationRepository.findParticipantsWithRating(tournamentId);

  let ratingsMap = new Map<string, number>();

  if (tournament.season_id) {
    const resultsData = await resultRepository.findRatingPointsBySeasonId(
      tournament.season_id
    );

    ratingsMap = resultsData.reduce((map, row) => {
      const currentValue = map.get(row.player_id) ?? 0;
      map.set(row.player_id, currentValue + (row.rating_points ?? 0));
      return map;
    }, new Map<string, number>());
  }

  return rows.map((row) => {
    const player = row.players;

    return {
      registration_id: row.id,
      player_id: row.player_id,
      status: row.status as "registered" | "attended" | "waitlist",
      created_at: row.created_at,
      username: player?.username ?? null,
      telegram_avatar_url: player?.telegram_avatar_url ?? undefined,
      custom_avatar_url: player?.custom_avatar_url ?? undefined,
      display_name: getPreferredPlayerDisplayName(player ?? {}),
      rating: ratingsMap.get(row.player_id) ?? 0,
    };
  });
}

export async function getTournamentResultsDraft(tournamentId: string) {
  const rows = await registrationRepository.findResultsDraftParticipants(tournamentId);

  return rows.map((row) => {
    const player = row.players;

    return {
      registration_id: row.id,
      player_id: row.player_id,
      username: player?.username ?? null,
      display_name: getPreferredPlayerDisplayName(player ?? {}),
      status: row.status as "registered" | "attended",
    };
  });
}

export async function getAdminTournamentParticipants(
  tournamentId: string
): Promise<AdminTournamentParticipant[]> {
  const rows = await registrationRepository.findAdminParticipants(tournamentId);

  return rows.map((row) => {
    const player = row.players;

    return {
      registration_id: row.id,
      player_id: row.player_id,
      admin_nick: getPreferredPlayerDisplayName(player ?? {}),
      status: row.status as "registered" | "attended" | "waitlist",
      telegram_avatar_url: player?.telegram_avatar_url ?? undefined,
      custom_avatar_url: player?.custom_avatar_url ?? undefined,
    };
  });
}

// Same bypass-of-middleware reasoning as updateTournament above. Staff --
// "add walk-in/manual participant through the existing tournament flow"
// is explicitly allowed for operator.
export async function addAdminTournamentParticipant(
  tournamentId: string,
  nick: string
) {
  await assertServerActorRole(["admin", "operator"]);

  const normalizedNick = nick.trim();

  if (!normalizedNick) {
    throw new Error("Введите ник");
  }

  let player;
  try {
    player = await playerRepository.create({
      telegram_id: null,
      username: null,
      display_name: normalizedNick,
      admin_display_name: normalizedNick,
      role: "player",
    });
  } catch (err) {
    throw new Error(err instanceof Error ? err.message : String(err));
  }

  await registrationRepository.createSilent({
    player_id: player.id,
    tournament_id: tournamentId,
    status: "registered",
  });
}

// Same bypass-of-middleware reasoning as updateTournament above. Staff --
// "manage tournament registrations/participants/waitlist" is explicitly
// allowed for operator.
export async function addExistingPlayerToTournament(
  tournamentId: string,
  playerId: string
): Promise<void> {
  await assertServerActorRole(["admin", "operator"]);

  const existing = await registrationRepository.findLatestByPlayerAndTournament(
    playerId,
    tournamentId
  );

  const existingReg = existing[0];

  if (existingReg?.status === "registered" || existingReg?.status === "waitlist") {
    throw new Error("Игрок уже зарегистрирован в этом турнире");
  }

  if (existingReg?.status === "attended") {
    throw new Error("Игрок уже участвовал в этом турнире");
  }

  const tournament = await getTournamentById(tournamentId);
  const counts = await getTournamentRegistrationCounts();
  const registeredCount = counts[tournamentId] ?? 0;

  const nextStatus: RegistrationStatus =
    registeredCount < tournament.max_players ? "registered" : "waitlist";

  if (existingReg?.status === "cancelled") {
    await registrationRepository.updateStatusSilent(existingReg.id, nextStatus);
  } else {
    await registrationRepository.createSilent({
      player_id: playerId,
      tournament_id: tournamentId,
      status: nextStatus,
    });
  }
}

// Same bypass-of-middleware reasoning as updateTournament above. Staff --
// "manage tournament registrations/participants/waitlist" is explicitly
// allowed for operator.
export async function removeAdminTournamentParticipant(registrationId: string) {
  await assertServerActorRole(["admin", "operator"]);

  const regData = await registrationRepository.findStatusAndTournamentById(registrationId);

  await registrationRepository.delete(registrationId);

  if (regData.status === "registered") {
    const waitlistData = await registrationRepository.findOldestWaitlisted(
      regData.tournament_id
    );

    const nextWaitlistPlayer = waitlistData[0];
    if (nextWaitlistPlayer) {
      await registrationRepository.updateStatusSilent(nextWaitlistPlayer.id, "registered");
    }
  }
}

async function getTournamentLiveEligibleRegistrations(tournamentId: string) {
  const rows = await registrationRepository.findLiveEligible(tournamentId);

  return rows.map((row) => {
    const player = row.players;

    return {
      registration_id: row.id,
      player_id: row.player_id,
      username: player?.username ?? null,
      display_name: player?.display_name ?? "Игрок",
      registration_status: row.status as "registered" | "attended",
    };
  });
}

export async function ensureTournamentLiveEntries(tournamentId: string) {
  const tournament = await getTournamentById(tournamentId);

  if (tournament.kind === "free") {
    throw new Error("Live-режим доступен только для платных турниров и кэш-игр");
  }

  const eligibleRegistrations = await getTournamentLiveEligibleRegistrations(
    tournamentId
  );

  const existingPlayerIds = new Set(
    await tournamentLiveStateRepository.findPlayerIdsWithLiveEntry(tournamentId)
  );

  const rowsToInsert = eligibleRegistrations
    .filter((row) => !existingPlayerIds.has(row.player_id))
    .map((row) => ({
      tournament_id: tournamentId,
      player_id: row.player_id,
      registration_id: row.registration_id,
      arrived: false,
      rebuys: 0,
      addons: 0,
      knockouts: 0,
      boss_knockouts: 0,
      place: null,
    }));

  if (rowsToInsert.length > 0) {
    await tournamentLiveStateRepository.insertLiveEntries(rowsToInsert);
  }
}

export async function getTournamentLiveEntries(
  tournamentId: string
): Promise<TournamentLiveEntry[]> {
  const tournament = await getTournamentById(tournamentId);

  if (tournament.kind === "free") {
    throw new Error("Live-режим доступен только для платных турниров и кэш-игр");
  }

  await ensureTournamentLiveEntries(tournamentId);

  const rows = await tournamentLiveStateRepository.findLiveEntriesWithDetails(
    tournamentId
  );

  return rows.map((row) => {
    const base = mapTournamentLiveEntryRow(row as unknown as TournamentLiveEntryRow);

    return {
      ...base,
      display_name: getPreferredPlayerDisplayName(row.players ?? {}),
      username: row.players?.username ?? null,
      registration_status:
        (row.registrations?.status as "registered" | "attended") ?? "registered",
    };
  });
}

export async function updateTournamentLiveEntries(
  tournamentId: string,
  rows: Array<{
    player_id: string;
    arrived: boolean;
    rebuys: number;
    addons: number;
    knockouts: number;
    boss_knockouts?: number;
    place: number | null;
  }>
) {
  const tournament = await getTournamentById(tournamentId);

  if (tournament.kind === "free") {
    throw new Error("Live-режим доступен только для платных турниров и кэш-игр");
  }

  if (rows.length === 0) {
    return getTournamentLiveEntries(tournamentId);
  }

  await ensureTournamentLiveEntries(tournamentId);

  for (const row of rows) {
    await tournamentLiveStateRepository.updateLiveEntry(tournamentId, row.player_id, {
      arrived: row.arrived,
      rebuys: row.rebuys,
      addons: row.addons,
      knockouts: row.knockouts,
      boss_knockouts: row.boss_knockouts ?? 0,
      place: row.place,
      updated_at: new Date().toISOString(),
    });
  }

  return getTournamentLiveEntries(tournamentId);
}

export async function getTournamentLiveSheetData(
  tournamentId: string
): Promise<{
  tournament: Tournament;
  rows: TournamentLiveSheetRow[];
}> {
  const tournament = await getTournamentById(tournamentId);
  const rows = await getTournamentLiveEntries(tournamentId);

  return {
    tournament,
    rows: rows.map((row, index) => ({
      player_id: row.player_id,
      registration_id: row.registration_id,
      display_name: row.display_name,
      username: row.username,
      registration_status: row.registration_status,
      arrived: row.arrived,
      rebuys: row.rebuys,
      addons: row.addons,
      knockouts: row.knockouts,
      boss_knockouts: row.boss_knockouts ?? 0,
      place: row.place,
      sheet_row_number: row.sheet_row_number ?? index + 8,
    })),
  };
}

export async function applyTournamentLiveSheetRows(
  tournamentId: string,
  rows: Array<{
    player_id: string;
    arrived: boolean;
    rebuys: number;
    addons: number;
    knockouts: number;
    boss_knockouts?: number;
    place: number | null;
    sheet_row_number?: number | null;
  }>
) {
  if (rows.length === 0) {
    return getTournamentLiveEntries(tournamentId);
  }

  for (const row of rows) {
    const payload: LiveEntryPatch = {
      arrived: row.arrived,
      rebuys: row.rebuys,
      addons: row.addons,
      knockouts: row.knockouts,
      boss_knockouts: row.boss_knockouts ?? 0,
      place: row.place,
      updated_at: new Date().toISOString(),
    };

    if (row.sheet_row_number != null) {
      payload.sheet_row_number = row.sheet_row_number;
    }

    await tournamentLiveStateRepository.updateLiveEntry(tournamentId, row.player_id, payload);
  }

  return getTournamentLiveEntries(tournamentId);
}

export async function completeTournamentFromLiveEntries(tournamentId: string) {
  const tournament = await getTournamentById(tournamentId);

  if (tournament.kind === "free") {
    throw new Error("Завершение через live-режим доступно только для платных турниров и кэш-игр");
  }

  const liveEntries = await getTournamentLiveEntries(tournamentId);

  if (liveEntries.length === 0) {
    throw new Error("Для турнира нет live-данных");
  }

  const entriesWithoutPlace = liveEntries.filter((entry) => entry.place == null);

  if (entriesWithoutPlace.length > 0) {
    throw new Error(
      `Заполните место для всех игроков. Не заполнено: ${entriesWithoutPlace
        .map((entry) => entry.display_name)
        .join(", ")}`
    );
  }

  assertValidResultPlaces(
    liveEntries.map((entry) => ({
      player_id: entry.player_id,
      place: entry.place as number,
      display_name: entry.display_name,
    }))
  );

  const tournamentRow = await tournamentRepository.findSeasonIdById(tournamentId);

  await resultRepository.deleteByTournamentId(tournamentId);

  // entry.rebuys is each player's TOTAL entries (initial entry + every
  // rebuy) -- the same admin-facing field/convention used throughout the
  // app (see lib/mystery-bounty.ts's doc comment), not a rebuy-only count.
  const { results: ratingResults } = calculateRatingPointsForTournament(
    liveEntries.map((entry) => ({
      player_id: entry.player_id,
      place: entry.place ?? 0,
      knockouts: entry.knockouts,
      boss_knockouts: entry.boss_knockouts ?? 0,
      arrived: entry.arrived,
      entries: entry.rebuys,
      addons: entry.addons,
    })),
    tournament.tournament_type,
    tournament.rating_formula_version,
    { ratingGuarantee: tournament.rating_guarantee },
    isRatingEligibleTournament(tournament)
  );
  const ratingMap = new Map(ratingResults.map((r) => [r.player_id, r]));

  const payload = liveEntries.map((entry) => {
    const rating = ratingMap.get(entry.player_id);

    return {
      tournament_id: tournamentId,
      player_id: entry.player_id,
      season_id: tournamentRow.season_id ?? null,
      place: entry.place as number,
      reentries: entry.rebuys,
      knockouts: entry.knockouts,
      boss_knockouts: entry.boss_knockouts ?? 0,
      addons: entry.addons,
      rating_points: rating?.rating_points ?? 0,
      // Rating Breakdown -- same calculator call above, threaded straight
      // through to the insert payload (see ResultInsert's doc comment for
      // why these stay nullable rather than defaulting to 0/false here).
      arrived: entry.arrived,
      participation_points: rating?.participation_points ?? null,
      knockout_points: rating?.knockout_points ?? null,
      boss_bounty_points: rating?.boss_bounty_points ?? null,
      itm_points: rating?.itm_points ?? null,
    };
  });

  await resultRepository.insertMany(payload);

  const playerIds = liveEntries.map((entry) => entry.player_id);

  await registrationRepository.markAttendedBulk(tournamentId, playerIds, [
    "registered",
    "attended",
  ]);

  await tournamentRepository.patch(tournamentId, { status: "completed" });

  try {
    const winner = liveEntries.find((entry) => entry.place === 1);
    await publishTournamentWinnerEvent(tournamentId, winner?.player_id ?? null);
  } catch (activityError) {
    console.error("[completeTournamentFromLiveEntries] Activity event failed:", activityError);
  }

  try {
    await syncPlayersAchievementsIfEnabled(playerIds, { publishActivityEvents: true });
  } catch (achievementError) {
    console.error("[completeTournamentFromLiveEntries] Achievement sync failed:", achievementError);
  }

  return {
    completedCount: liveEntries.length,
  };
}

export async function saveTournamentResults(
  tournamentId: string,
  results: TournamentResultInput[]
) {
  assertValidResultPlaces(
    results.map((item) => ({
      player_id: item.player_id,
      place: item.place,
      display_name: item.display_name,
    }))
  );

  const tournamentRow = await tournamentRepository.findSeasonIdById(tournamentId);

  await resultRepository.deleteByTournamentId(tournamentId);

  const payload = results.map((item) => ({
    tournament_id: tournamentId,
    player_id: item.player_id,
    season_id: tournamentRow.season_id ?? null,
    place: item.place,
    reentries: item.reentries,
    knockouts: item.knockouts,
    boss_knockouts: item.boss_knockouts ?? 0,
    mystery_bounty_points: item.mystery_bounty_points ?? 0,
    addons: item.addons ?? 0,
    free_reentries: item.free_reentries ?? 0,
    rating_points: item.rating_points,
    // Rating Breakdown -- caller (complete-free route) computes these via
    // the same calculateRatingPointsForTournament call it already uses for
    // rating_points; threaded through as-is.
    arrived: item.arrived ?? null,
    participation_points: item.participation_points ?? null,
    knockout_points: item.knockout_points ?? null,
    boss_bounty_points: item.boss_bounty_points ?? null,
    itm_points: item.itm_points ?? null,
  }));

  await resultRepository.insertMany(payload);

  const playerIds = results.map((item) => item.player_id);

  if (playerIds.length > 0) {
    await registrationRepository.markAttendedBulk(tournamentId, playerIds, [
      "registered",
      "attended",
    ]);
  }

  await tournamentRepository.patch(tournamentId, { status: "completed" });

  try {
    const winner = results.find((item) => item.place === 1);
    await publishTournamentWinnerEvent(tournamentId, winner?.player_id ?? null);
  } catch (activityError) {
    console.error("[saveTournamentResults] Activity event failed:", activityError);
  }

  if (playerIds.length > 0) {
    try {
      await syncPlayersAchievementsIfEnabled(playerIds, { publishActivityEvents: true });
    } catch (achievementError) {
      console.error("[saveTournamentResults] Achievement sync failed:", achievementError);
    }
  }
}

export async function getTournamentNotificationRecipients(tournamentId: string) {
  const rows = await registrationRepository.findNotificationRecipients(
    tournamentId,
    TOURNAMENT_NOTIFICATION_STATUSES
  );

  const recipientsMap = new Map<number, TournamentNotificationRecipient>();

  for (const row of rows) {
    const player = row.players;
    const telegramId = player?.telegram_id;

    if (typeof telegramId !== "number") {
      continue;
    }

    if (!recipientsMap.has(telegramId)) {
      recipientsMap.set(telegramId, {
        player_id: row.player_id,
        telegram_id: telegramId,
        display_name: getPreferredPlayerDisplayName(player ?? {}),
        registration_status: row.status as RegistrationStatus,
      });
    }
  }

  return Array.from(recipientsMap.values());
}

export async function getTournamentAccessRecipientsByKind(
  kind: TournamentKind
) {
  const accessColumn =
    kind === "paid"
      ? "can_access_paid"
      : kind === "cash"
        ? "can_access_cash"
        : "can_access_free";

  const data = await playerRepository.listByAccessColumn(accessColumn);

  const recipientsMap = new Map<number, TournamentNotificationRecipient>();

  for (const row of data) {
    const telegramId = row.telegram_id;

    if (typeof telegramId !== "number") {
      continue;
    }

    if (!recipientsMap.has(telegramId)) {
      recipientsMap.set(telegramId, {
        player_id: row.id,
        telegram_id: telegramId,
        display_name: row.display_name ?? "Игрок",
        registration_status: null,
      });
    }
  }

  return Array.from(recipientsMap.values());
}

export async function getTournamentNotificationRecipientsByAudience(input: {
  tournamentId: string;
  tournamentKind: TournamentKind;
  audience: TournamentNotificationAudience;
}) {
  if (input.audience === "access") {
    return getTournamentAccessRecipientsByKind(input.tournamentKind);
  }

  return getTournamentNotificationRecipients(input.tournamentId);
}

export async function getTournamentResults(
  tournamentId: string
): Promise<TournamentResult[]> {
  return resultRepository.findByTournamentIdWithPlayer(tournamentId);
}

export type TournamentEntryStats = {
  playersCount: number;
  totalEntries: number;
  rebuysCount: number;
  addonsCount: number;
  freeEntriesCount: number;
};

// Simple aggregate over the CANONICAL persisted results of a (completed)
// tournament -- deliberately not a second rating/entries formula: it just
// sums already-frozen results rows, the same "reentries is each player's
// TOTAL entries" convention used everywhere else in this file. Distinct
// from the admin results page's live Rating Engine v2 preview
// (ratingEngineV2Summary, computed client-side from the in-progress editable
// form and filtered to arrived players only) -- that stays untouched; this
// reads whatever is actually saved, for any tournament/rating version.
export async function getTournamentEntryStats(tournamentId: string): Promise<TournamentEntryStats> {
  const results = await resultRepository.findByTournamentIdWithPlayer(tournamentId);

  const playersCount = results.length;
  const totalEntries = results.reduce((sum, row) => sum + row.reentries, 0);
  const addonsCount = results.reduce((sum, row) => sum + (row.addons ?? 0), 0);
  const freeEntriesCount = results.reduce((sum, row) => sum + (row.free_reentries ?? 0), 0);
  const rebuysCount = Math.max(0, totalEntries - playersCount);

  return { playersCount, totalEntries, rebuysCount, addonsCount, freeEntriesCount };
}

export async function getSeasonLeaderboard(seasonId: string) {
  const rows = await resultRepository.findWithPlayerBySeasonId(seasonId);

  const leaderboardMap = new Map<
    string,
    {
      player_id: string;
      username: string | null;
      display_name: string;
      telegram_avatar_url: string | null;
      custom_avatar_url: string | null;
      rating: number;
    }
  >();

  for (const row of rows) {
    const existing = leaderboardMap.get(row.player_id);

    if (existing) {
      existing.rating += row.rating_points ?? 0;
    } else {
      leaderboardMap.set(row.player_id, {
        player_id: row.player_id,
        username: row.username,
        display_name: row.display_name,
        telegram_avatar_url: row.telegram_avatar_url,
        custom_avatar_url: row.custom_avatar_url,
        rating: row.rating_points ?? 0,
      });
    }
  }

  return Array.from(leaderboardMap.values()).sort((a, b) => b.rating - a.rating);
}

export async function getTournamentEliminations(
  tournamentId: string
): Promise<Map<string, { eliminated: boolean; eliminated_at: string | null }>> {
  return tournamentLiveStateRepository.findEliminationsByTournamentId(tournamentId);
}

export async function setTournamentPlayerElimination(
  tournamentId: string,
  playerId: string,
  eliminated: boolean
): Promise<{ eliminated: boolean; eliminated_at: string | null }> {
  if (!eliminated) {
    await tournamentLiveStateRepository.upsertElimination({
      tournament_id: tournamentId,
      player_id: playerId,
      eliminated: false,
      eliminated_at: null,
      updated_at: new Date().toISOString(),
    });

    return { eliminated: false, eliminated_at: null };
  }

  const existingEliminatedAt =
    await tournamentLiveStateRepository.findEliminatedAtByTournamentAndPlayer(
      tournamentId,
      playerId
    );

  const eliminatedAt = existingEliminatedAt ?? new Date().toISOString();

  await tournamentLiveStateRepository.upsertElimination({
    tournament_id: tournamentId,
    player_id: playerId,
    eliminated: true,
    eliminated_at: eliminatedAt,
    updated_at: new Date().toISOString(),
  });

  return { eliminated: true, eliminated_at: eliminatedAt };
}

export type ReorderEliminationsResult =
  | { ok: true }
  | { ok: false; error: string };

// Admin correction for a wrong elimination ORDER (as opposed to a wrong
// eliminated/not-eliminated STATE, which setTournamentPlayerElimination
// above already handles). Deliberately does not add a manual `place`
// column/override -- eliminated_at stays the one canonical ordering source
// computeDerivedEliminationPlaces (lib/tournament-placement.ts) reads, so no
// schema migration and no second place formula.
//
// `orderedPlayerIds` must be validated by the caller to be exactly the
// currently-eliminated set (this function re-checks it itself, fail-closed,
// so a stale admin client can never silently corrupt state) -- see
// features/tournament-sheet-sync.ts's reorderTournamentEliminationsThroughSheet,
// the actual entry point that also pushes the recomputed places to Google
// Sheets afterward.
//
// Preserves the existing SET of eliminated_at timestamps rather than
// fabricating new ones: sorts them ascending, then reassigns them to
// players in the admin's corrected order (earliest -> first player in the
// list). Any duplicate (or missing, treated as epoch 0) value is nudged
// forward by the smallest possible increment (1ms) so the final sequence is
// always strictly increasing -- the corrected order is then unambiguous and
// can never depend on computeDerivedEliminationPlaces' own player_id
// tie-break for equal timestamps.
export async function reorderTournamentEliminations(
  tournamentId: string,
  orderedPlayerIds: string[]
): Promise<ReorderEliminationsResult> {
  const eliminations = await getTournamentEliminations(tournamentId);
  const currentlyEliminated = Array.from(eliminations.entries()).filter(
    ([, status]) => status.eliminated
  );
  const currentSet = new Set(currentlyEliminated.map(([playerId]) => playerId));
  const submittedSet = new Set(orderedPlayerIds);

  const isExactMatch =
    orderedPlayerIds.length === currentlyEliminated.length &&
    submittedSet.size === orderedPlayerIds.length &&
    orderedPlayerIds.every((playerId) => currentSet.has(playerId));

  if (!isExactMatch) {
    return {
      ok: false,
      error: "Список выбывших устарел — обновите страницу и повторите",
    };
  }

  const eliminatedAtByPlayer = new Map(
    currentlyEliminated.map(([playerId, status]) => [playerId, status.eliminated_at])
  );
  const sortedTimestamps = orderedPlayerIds
    .map((playerId) => new Date(eliminatedAtByPlayer.get(playerId) ?? 0).getTime())
    .sort((a, b) => a - b);

  let previous = -Infinity;
  const assignedTimestamps = sortedTimestamps.map((value) => {
    const next = value > previous ? value : previous + 1;
    previous = next;
    return next;
  });

  const now = new Date().toISOString();
  await Promise.all(
    orderedPlayerIds.map((playerId, index) =>
      tournamentLiveStateRepository.upsertElimination({
        tournament_id: tournamentId,
        player_id: playerId,
        eliminated: true,
        eliminated_at: new Date(assignedTimestamps[index]).toISOString(),
        updated_at: now,
      })
    )
  );

  return { ok: true };
}

// The single authoritative server-side elimination placement, for THIS
// tournament's CURRENT live state -- see lib/tournament-placement.ts for
// the algorithm itself. fieldSize = count(tournament_attendance.arrived
// === true) (never total sheet rows/registrations/waitlist); eliminated
// players are ordered by tournament_player_eliminations.eliminated_at.
// Every consumer that needs a derived place (the GS live-sync's Место
// write-back, the ReRaise admin elimination action, tournament completion,
// the Poker Clock integration contract) goes through this one function --
// see getArrivedPlayersForIntegration below for the one deliberate
// exception (it already has both maps in hand and inlines the same pure
// calculator to avoid a redundant round trip on a polled hot path).
export async function getDerivedEliminationPlaces(
  tournamentId: string
): Promise<Map<string, number>> {
  const [attendance, eliminations] = await Promise.all([
    getTournamentAttendance(tournamentId),
    getTournamentEliminations(tournamentId),
  ]);

  const fieldSize = Array.from(attendance.values()).filter((row) => row.arrived).length;
  const eliminatedEntries = Array.from(eliminations.entries())
    .filter(([, status]) => status.eliminated)
    .map(([player_id, status]) => ({
      player_id,
      eliminated_at: status.eliminated_at ?? new Date(0).toISOString(),
    }));

  return computeDerivedEliminationPlaces(fieldSize, eliminatedEntries);
}

// Live "Пришёл" state -- see lib/db/schema/tournamentLiveState.ts's doc
// comment on tournamentAttendance for why this exists separately from
// registrations.status ('attended' there is a post-completion bulk marker,
// not a live check-in signal) and results.arrived (frozen at completion).
export async function getTournamentAttendance(
  tournamentId: string
): Promise<Map<string, { arrived: boolean; arrived_at: string | null }>> {
  return tournamentLiveStateRepository.findAttendanceByTournamentId(tournamentId);
}

// This function deliberately does NOT read the existing row first and
// decide arrived_at here in application code the way an earlier version
// did: that two-round-trip read-then-write was exactly the gap where two
// concurrent calls could interleave. upsertAttendance now does the whole
// thing in one atomic statement (arrived_at computed via COALESCE against
// the row's own current value; arrived just unconditionally overwritten --
// see AttendanceUpsert's doc comment for why no client-supplied ordering
// token is trusted here). Same-tab click ordering is guaranteed upstream,
// entirely client-side, by lib/attendance-write-queue.ts -- this function
// never sees two competing writes from the same browser tab concurrently.
export async function setTournamentPlayerAttendance(
  tournamentId: string,
  playerId: string,
  arrived: boolean
): Promise<{ arrived: boolean; arrived_at: string | null }> {
  return tournamentLiveStateRepository.upsertAttendance({
    tournament_id: tournamentId,
    player_id: playerId,
    arrived,
  });
}

// Live Re-buy/Add-on state for kind='free' tournaments -- see
// lib/db/schema/tournamentLiveState.ts's doc comment on tournamentRebuyState
// for why this exists separately from tournament_live_entries (paid/cash
// only) and results.reentries/addons (frozen at completion). Stores and
// returns the RAW admin-facing "Re-buy" value (Total Entries convention);
// callers that need the normalized initialStackTaken/rebuys shape derive it
// themselves (see getArrivedPlayersForIntegration below) -- this function
// stays a thin, unopinionated read/write of the raw number, same as
// getTournamentAttendance/setTournamentPlayerAttendance above.
export async function getTournamentRebuyState(
  tournamentId: string
): Promise<Map<string, { rebuys: number; addons: number }>> {
  return tournamentLiveStateRepository.findRebuyStateByTournamentId(tournamentId);
}

export async function setTournamentPlayerRebuyState(
  tournamentId: string,
  playerId: string,
  rebuys: number,
  addons: number
): Promise<{ rebuys: number; addons: number }> {
  return tournamentLiveStateRepository.upsertRebuyState({
    tournament_id: tournamentId,
    player_id: playerId,
    rebuys,
    addons,
  });
}

// Public contract for the read-only Poker Clock integration surface
// (app/api/integrations/v1/**) -- deliberately excludes everything else on
// Player (email, telegram_id, username, role, access flags, moderation
// fields). nickname/avatar resolution reuses the exact same canonical
// helpers/precedence already used everywhere else in this file
// (getPreferredPlayerDisplayName, custom_avatar_url -> telegram_avatar_url).
//
// `eliminated` -- added alongside the existing fields, not a new concept:
// mirrors the "Выбыл" checkbox's own domain field name exactly
// (TournamentPlayerElimination.eliminated / tournament_player_eliminations
// .eliminated), read live from the SAME table that checkbox writes to, via
// the already-existing getTournamentEliminations() below. Eliminated
// players are NOT filtered out of this list -- the endpoint still only
// returns arrived=true players (see AttendedPlayerRow), but a player who
// has arrived and later busts out stays present here with eliminated=true,
// so Poker Clock can show them (e.g. greyed out at the bottom of a
// Display list) instead of having them silently vanish.
// `initialStackTaken`/`rebuys`/`addons` -- normalized at THIS boundary,
// never in storage. Re-Raise's own admin-facing "Re-buy" field is a Total
// Entries count (initial stack + every rebuy, see results.reentries's doc
// comment); leaking that raw convention into Poker Clock would just move
// the same confusion to a second codebase (see
// docs/POKER_CLOCK_REBUY_ADDON_INVESTIGATION.md §8 for the read-only
// investigation that recommended this). Derived per-player from the raw
// value read via getTournamentRebuyState -- deliberately NOT the aggregate
// `max(0, totalEntries - fieldSize)` shortcut used by
// features/rating-v2.ts's rating calculation, which silently undercounts
// whenever an arrived player's raw Re-buy is 0 (arrived but not yet staked)
// while other players have rebuys >= 2 -- see that same doc, §9, for the
// worked counterexample. A player with no live rebuy-state row at all
// (never touched, whether via direct UI edit or a Google Sheets pull) is
// treated as raw Re-buy = 0 -- initialStackTaken: false, rebuys: 0 -- same
// "absence means the not-yet-happened default" convention already used for
// `eliminated` above.
export type IntegrationPlayer = {
  id: string;
  nickname: string;
  avatarUrl: string | null;
  ratingPoints: number | null;
  eliminated: boolean;
  // Backwards-compatible addition: the SAME derived placement algorithm
  // used for Google Sheets' Место write-back (see
  // lib/tournament-placement.ts / getDerivedEliminationPlaces above) --
  // never a second calculator. `null` while the player is still in the
  // game; a finishing place (1..fieldSize) once eliminated. No existing
  // field's semantics change.
  place: number | null;
  // Backwards-compatible addition: read from the SAME
  // tournament_player_eliminations row `eliminated` above already comes
  // from (via getTournamentEliminations/findEliminationsByTournamentId) --
  // not a second timestamp source. `null` while eliminated is false or the
  // player has no elimination row at all.
  eliminatedAt: string | null;
  initialStackTaken: boolean;
  rebuys: number;
  addons: number;
};

// Players currently considered "arrived" for one tournament -- the read side
// of the live attendance flow above. ratingPoints mirrors
// getTournamentParticipants' existing season-rating semantics (live
// SUM(results.rating_points) for the SEASON THIS TOURNAMENT BELONGS TO, not
// the globally-active season) with one deliberate difference: when the
// tournament has no season_id at all, this returns `null`, not `0` --
// getTournamentParticipants' `?? 0` fallback would otherwise claim a real
// zero rating for a tournament that has no rating basis whatsoever. `0` is
// still returned (not null) for a season-linked tournament whose player
// genuinely has no results yet this season -- that IS a real, meaningful
// zero, same as getTournamentParticipants already treats it.
//
// Nothing here is cached/snapshotted -- both findAttendedPlayersWithDetails
// and findEliminationsByTournamentId hit tournament_attendance /
// tournament_player_eliminations directly on every call, so a GET issued
// right after an admin toggles either checkbox already reflects it. Re-Raise
// stays the only source of truth; there is no copy of this state anywhere
// for Poker Clock to read instead.
export async function getArrivedPlayersForIntegration(
  tournamentId: string
): Promise<IntegrationPlayer[]> {
  let tournament: Tournament;
  try {
    tournament = await getTournamentById(tournamentId);
  } catch {
    throw new TournamentNotFoundError(tournamentId);
  }

  const [attendedRows, eliminations, rebuyState] = await Promise.all([
    tournamentLiveStateRepository.findAttendedPlayersWithDetails(tournamentId),
    tournamentLiveStateRepository.findEliminationsByTournamentId(tournamentId),
    tournamentLiveStateRepository.findRebuyStateByTournamentId(tournamentId),
  ]);

  let ratingsMap = new Map<string, number>();

  if (tournament.season_id) {
    const resultsData = await resultRepository.findRatingPointsBySeasonId(tournament.season_id);

    ratingsMap = resultsData.reduce((map, row) => {
      const currentValue = map.get(row.player_id) ?? 0;
      map.set(row.player_id, currentValue + (row.rating_points ?? 0));
      return map;
    }, new Map<string, number>());
  }

  // fieldSize = attendedRows.length exactly (attendedRows already only
  // contains arrived===true players -- see
  // findAttendedPlayersWithDetails' own WHERE clause), so this inlines the
  // same pure calculator getDerivedEliminationPlaces uses rather than
  // re-fetching attendance/eliminations a second time on this polled
  // integration path.
  const derivedPlaces = computeDerivedEliminationPlaces(
    attendedRows.length,
    Array.from(eliminations.entries())
      .filter(([, status]) => status.eliminated)
      .map(([player_id, status]) => ({
        player_id,
        eliminated_at: status.eliminated_at ?? new Date(0).toISOString(),
      }))
  );

  return attendedRows.map((row) => {
    const player = row.players;
    const rawRebuy = rebuyState.get(row.player_id)?.rebuys ?? 0;
    const rawAddon = rebuyState.get(row.player_id)?.addons ?? 0;

    return {
      id: row.player_id,
      nickname: getPreferredPlayerDisplayName(player ?? {}),
      avatarUrl: player?.custom_avatar_url ?? player?.telegram_avatar_url ?? null,
      ratingPoints: tournament.season_id ? ratingsMap.get(row.player_id) ?? 0 : null,
      // No elimination row at all (never toggled) means not eliminated --
      // matches tournament_player_eliminations' own `eliminated boolean not
      // null default false` semantics.
      eliminated: eliminations.get(row.player_id)?.eliminated ?? false,
      place: derivedPlaces.get(row.player_id) ?? null,
      eliminatedAt: eliminations.get(row.player_id)?.eliminated_at ?? null,
      // Per-player normalization, not the aggregate rating-v2.ts shortcut --
      // see IntegrationPlayer's doc comment above for why.
      initialStackTaken: rawRebuy >= 1,
      rebuys: Math.max(rawRebuy - 1, 0),
      addons: rawAddon,
    };
  });
}

// Player-facing live-roster read model -- reuses the same authoritative
// attendance + elimination state as the Poker Clock integration
// (getArrivedPlayersForIntegration above), but sanitized down to only the
// fields the browser is allowed to see. No rebuys/addons/initial stack/KO
// counts/eliminatedAt, no admin/payment fields, no sheet row numbers -- see
// PublicActiveTournamentPlayer's doc comment. Returns EVERY arrived player,
// active and eliminated alike -- getArrivedPlayersForIntegration already
// only returns arrived players, so nothing is filtered here; the "В игре" /
// "Выбыли" split (app/tournaments/[id]/page.tsx) happens client-side on
// `eliminated`, off this one poll, same as the Poker Clock integration
// gets both states off its one call.
export async function getActiveTournamentPlayersForPublicView(
  tournamentId: string
): Promise<PublicActiveTournamentPlayer[]> {
  const players = await getArrivedPlayersForIntegration(tournamentId);

  return players.map((player) => ({
    playerId: player.id,
    displayName: player.nickname,
    avatarUrl: player.avatarUrl,
    rating: player.ratingPoints,
    eliminated: player.eliminated,
    place: player.place,
  }));
}

// Tournament list for the Poker Clock "link a tournament" dropdown -- this
// endpoint's one and only stated purpose (see the route's own doc comment).
// Open only, deliberately: a completed tournament cannot sensibly be picked
// for a NEW binding (confirmed by real usage, not a guess), and this
// function has no other consumer to weigh against that. listOpen() is
// naturally small (a club runs at most a handful of concurrently-open
// tournaments), so no pagination/limit is needed here.
//
// This does NOT affect an already-linked tournament that later completes --
// that binding is read through GET .../tournaments/:id/players instead,
// which looks a tournament up directly by id regardless of status (see
// getArrivedPlayersForIntegration above). Dropping completed tournaments
// from THIS list only narrows what's offered for a brand new binding.
//
// An earlier version of this function also returned the 10 most recently
// completed tournaments, reasoning that organizers might want to
// retroactively link one after the fact. Reverted: real usage showed a
// completed tournament being offered as a candidate for a new binding is
// simply wrong, and no other part of this integration reads this
// function's completed-tournament output, so there is nothing else to
// preserve by keeping it.
export type IntegrationTournamentSummary = {
  id: string;
  title: string;
  startAt: string;
  status: TournamentStatus;
  tournamentType: TournamentType;
};

export async function getIntegrationTournamentList(): Promise<IntegrationTournamentSummary[]> {
  const open = await tournamentRepository.listOpen();

  return open.map((tournament) => ({
    id: tournament.id,
    title: tournament.title,
    startAt: tournament.start_at,
    status: tournament.status,
    tournamentType: tournament.tournament_type,
  }));
}

export async function getActiveSeason() {
  const season = await seasonRepository.findActive();

  if (!season) {
    throw new Error("Активный сезон не найден");
  }

  return season;
}
