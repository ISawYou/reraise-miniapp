import "server-only";

import { getSupabaseServer } from "@/lib/database";
import type { Tournament, TournamentStatus } from "@/types/domain";
import type { TournamentRow } from "@/types/database";
import type {
  TournamentRepository,
  TournamentInsert,
  TournamentPatch,
} from "./TournamentRepository";

// Moved here from features/tournaments.ts, where it lived next to the
// queries it now replaces. Duplicated (intentionally) in
// SupabaseResultRepository for the one results-primary query that embeds
// a full tournament row — see that file's comment.
//
// `row.is_final ?? false`: defensive default only, same as
// rating_formula_version/rating_guarantee above it -- this repository is
// legacy/compatibility code, not a live production path (Postgres is the
// only current provider, selected by DATABASE_PROVIDER -- see
// lib/repositories/tournament/index.ts), so this isn't covering a real
// schema gap, just normal null-safety for an unexpectedly missing field.
export function mapTournamentRow(row: TournamentRow): Tournament {
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

// Current, active implementation — wraps the exact same Supabase queries
// that were previously spread across features/tournaments.ts and
// app/api/admin/tournaments/route.ts. No new behavior.
export class SupabaseTournamentRepository implements TournamentRepository {
  async findById(tournamentId: string): Promise<Tournament> {
    const supabase = getSupabaseServer();
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

  async findSeasonIdById(
    tournamentId: string
  ): Promise<{ id: string; season_id: string | null }> {
    const supabase = getSupabaseServer();
    const { data, error } = await supabase
      .from("tournaments")
      .select("id, season_id")
      .eq("id", tournamentId)
      .single();

    if (error) {
      throw new Error(error.message);
    }

    return data as { id: string; season_id: string | null };
  }

  async listOpen(): Promise<Tournament[]> {
    const supabase = getSupabaseServer();
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

  async listCompleted(): Promise<Tournament[]> {
    const supabase = getSupabaseServer();
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

  async listExcludingStatus(status: TournamentStatus): Promise<Tournament[]> {
    const supabase = getSupabaseServer();
    const { data, error } = await supabase
      .from("tournaments")
      .select("*")
      .neq("status", status)
      .order("start_at", { ascending: true });

    if (error) {
      throw new Error(error.message);
    }

    return (data ?? []).map((row) => mapTournamentRow(row as TournamentRow));
  }

  async listByStatuses(statuses: TournamentStatus[]): Promise<Tournament[]> {
    const supabase = getSupabaseServer();
    const { data, error } = await supabase
      .from("tournaments")
      .select("*")
      .in("status", statuses)
      .order("start_at", { ascending: false });

    if (error) {
      throw new Error(error.message);
    }

    return (data ?? []).map((row) => mapTournamentRow(row as TournamentRow));
  }

  async create(data: TournamentInsert): Promise<Tournament> {
    const supabase = getSupabaseServer();
    const { data: row, error } = await supabase
      .from("tournaments")
      .insert(data)
      .select("*")
      .single();

    if (error) {
      throw new Error(error.message);
    }

    return mapTournamentRow(row as TournamentRow);
  }

  async update(tournamentId: string, patch: TournamentPatch): Promise<Tournament> {
    const supabase = getSupabaseServer();
    const { data, error } = await supabase
      .from("tournaments")
      .update(patch)
      .eq("id", tournamentId)
      .select("*")
      .single();

    if (error) {
      throw new Error(error.message);
    }

    return mapTournamentRow(data as TournamentRow);
  }

  async patch(tournamentId: string, patch: TournamentPatch): Promise<void> {
    const supabase = getSupabaseServer();
    const { error } = await supabase
      .from("tournaments")
      .update(patch)
      .eq("id", tournamentId);

    if (error) {
      throw new Error(error.message);
    }
  }

  async delete(tournamentId: string): Promise<void> {
    const supabase = getSupabaseServer();
    const { error } = await supabase
      .from("tournaments")
      .delete()
      .eq("id", tournamentId);

    if (error) {
      throw new Error(error.message);
    }
  }
}
