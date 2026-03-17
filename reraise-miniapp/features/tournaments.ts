import { supabase } from "@/lib/supabase";
import type {
  Registration,
  RegistrationStatus,
  Tournament,
  TournamentParticipant,
  TournamentResult,
  TournamentResultInput,
  TournamentStatus,
} from "@/types/domain";
import type {
  RegistrationRow,
  TournamentRow,
} from "@/types/database";

function mapTournamentRow(row: TournamentRow): Tournament {
  return {
    id: row.id,
    title: row.title,
    description: row.description ?? undefined,
    location: row.location ?? undefined,
    start_at: row.start_at,
    max_players: row.max_players,
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

  const tournament = await getTournamentById(tournamentId);
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

export async function createTournament(input: {
  title: string;
  description: string;
  location: string;
  start_at: string;
  max_players: number;
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
        display_name
      )
    `)
    .eq("tournament_id", tournamentId)
    .in("status", ["registered", "attended"])
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
      display_name: player?.display_name ?? "Игрок",
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
      display_name: player?.display_name ?? "Игрок",
      status: row.status as "registered" | "attended",
    };
  });
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
        display_name
      )
    `)
    .eq("season_id", seasonId);

  if (error) {
    throw new Error(error.message);
  }

  const leaderboardMap = new Map<
    string,
    { player_id: string; username: string | null; display_name: string; rating: number }
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