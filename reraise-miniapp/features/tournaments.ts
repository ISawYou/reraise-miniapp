import { supabase } from "@/lib/supabase";
import type {
  Tournament,
  RegistrationStatus,
  Registration,
} from "@/types/domain";
import type { TournamentRow, RegistrationRow } from "@/types/database";

function mapTournamentRow(row: TournamentRow): Tournament {
  return {
    id: row.id,
    title: row.title,
    start_at: row.start_at,
    max_players: row.max_players,
    status: row.status,
    created_at: row.created_at,
  };
}

function mapRegistrationRow(row: RegistrationRow): Registration {
  return {
    id: row.id,
    player_id: row.player_id,
    tournament_id: row.tournament_id,
    status: row.status,
    created_at: row.created_at,
  };
}

export async function getOpenTournaments(): Promise<Tournament[]> {
  const { data, error } = await supabase
    .from("tournaments")
    .select("*")
    .eq("status", "open")
    .order("start_at", { ascending: true });

  if (error) {
    throw new Error(`Failed to load tournaments: ${error.message}`);
  }

  if (!data) {
    return [];
  }

  return data.map((row) => mapTournamentRow(row as TournamentRow));
}

export async function registerPlayerForTournament(
  playerId: string,
  tournamentId: string
) {
  const { data: existing, error: existingError } = await supabase
    .from("registrations")
    .select("*")
    .eq("player_id", playerId)
    .eq("tournament_id", tournamentId)
    .maybeSingle();

  if (existingError) {
    throw new Error(existingError.message);
  }

  if (
    existing &&
    (existing.status === "registered" || existing.status === "waitlist")
  ) {
    return existing;
  }

  const { count, error: countError } = await supabase
    .from("registrations")
    .select("*", { count: "exact", head: true })
    .eq("tournament_id", tournamentId)
    .in("status", ["registered", "attended"]);

  if (countError) {
    throw new Error(countError.message);
  }

  const { data: tournament, error: tournamentError } = await supabase
    .from("tournaments")
    .select("*")
    .eq("id", tournamentId)
    .single();

  if (tournamentError) {
    throw new Error(tournamentError.message);
  }

  if (!tournament) {
    throw new Error("Tournament not found");
  }

  const status: RegistrationStatus =
    (count ?? 0) < tournament.max_players ? "registered" : "waitlist";

  if (existing && existing.status === "cancelled") {
    const { data, error } = await supabase
      .from("registrations")
      .update({ status })
      .eq("id", existing.id)
      .select("*")
      .single();

    if (error) {
      throw new Error(error.message);
    }

    return data;
  }

  const { data, error } = await supabase
    .from("registrations")
    .insert({
      player_id: playerId,
      tournament_id: tournamentId,
      status,
    })
    .select("*")
    .single();

  if (error) {
    throw new Error(error.message);
  }

  return data;
}

export async function cancelPlayerRegistration(
  playerId: string,
  tournamentId: string
) {
  const { data: existing, error: existingError } = await supabase
    .from("registrations")
    .select("*")
    .eq("player_id", playerId)
    .eq("tournament_id", tournamentId)
    .in("status", ["registered", "waitlist"])
    .maybeSingle();

  if (existingError) {
    throw new Error(existingError.message);
  }

  if (!existing) {
    throw new Error("Active registration not found");
  }

  const previousStatus = existing.status;

  const { error: cancelError } = await supabase
    .from("registrations")
    .update({ status: "cancelled" })
    .eq("id", existing.id);

  if (cancelError) {
    throw new Error(cancelError.message);
  }

  if (previousStatus === "registered") {
    const { data: nextWaitlistPlayer, error: waitlistError } = await supabase
      .from("registrations")
      .select("*")
      .eq("tournament_id", tournamentId)
      .eq("status", "waitlist")
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();

    if (waitlistError) {
      throw new Error(waitlistError.message);
    }

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

  return { success: true };
}

export async function getPlayerRegistrations(playerId: string) {
  const { data, error } = await supabase
    .from("registrations")
    .select("*")
    .eq("player_id", playerId)
    .in("status", ["registered", "waitlist"]);

  if (error) {
    throw new Error(error.message);
  }

  return (data ?? []) as RegistrationRow[];
}

export async function getTournamentRegistrationCounts() {
  const { data, error } = await supabase
    .from("registrations")
    .select("tournament_id, status")
    .in("status", ["registered", "attended"]);

  if (error) {
    throw new Error(error.message);
  }

  const counts: Record<string, number> = {};

  (data ?? []).forEach((row) => {
    const tournamentId = row.tournament_id;
    counts[tournamentId] = (counts[tournamentId] ?? 0) + 1;
  });

  return counts;
}

export async function getTournamentsByIds(
  tournamentIds: string[]
): Promise<Tournament[]> {
  if (tournamentIds.length === 0) {
    return [];
  }

  const { data, error } = await supabase
    .from("tournaments")
    .select("*")
    .in("id", tournamentIds)
    .order("start_at", { ascending: true });

  if (error) {
    throw new Error(`Failed to load tournaments by ids: ${error.message}`);
  }

  return (data ?? []).map((row) => mapTournamentRow(row as TournamentRow));
}

export async function getMyTournaments(playerId: string) {
  const registrations = (await getPlayerRegistrations(playerId)).map((row) =>
    mapRegistrationRow(row as RegistrationRow)
  );

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