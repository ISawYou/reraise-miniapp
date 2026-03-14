import { supabase } from "@/lib/supabase";
import type { Tournament } from "@/types/domain";
import type { TournamentRow } from "@/types/database";

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
    .maybeSingle();

  if (existing) {
    return existing;
  }

  const { count } = await supabase
    .from("registrations")
    .select("*", { count: "exact", head: true })
    .eq("tournament_id", tournamentId)
    .in("status", ["registered", "attended"]);

  const { data: tournament } = await supabase
    .from("tournaments")
    .select("*")
    .eq("id", tournamentId)
    .single();

  if (!tournament) {
    throw new Error("Tournament not found");
  }

  const status =
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