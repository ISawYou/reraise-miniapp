import { supabase } from "@/lib/supabase";
import { syncPlayersAchievements } from "@/features/achievements";
import type {
  Registration,
  RegistrationStatus,
  Tournament,
  TournamentKind,
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

function mapTournamentRow(row: TournamentRow): Tournament {
  return {
    id: row.id,
    title: row.title,
    description: row.description ?? undefined,
    location: row.location ?? undefined,
    google_sheet_tab_name: row.google_sheet_tab_name ?? null,
    start_at: row.start_at,
    max_players: row.max_players,
    kind: row.kind,
    season_id: row.season_id,
    status: row.status as TournamentStatus,
    created_at: row.created_at,
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
    place: row.place,
    sheet_row_number: row.sheet_row_number,
  };
}

async function getTournamentsByIds(tournamentIds: string[]) {
  if (tournamentIds.length === 0) {
    return [];
  }

  const { data, error } = await supabase
    .from("tournaments")
    .select("*")
    .in("id", tournamentIds)
    .order("start_at", { ascending: true });

  if (error) {
    throw new Error(error.message);
  }

  return (data ?? []).map((row) => mapTournamentRow(row as TournamentRow));
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
  const { data, error } = await supabase
    .from("tournaments")
    .select("*")
    .eq("status", "open")
    .order("start_at", { ascending: true });

  if (error) {
    throw new Error(error.message);
  }

  return (data ?? []).map((row) => mapTournamentRow(row as TournamentRow));
}

export async function getVisibleOpenTournamentsForPlayer(player: {
  can_access_free?: boolean;
  can_access_paid?: boolean;
  can_access_cash?: boolean;
}) {
  const { data, error } = await supabase
    .from("tournaments")
    .select("*")
    .eq("status", "open")
    .in("kind", getAllowedTournamentKinds(player))
    .order("start_at", { ascending: true });

  if (error) {
    throw new Error(error.message);
  }

  return (data ?? []).map((row) => mapTournamentRow(row as TournamentRow));
}

export async function getCompletedTournaments() {
  const { data, error } = await supabase
    .from("tournaments")
    .select("*")
    .eq("status", "completed")
    .order("start_at", { ascending: false });

  if (error) {
    throw new Error(error.message);
  }

  return (data ?? []).map((row) => mapTournamentRow(row as TournamentRow));
}

export async function getAdminNotificationTournaments() {
  const { data, error } = await supabase
    .from("tournaments")
    .select("*")
    .neq("status", "completed")
    .order("start_at", { ascending: true });

  if (error) {
    throw new Error(error.message);
  }

  return (data ?? []).map((row) => mapTournamentRow(row as TournamentRow));
}

export async function getVisibleCompletedTournamentsForPlayer(player: {
  can_access_free?: boolean;
  can_access_paid?: boolean;
  can_access_cash?: boolean;
}) {
  const { data, error } = await supabase
    .from("tournaments")
    .select("*")
    .eq("status", "completed")
    .in("kind", getAllowedTournamentKinds(player))
    .order("start_at", { ascending: false });

  if (error) {
    throw new Error(error.message);
  }

  return (data ?? []).map((row) => mapTournamentRow(row as TournamentRow));
}

export async function getTournamentById(tournamentId: string) {
  const { data, error } = await supabase
    .from("tournaments")
    .select("*")
    .eq("id", tournamentId)
    .single();

  if (error) {
    throw new Error(error.message);
  }

  return mapTournamentRow(data as TournamentRow);
}

export async function getVisibleTournamentByIdForPlayer(
  tournamentId: string,
  player: {
    can_access_free?: boolean;
    can_access_paid?: boolean;
    can_access_cash?: boolean;
  }
) {
  const tournament = await getTournamentById(tournamentId);

  if (!getAllowedTournamentKinds(player).includes(tournament.kind)) {
    throw new Error("Турнир недоступен");
  }

  return tournament;
}

export async function getPlayerRegistrations(playerId: string) {
  const { data, error } = await supabase
    .from("registrations")
    .select("*")
    .eq("player_id", playerId)
    .in("status", ["registered", "waitlist", "attended"]);

  if (error) {
    throw new Error(error.message);
  }

  return (data ?? []).map((row) => mapRegistrationRow(row as RegistrationRow));
}

export async function getTournamentRegistrationCounts() {
  const { data, error } = await supabase
    .from("registrations")
    .select("tournament_id, status")
    .eq("status", "registered");

  if (error) {
    throw new Error(error.message);
  }

  return (data ?? []).reduce<Record<string, number>>((acc, row: any) => {
    acc[row.tournament_id] = (acc[row.tournament_id] ?? 0) + 1;
    return acc;
  }, {});
}

export async function registerPlayerForTournament(
  playerId: string,
  tournamentId: string
) {
  const { data: existingRegistrationData, error: existingRegistrationError } = await supabase
    .from("registrations")
    .select("*")
    .eq("player_id", playerId)
    .eq("tournament_id", tournamentId)
    .order("created_at", { ascending: false })
    .limit(1);

  if (existingRegistrationError) {
    throw new Error(existingRegistrationError.message);
  }

  const existingRegistration = existingRegistrationData?.[0]
    ? mapRegistrationRow(existingRegistrationData[0] as RegistrationRow)
    : null;

  if (existingRegistration?.status === "registered") {
    return existingRegistration;
  }

  if (existingRegistration?.status === "waitlist") {
    return existingRegistration;
  }

  const { data: playerData, error: playerError } = await supabase
    .from("players")
    .select("can_access_free, can_access_paid, can_access_cash")
    .eq("id", playerId)
    .single();

  if (playerError) {
    throw new Error(playerError.message);
  }

  const tournament = await getVisibleTournamentByIdForPlayer(tournamentId, {
    can_access_free: playerData.can_access_free,
    can_access_paid: playerData.can_access_paid,
    can_access_cash: playerData.can_access_cash,
  });
  const counts = await getTournamentRegistrationCounts();
  const registeredCount = counts[tournamentId] ?? 0;

  const nextStatus: RegistrationStatus =
    registeredCount < tournament.max_players ? "registered" : "waitlist";

  if (existingRegistration?.status === "attended") {
    throw new Error("Нельзя заново зарегистрироваться в завершённый турнир");
  }

  if (existingRegistration?.status === "cancelled") {
    const { data, error } = await supabase
      .from("registrations")
      .update({ status: nextStatus })
      .eq("id", existingRegistration.id)
      .select("*")
      .single();

    if (error) {
      throw new Error(error.message);
    }

    return mapRegistrationRow(data as RegistrationRow);
  }

  const { data, error } = await supabase
    .from("registrations")
    .insert({
      player_id: playerId,
      tournament_id: tournamentId,
      status: nextStatus,
    })
    .select("*")
    .single();

  if (error) {
    throw new Error(error.message);
  }

  return mapRegistrationRow(data as RegistrationRow);
}

export async function cancelPlayerRegistration(
  playerId: string,
  tournamentId: string
) {
  const { data: registrationData, error: registrationError } = await supabase
    .from("registrations")
    .select("*")
    .eq("player_id", playerId)
    .eq("tournament_id", tournamentId)
    .in("status", ["registered", "waitlist"])
    .order("created_at", { ascending: false })
    .limit(1)
    .single();

  if (registrationError) {
    throw new Error(registrationError.message);
  }

  const currentRegistration = mapRegistrationRow(registrationData as RegistrationRow);

  const { error: cancelError } = await supabase
    .from("registrations")
    .update({ status: "cancelled" })
    .eq("id", currentRegistration.id);

  if (cancelError) {
    throw new Error(cancelError.message);
  }

  if (currentRegistration.status === "registered") {
    const { data: waitlistData, error: waitlistError } = await supabase
      .from("registrations")
      .select("*")
      .eq("tournament_id", tournamentId)
      .eq("status", "waitlist")
      .order("created_at", { ascending: true })
      .limit(1);

    if (waitlistError) {
      throw new Error(waitlistError.message);
    }

    const nextWaitlistPlayer = waitlistData?.[0];

    if (nextWaitlistPlayer) {
      const { error: promoteError } = await supabase
        .from("registrations")
        .update({ status: "registered" })
        .eq("id", nextWaitlistPlayer.id);

      if (promoteError) {
        throw new Error(promoteError.message);
      }
    }
  }
}

export async function getMyTournaments(playerId: string) {
  const registrations = await getPlayerRegistrations(playerId);

  const tournamentIds = registrations.map((registration) => registration.tournament_id);
  const tournaments = await getTournamentsByIds(tournamentIds);

  const tournamentsMap = new Map(tournaments.map((tournament) => [tournament.id, tournament]));

  return registrations
    .map((registration) => {
      const tournament = tournamentsMap.get(registration.tournament_id);

      if (!tournament) {
        return null;
      }

      return {
        registration,
        tournament,
      };
    })
    .filter(Boolean) as Array<{
      registration: Registration;
      tournament: Tournament;
    }>;
}

export async function getTournamentSheetExportData(tournamentId: string) {
  const tournament = await getTournamentById(tournamentId);

  const { data, error } = await supabase
    .from("registrations")
    .select(
      `
      id,
      status,
      created_at,
      player_id,
      players (
        id,
        username,
        admin_display_name,
        display_name
      )
    `
    )
    .eq("tournament_id", tournamentId)
    .in("status", ["registered", "waitlist", "attended"])
    .order("created_at", { ascending: true });

  if (error) {
    throw new Error(error.message);
  }

  return {
    tournament,
    rows: (data ?? []).map((row: any) => {
      const player = Array.isArray(row.players) ? row.players[0] : row.players;

      return {
        player_id: row.player_id,
        display_name: getPreferredPlayerDisplayName(player ?? {}),
        username: player?.username ?? null,
        registration_status: row.status,
      };
    }),
  };
}

export async function setTournamentGoogleSheetTabName(
  tournamentId: string,
  tabName: string
) {
  const { error } = await supabase
    .from("tournaments")
    .update({ google_sheet_tab_name: tabName })
    .eq("id", tournamentId);

  if (error) {
    throw new Error(error.message);
  }
}

export async function getMyTournamentHistory(playerId: string) {
  const { data, error } = await supabase
    .from("results")
    .select(`
      player_id,
      tournament_id,
      place,
      knockouts,
      reentries,
      rating_points
    `)
    .eq("player_id", playerId)
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error(error.message);
  }

  const results = data ?? [];
  const tournamentIds = results.map((row: any) => row.tournament_id);
  const tournaments = await getTournamentsByIds(tournamentIds);
  const tournamentsMap = new Map(tournaments.map((tournament) => [tournament.id, tournament]));

  return results
    .map((row: any) => {
      const tournament = tournamentsMap.get(row.tournament_id);

      if (!tournament) {
        return null;
      }

      return {
        tournament,
        result: {
          player_id: row.player_id,
          place: row.place,
          knockouts: row.knockouts,
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
  const { data, error } = await supabase
    .from("results")
    .select("rating_points")
    .eq("player_id", playerId);

  if (error) {
    throw new Error(error.message);
  }

  return (data ?? []).reduce(
    (sum, row: any) => sum + (row.rating_points ?? 0),
    0
  );
}

export async function getPlayedTournamentsCount(
  playerId: string
): Promise<number> {
  const { count, error } = await supabase
    .from("results")
    .select("*", { count: "exact", head: true })
    .eq("player_id", playerId);

  if (error) {
    throw new Error(error.message);
  }

  return count ?? 0;
}

export async function createTournament(input: {
  title: string;
  description: string;
  location: string;
  start_at: string;
  max_players: number;
  kind: TournamentKind;
}) {
  const { data: activeSeason, error: activeSeasonError } = await supabase
    .from("seasons")
    .select("id")
    .eq("is_active", true)
    .limit(1)
    .single();

  if (activeSeasonError) {
    throw new Error("Активный сезон не найден");
  }

  const { data, error } = await supabase
    .from("tournaments")
    .insert({
      title: input.title,
      description: input.description,
      location: input.location,
      start_at: input.start_at,
      max_players: input.max_players,
      kind: input.kind,
      status: "open",
      season_id: activeSeason.id,
    })
    .select("*")
    .single();

  if (error) {
    throw new Error(error.message);
  }

  return mapTournamentRow(data as TournamentRow);
}

export async function updateTournament(
  tournamentId: string,
  input: {
    title: string;
    description: string;
    location: string;
    start_at: string;
    max_players: number;
    kind: TournamentKind;
  }
) {
  const { data, error } = await supabase
    .from("tournaments")
    .update({
      title: input.title,
      description: input.description,
      location: input.location,
      start_at: input.start_at,
      max_players: input.max_players,
      kind: input.kind,
    })
    .eq("id", tournamentId)
    .select("*")
    .single();

  if (error) {
    throw new Error(error.message);
  }

  return mapTournamentRow(data as TournamentRow);
}

export async function deleteTournament(tournamentId: string) {
  const { error } = await supabase
    .from("tournaments")
    .delete()
    .eq("id", tournamentId);

  if (error) {
    throw new Error(error.message);
  }
}

export async function getTournamentParticipants(
  tournamentId: string
): Promise<TournamentParticipant[]> {
  const tournament = await getTournamentById(tournamentId);

  const { data, error } = await supabase
    .from("registrations")
    .select(`
      id,
      status,
      created_at,
      tournament_id,
      player_id,
      players (
        id,
        username,
        display_name,
        telegram_avatar_url,
        custom_avatar_url
      )
    `)
    .eq("tournament_id", tournamentId)
    .in("status", ["registered", "attended", "waitlist"])
    .order("created_at", { ascending: true });

  if (error) {
    throw new Error(error.message);
  }

  let ratingsMap = new Map<string, number>();

  if (tournament.season_id) {
    const { data: resultsData, error: resultsError } = await supabase
      .from("results")
      .select("player_id, rating_points")
      .eq("season_id", tournament.season_id);

    if (resultsError) {
      throw new Error(resultsError.message);
    }

    ratingsMap = (resultsData ?? []).reduce((map, row: any) => {
      const currentValue = map.get(row.player_id) ?? 0;
      map.set(row.player_id, currentValue + (row.rating_points ?? 0));
      return map;
    }, new Map<string, number>());
  }

  return (data ?? []).map((row: any) => {
    const player = Array.isArray(row.players) ? row.players[0] : row.players;

    return {
      registration_id: row.id,
      player_id: row.player_id,
      status: row.status,
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
  const { data, error } = await supabase
    .from("registrations")
    .select(`
      id,
      status,
      created_at,
      tournament_id,
      player_id,
      players (
        id,
        username,
        admin_display_name,
        display_name
      )
    `)
    .eq("tournament_id", tournamentId)
    .in("status", ["registered", "attended"])
    .order("created_at", { ascending: true });

  if (error) {
    throw new Error(error.message);
  }

  return (data ?? []).map((row: any) => {
    const player = Array.isArray(row.players) ? row.players[0] : row.players;

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
  const { data, error } = await supabase
    .from("registrations")
    .select(
      `
      id,
      status,
      player_id,
      players (
        admin_display_name,
        display_name,
        telegram_avatar_url,
        custom_avatar_url
      )
    `
    )
    .eq("tournament_id", tournamentId)
    .in("status", ["registered", "attended", "waitlist"])
    .order("created_at", { ascending: true });

  if (error) {
    throw new Error(error.message);
  }

  return (data ?? []).map((row: any) => {
    const player = Array.isArray(row.players) ? row.players[0] : row.players;

    return {
      registration_id: row.id as string,
      player_id: row.player_id as string,
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

  const { data: playerData, error: playerError } = await supabase
    .from("players")
    .insert({
      telegram_id: null,
      username: null,
      display_name: normalizedNick,
      admin_display_name: normalizedNick,
      role: "player",
    })
    .select("id")
    .single();

  if (playerError) {
    throw new Error(playerError.message);
  }

  const { error: registrationError } = await supabase
    .from("registrations")
    .insert({
      player_id: playerData.id,
      tournament_id: tournamentId,
      status: "registered",
    });

  if (registrationError) {
    throw new Error(registrationError.message);
  }
}

export async function addExistingPlayerToTournament(
  tournamentId: string,
  playerId: string
): Promise<void> {
  const { data: existing, error: existingError } = await supabase
    .from("registrations")
    .select("*")
    .eq("player_id", playerId)
    .eq("tournament_id", tournamentId)
    .order("created_at", { ascending: false })
    .limit(1);

  if (existingError) {
    throw new Error(existingError.message);
  }

  const existingReg = existing?.[0];

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
    const { error } = await supabase
      .from("registrations")
      .update({ status: nextStatus })
      .eq("id", existingReg.id);

    if (error) {
      throw new Error(error.message);
    }
  } else {
    const { error } = await supabase
      .from("registrations")
      .insert({ player_id: playerId, tournament_id: tournamentId, status: nextStatus });

    if (error) {
      throw new Error(error.message);
    }
  }
}

export async function removeAdminTournamentParticipant(registrationId: string) {
  const { data: regData, error: fetchError } = await supabase
    .from("registrations")
    .select("status, tournament_id")
    .eq("id", registrationId)
    .single();

  if (fetchError) {
    throw new Error(fetchError.message);
  }

  const { error } = await supabase
    .from("registrations")
    .delete()
    .eq("id", registrationId);

  if (error) {
    throw new Error(error.message);
  }

  if (regData.status === "registered") {
    const { data: waitlistData, error: waitlistError } = await supabase
      .from("registrations")
      .select("*")
      .eq("tournament_id", regData.tournament_id)
      .eq("status", "waitlist")
      .order("created_at", { ascending: true })
      .limit(1);

    if (waitlistError) {
      throw new Error(waitlistError.message);
    }

    const nextWaitlistPlayer = waitlistData?.[0];
    if (nextWaitlistPlayer) {
      const { error: promoteError } = await supabase
        .from("registrations")
        .update({ status: "registered" })
        .eq("id", nextWaitlistPlayer.id);

      if (promoteError) {
        throw new Error(promoteError.message);
      }
    }
  }
}

async function getTournamentLiveEligibleRegistrations(tournamentId: string) {
  const { data, error } = await supabase
    .from("registrations")
    .select(
      `
      id,
      status,
      player_id,
      players (
        id,
        username,
        admin_display_name,
        display_name
      )
    `
    )
    .eq("tournament_id", tournamentId)
    .in("status", ["registered", "attended"])
    .order("created_at", { ascending: true });

  if (error) {
    throw new Error(error.message);
  }

  return (data ?? []).map((row: any) => {
    const player = Array.isArray(row.players) ? row.players[0] : row.players;

    return {
      registration_id: row.id as string,
      player_id: row.player_id as string,
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

  const { data: existingEntriesData, error: existingEntriesError } = await supabase
    .from("tournament_live_entries")
    .select("player_id")
    .eq("tournament_id", tournamentId);

  if (existingEntriesError) {
    throw new Error(existingEntriesError.message);
  }

  const existingPlayerIds = new Set(
    (existingEntriesData ?? []).map((row: any) => row.player_id as string)
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
      place: null,
    }));

  if (rowsToInsert.length > 0) {
    const { error: insertError } = await supabase
      .from("tournament_live_entries")
      .insert(rowsToInsert);

    if (insertError) {
      throw new Error(insertError.message);
    }
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

  const { data, error } = await supabase
    .from("tournament_live_entries")
    .select(
      `
      *,
      registrations (
        status
      ),
      players (
        username,
        admin_display_name,
        display_name
      )
    `
    )
    .eq("tournament_id", tournamentId)
    .order("created_at", { ascending: true });

  if (error) {
    throw new Error(error.message);
  }

  return (data ?? []).map((row: any) => {
    const base = mapTournamentLiveEntryRow(row as TournamentLiveEntryRow);
    const player = Array.isArray(row.players) ? row.players[0] : row.players;
    const registration = Array.isArray(row.registrations)
      ? row.registrations[0]
      : row.registrations;

    return {
      ...base,
      display_name: getPreferredPlayerDisplayName(player ?? {}),
      username: player?.username ?? null,
      registration_status:
        (registration?.status as "registered" | "attended") ?? "registered",
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
    const { error } = await supabase
      .from("tournament_live_entries")
      .update({
        arrived: row.arrived,
        rebuys: row.rebuys,
        addons: row.addons,
        knockouts: row.knockouts,
        place: row.place,
        updated_at: new Date().toISOString(),
      })
      .eq("tournament_id", tournamentId)
      .eq("player_id", row.player_id);

    if (error) {
      throw new Error(error.message);
    }
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
    place: number | null;
    sheet_row_number?: number | null;
  }>
) {
  if (rows.length === 0) {
    return getTournamentLiveEntries(tournamentId);
  }

  for (const row of rows) {
    const payload: Record<string, unknown> = {
      arrived: row.arrived,
      rebuys: row.rebuys,
      addons: row.addons,
      knockouts: row.knockouts,
      place: row.place,
      updated_at: new Date().toISOString(),
    };

    if (row.sheet_row_number != null) {
      payload.sheet_row_number = row.sheet_row_number;
    }

    const { error } = await supabase
      .from("tournament_live_entries")
      .update(payload)
      .eq("tournament_id", tournamentId)
      .eq("player_id", row.player_id);

    if (error) {
      throw new Error(error.message);
    }
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

  const { data: tournamentRow, error: tournamentError } = await supabase
    .from("tournaments")
    .select("id, season_id")
    .eq("id", tournamentId)
    .single();

  if (tournamentError) {
    throw new Error(tournamentError.message);
  }

  const { error: deleteError } = await supabase
    .from("results")
    .delete()
    .eq("tournament_id", tournamentId);

  if (deleteError) {
    throw new Error(deleteError.message);
  }

  const payload = liveEntries.map((entry) => ({
    tournament_id: tournamentId,
    player_id: entry.player_id,
    season_id: tournamentRow.season_id ?? null,
    place: entry.place,
    reentries: entry.rebuys,
    knockouts: entry.knockouts,
    rating_points: 0,
  }));

  const { error: insertError } = await supabase.from("results").insert(payload);

  if (insertError) {
    throw new Error(insertError.message);
  }

  const playerIds = liveEntries.map((entry) => entry.player_id);

  const { error: registrationsError } = await supabase
    .from("registrations")
    .update({ status: "attended" })
    .eq("tournament_id", tournamentId)
    .in("player_id", playerIds)
    .in("status", ["registered", "attended"]);

  if (registrationsError) {
    throw new Error(registrationsError.message);
  }

  const { error: tournamentStatusError } = await supabase
    .from("tournaments")
    .update({ status: "completed" })
    .eq("id", tournamentId);

  if (tournamentStatusError) {
    throw new Error(tournamentStatusError.message);
  }

  return {
    completedCount: liveEntries.length,
  };
}

export async function saveTournamentResults(
  tournamentId: string,
  results: TournamentResultInput[]
) {
  const { data: tournamentRow, error: tournamentError } = await supabase
    .from("tournaments")
    .select("id, season_id")
    .eq("id", tournamentId)
    .single();

  if (tournamentError) {
    throw new Error(tournamentError.message);
  }

  const { error: deleteError } = await supabase
    .from("results")
    .delete()
    .eq("tournament_id", tournamentId);

  if (deleteError) {
    throw new Error(deleteError.message);
  }

  const payload = results.map((item) => ({
    tournament_id: tournamentId,
    player_id: item.player_id,
    season_id: tournamentRow.season_id ?? null,
    place: item.place,
    reentries: item.reentries,
    knockouts: item.knockouts,
    rating_points: item.rating_points,
  }));

  const { error: insertError } = await supabase
    .from("results")
    .insert(payload);

  if (insertError) {
    throw new Error(insertError.message);
  }

  const playerIds = results.map((item) => item.player_id);

  if (playerIds.length > 0) {
    const { error: registrationsError } = await supabase
      .from("registrations")
      .update({ status: "attended" })
      .eq("tournament_id", tournamentId)
      .in("player_id", playerIds)
      .in("status", ["registered", "attended"]);

    if (registrationsError) {
      throw new Error(registrationsError.message);
    }
  }

  const { error: tournamentStatusError } = await supabase
    .from("tournaments")
    .update({ status: "completed" })
    .eq("id", tournamentId);

  if (tournamentStatusError) {
    throw new Error(tournamentStatusError.message);
  }

  if (playerIds.length > 0) {
    await syncPlayersAchievements(playerIds);
  }
}

export async function getTournamentNotificationRecipients(tournamentId: string) {
  const { data, error } = await supabase
    .from("registrations")
    .select(
      `
      player_id,
      status,
      players (
        telegram_id,
        display_name
      )
    `
    )
    .eq("tournament_id", tournamentId)
    .in("status", TOURNAMENT_NOTIFICATION_STATUSES);

  if (error) {
    throw new Error(error.message);
  }

  const recipientsMap = new Map<number, TournamentNotificationRecipient>();

  for (const row of data ?? []) {
    const player = Array.isArray((row as any).players)
      ? (row as any).players[0]
      : (row as any).players;

    const telegramId = player?.telegram_id;

    if (typeof telegramId !== "number") {
      continue;
    }

    if (!recipientsMap.has(telegramId)) {
      recipientsMap.set(telegramId, {
        player_id: (row as any).player_id,
        telegram_id: telegramId,
        display_name: getPreferredPlayerDisplayName(player ?? {}),
        registration_status: (row as any).status as RegistrationStatus,
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

  const { data, error } = await supabase
    .from("players")
    .select("id, telegram_id, display_name")
    .eq(accessColumn, true);

  if (error) {
    throw new Error(error.message);
  }

  const recipientsMap = new Map<number, TournamentNotificationRecipient>();

  for (const row of data ?? []) {
    const telegramId = (row as any).telegram_id;

    if (typeof telegramId !== "number") {
      continue;
    }

    if (!recipientsMap.has(telegramId)) {
      recipientsMap.set(telegramId, {
        player_id: (row as any).id,
        telegram_id: telegramId,
        display_name: (row as any).display_name ?? "Игрок",
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
  const { data, error } = await supabase
    .from("results")
    .select(`
      player_id,
      place,
      knockouts,
      reentries,
      rating_points,
      players (
        username,
        display_name
      )
    `)
    .eq("tournament_id", tournamentId)
    .order("place", { ascending: true });

  if (error) {
    throw new Error(error.message);
  }

  return (data ?? []).map((row: any) => {
    const player = Array.isArray(row.players) ? row.players[0] : row.players;

    return {
      player_id: row.player_id,
      place: row.place,
      knockouts: row.knockouts,
      reentries: row.reentries,
      rating_points: row.rating_points,
      username: player?.username ?? null,
      display_name: player?.display_name ?? "Игрок",
    };
  });
}

export async function getSeasonLeaderboard(seasonId: string) {
  const { data, error } = await supabase
    .from("results")
    .select(`
      player_id,
      rating_points,
      players (
        username,
        display_name,
        telegram_avatar_url,
        custom_avatar_url
      )
    `)
    .eq("season_id", seasonId);

  if (error) {
    throw new Error(error.message);
  }

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

  for (const row of data ?? []) {
    const player = Array.isArray((row as any).players)
      ? (row as any).players[0]
      : (row as any).players;

    const existing = leaderboardMap.get(row.player_id);

    if (existing) {
      existing.rating += row.rating_points ?? 0;
    } else {
      leaderboardMap.set(row.player_id, {
        player_id: row.player_id,
        username: player?.username ?? null,
        display_name: player?.display_name ?? "Игрок",
        telegram_avatar_url: player?.telegram_avatar_url ?? null,
        custom_avatar_url: player?.custom_avatar_url ?? null,
        rating: row.rating_points ?? 0,
      });
    }
  }

  return Array.from(leaderboardMap.values()).sort((a, b) => b.rating - a.rating);
}

export async function getActiveSeason() {
  const { data, error } = await supabase
    .from("seasons")
    .select("*")
    .eq("is_active", true)
    .limit(1)
    .single();

  if (error) {
    throw new Error("Активный сезон не найден");
  }

  return data;
}
