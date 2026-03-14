import { supabase } from "@/lib/supabase";
import type { Tournament, RegistrationStatus } from "@/types/domain";
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
  const { data: existing } = await supabase
    .from("registrations")
    .select("*")
    .eq("player_id", playerId)
    .eq("tournament_id", tournamentId)
    .in("status", ["registered", "waitlist"])
    .maybeSingle();

  if (existing) {
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