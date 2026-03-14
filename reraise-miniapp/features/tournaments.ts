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