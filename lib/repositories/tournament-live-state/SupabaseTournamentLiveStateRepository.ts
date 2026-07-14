import "server-only";

import { getSupabaseServer } from "@/lib/database";
import type { TournamentPlayerEliminationRow } from "@/types/database";
import type {
  TournamentLiveStateRepository,
  LiveEntryInsert,
  LiveEntryPatch,
  LiveEntryWithDetailsRow,
  EliminationStatus,
  EliminationUpsert,
} from "./TournamentLiveStateRepository";

function flattenEmbedded<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) {
    return value[0] ?? null;
  }
  return value ?? null;
}

// Current, active implementation — wraps the exact same Supabase queries
// that were previously spread across features/tournaments.ts and
// features/admin.ts (cascading delete). No new behavior.
export class SupabaseTournamentLiveStateRepository
  implements TournamentLiveStateRepository
{
  async findPlayerIdsWithLiveEntry(tournamentId: string): Promise<string[]> {
    const supabase = getSupabaseServer();
    const { data, error } = await supabase
      .from("tournament_live_entries")
      .select("player_id")
      .eq("tournament_id", tournamentId);

    if (error) {
      throw new Error(error.message);
    }

    return (data ?? []).map((row: { player_id: string }) => row.player_id);
  }

  async insertLiveEntries(rows: LiveEntryInsert[]): Promise<void> {
    const supabase = getSupabaseServer();
    const { error } = await supabase.from("tournament_live_entries").insert(rows);

    if (error) {
      throw new Error(error.message);
    }
  }

  async findLiveEntriesWithDetails(
    tournamentId: string
  ): Promise<LiveEntryWithDetailsRow[]> {
    const supabase = getSupabaseServer();
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

    type RawLiveEntryRow = Omit<LiveEntryWithDetailsRow, "registrations" | "players"> & {
      registrations: unknown;
      players: unknown;
    };

    return (data ?? []).map((row: RawLiveEntryRow) => ({
      ...row,
      registrations: flattenEmbedded(row.registrations),
      players: flattenEmbedded(row.players),
    })) as LiveEntryWithDetailsRow[];
  }

  async updateLiveEntry(
    tournamentId: string,
    playerId: string,
    patch: LiveEntryPatch
  ): Promise<void> {
    const supabase = getSupabaseServer();
    const { error } = await supabase
      .from("tournament_live_entries")
      .update(patch)
      .eq("tournament_id", tournamentId)
      .eq("player_id", playerId);

    if (error) {
      throw new Error(error.message);
    }
  }

  async deleteLiveEntriesByPlayerId(playerId: string): Promise<void> {
    const supabase = getSupabaseServer();
    const { error } = await supabase
      .from("tournament_live_entries")
      .delete()
      .eq("player_id", playerId);

    if (error) {
      throw new Error(`Ошибка удаления live-записей: ${error.message}`);
    }
  }

  async findEliminationsByTournamentId(
    tournamentId: string
  ): Promise<Map<string, EliminationStatus>> {
    const supabase = getSupabaseServer();
    const { data, error } = await supabase
      .from("tournament_player_eliminations")
      .select("player_id, eliminated, eliminated_at")
      .eq("tournament_id", tournamentId);

    if (error) {
      throw new Error(error.message);
    }

    type EliminationRow = { player_id: string; eliminated: boolean; eliminated_at: string | null };

    return new Map(
      (data ?? []).map((row: EliminationRow) => [
        row.player_id,
        {
          eliminated: row.eliminated,
          eliminated_at: row.eliminated_at,
        },
      ])
    );
  }

  async findEliminatedAtByTournamentAndPlayer(
    tournamentId: string,
    playerId: string
  ): Promise<string | null> {
    const supabase = getSupabaseServer();
    const { data, error } = await supabase
      .from("tournament_player_eliminations")
      .select("eliminated_at")
      .eq("tournament_id", tournamentId)
      .eq("player_id", playerId)
      .maybeSingle();

    if (error) {
      throw new Error(error.message);
    }

    return (data as TournamentPlayerEliminationRow | null)?.eliminated_at ?? null;
  }

  async upsertElimination(row: EliminationUpsert): Promise<void> {
    const supabase = getSupabaseServer();
    const { error } = await supabase
      .from("tournament_player_eliminations")
      .upsert(row, { onConflict: "tournament_id,player_id" });

    if (error) {
      throw new Error(error.message);
    }
  }
}
