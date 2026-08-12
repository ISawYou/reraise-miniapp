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
import { syncPlayersAchievements } from "@/features/achievements";
import { calculateRatingPointsForTournament } from "@/features/rating-v2";
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

export async function createTournament(input: {
  title: string;
  description: string;
  location: string;
  start_at: string;
  max_players: number;
  tournament_type: TournamentType;
}) {
  const activeSeason = await seasonRepository.findActive();

  if (!activeSeason) {
    throw new Error("Активный сезон не найден");
  }

  return tournamentRepository.create({
    title: input.title,
    description: input.description,
    location: input.location,
    start_at: input.start_at,
    max_players: input.max_players,
    kind: "free",
    tournament_type: input.tournament_type,
    status: "open",
    season_id: activeSeason.id,
  });
}

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
  }
) {
  return tournamentRepository.update(tournamentId, {
    title: input.title,
    description: input.description,
    location: input.location,
    start_at: input.start_at,
    max_players: input.max_players,
    tournament_type: input.tournament_type,
    rating_guarantee: input.rating_guarantee ?? null,
  });
}

export async function deleteTournament(tournamentId: string) {
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

export async function addAdminTournamentParticipant(
  tournamentId: string,
  nick: string
) {
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

export async function addExistingPlayerToTournament(
  tournamentId: string,
  playerId: string
): Promise<void> {
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

export async function removeAdminTournamentParticipant(registrationId: string) {
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
    { ratingGuarantee: tournament.rating_guarantee }
  );
  const ratingMap = new Map(ratingResults.map((r) => [r.player_id, r.rating_points]));

  const payload = liveEntries.map((entry) => ({
    tournament_id: tournamentId,
    player_id: entry.player_id,
    season_id: tournamentRow.season_id ?? null,
    place: entry.place as number,
    reentries: entry.rebuys,
    knockouts: entry.knockouts,
    boss_knockouts: entry.boss_knockouts ?? 0,
    addons: entry.addons,
    rating_points: ratingMap.get(entry.player_id) ?? 0,
  }));

  await resultRepository.insertMany(payload);

  const playerIds = liveEntries.map((entry) => entry.player_id);

  await registrationRepository.markAttendedBulk(tournamentId, playerIds, [
    "registered",
    "attended",
  ]);

  await tournamentRepository.patch(tournamentId, { status: "completed" });

  try {
    await syncPlayersAchievements(playerIds);
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
    rating_points: item.rating_points,
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

  if (playerIds.length > 0) {
    try {
      await syncPlayersAchievements(playerIds);
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

export async function getActiveSeason() {
  const season = await seasonRepository.findActive();

  if (!season) {
    throw new Error("Активный сезон не найден");
  }

  return season;
}
