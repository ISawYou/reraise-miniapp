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
  AttendanceStatus,
  AttendanceUpsert,
  AttendanceWriteResult,
  AttendedPlayerRow,
  RebuyState,
  RebuyStateUpsert,
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

  async findAttendanceByTournamentId(
    tournamentId: string
  ): Promise<Map<string, AttendanceStatus>> {
    const supabase = getSupabaseServer();
    const { data, error } = await supabase
      .from("tournament_attendance")
      .select("player_id, arrived, arrived_at")
      .eq("tournament_id", tournamentId);

    if (error) {
      throw new Error(error.message);
    }

    type AttendanceRow = { player_id: string; arrived: boolean; arrived_at: string | null };

    return new Map(
      (data ?? []).map((row: AttendanceRow) => [
        row.player_id,
        {
          arrived: row.arrived,
          arrived_at: row.arrived_at,
        },
      ])
    );
  }

  // Supabase's PostgREST/JS-client .upsert() can only do an unconditional
  // column overwrite on conflict -- it has no way to express "arrived_at =
  // COALESCE(the row's own current value, now())" in one round-trip, which
  // is what keeps arrived_at's "first arrival time" computation race-free
  // even under two genuinely concurrent cross-tab writes (no separate
  // SELECT before the write). `arrived` itself is just unconditionally
  // overwritten either way -- last-processed-wins is an accepted, explicit
  // product decision for this admin checkbox, not something being guarded
  // against (see AttendanceUpsert's doc comment). Calls the atomic upsert
  // as a Postgres function -- see
  // sql/tournament_attendance.sql::upsert_tournament_attendance, kept in
  // sync by hand with PostgresTournamentLiveStateRepository.ts's Drizzle
  // version. Must be applied to the Supabase project before this call site
  // works (same manual-apply caveat as that table's own CREATE TABLE).
  async upsertAttendance(row: AttendanceUpsert): Promise<AttendanceWriteResult> {
    const supabase = getSupabaseServer();
    const { data, error } = await supabase
      .rpc("upsert_tournament_attendance", {
        p_tournament_id: row.tournament_id,
        p_player_id: row.player_id,
        p_arrived: row.arrived,
      })
      .single();

    if (error) {
      throw new Error(error.message);
    }

    const result = data as { arrived: boolean; arrived_at: string | null };

    return {
      arrived: result.arrived,
      arrived_at: result.arrived_at,
    };
  }

  async findAttendedPlayersWithDetails(tournamentId: string): Promise<AttendedPlayerRow[]> {
    const supabase = getSupabaseServer();
    const { data, error } = await supabase
      .from("tournament_attendance")
      .select(
        `
        player_id,
        arrived_at,
        players (
          display_name,
          admin_display_name,
          custom_avatar_url,
          telegram_avatar_url
        )
      `
      )
      .eq("tournament_id", tournamentId)
      .eq("arrived", true);

    if (error) {
      throw new Error(error.message);
    }

    type RawAttendedPlayerRow = Omit<AttendedPlayerRow, "players"> & { players: unknown };

    return (data ?? []).map((row: RawAttendedPlayerRow) => ({
      ...row,
      players: flattenEmbedded(row.players) as AttendedPlayerRow["players"],
    }));
  }

  async findRebuyStateByTournamentId(tournamentId: string): Promise<Map<string, RebuyState>> {
    const supabase = getSupabaseServer();
    const { data, error } = await supabase
      .from("tournament_rebuy_state")
      .select("player_id, rebuys, addons")
      .eq("tournament_id", tournamentId);

    if (error) {
      throw new Error(error.message);
    }

    type RebuyStateRow = { player_id: string; rebuys: number; addons: number };

    return new Map(
      (data ?? []).map((row: RebuyStateRow) => [
        row.player_id,
        { rebuys: row.rebuys, addons: row.addons },
      ])
    );
  }

  // Plain overwrite on conflict -- unlike upsertAttendance's arrived_at,
  // neither rebuys nor addons needs a COALESCE-against-current-value, so
  // Supabase's ordinary .upsert() (no RPC function required, unlike
  // tournament_attendance) is enough.
  async upsertRebuyState(row: RebuyStateUpsert): Promise<RebuyState> {
    const supabase = getSupabaseServer();
    const { data, error } = await supabase
      .from("tournament_rebuy_state")
      .upsert(
        {
          tournament_id: row.tournament_id,
          player_id: row.player_id,
          rebuys: row.rebuys,
          addons: row.addons,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "tournament_id,player_id" }
      )
      .select("rebuys, addons")
      .single();

    if (error) {
      throw new Error(error.message);
    }

    return data as RebuyState;
  }
}
