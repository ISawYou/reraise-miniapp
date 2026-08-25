import "server-only";

import { getSupabaseServer } from "@/lib/database";
import type {
  TournamentLateRegistrationInsert,
  TournamentLateRegistrationRepository,
  TournamentLateRegistrationRow,
} from "./TournamentLateRegistrationRepository";

// Retained for repository-shape/build compatibility. Production uses the
// Postgres implementation; this feature does not require a Supabase rollout.
export class SupabaseTournamentLateRegistrationRepository
  implements TournamentLateRegistrationRepository
{
  async findByTournamentId(
    tournamentId: string
  ): Promise<TournamentLateRegistrationRow | null> {
    const { data, error } = await getSupabaseServer()
      .from("tournament_late_registration")
      .select("*")
      .eq("tournament_id", tournamentId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return (data as TournamentLateRegistrationRow | null) ?? null;
  }

  async insertIfAbsent(
    row: TournamentLateRegistrationInsert
  ): Promise<TournamentLateRegistrationRow> {
    const { data, error } = await getSupabaseServer()
      .from("tournament_late_registration")
      .upsert(row, { onConflict: "tournament_id", ignoreDuplicates: true })
      .select("*")
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (data) return data as TournamentLateRegistrationRow;

    const existing = await this.findByTournamentId(row.tournament_id);
    if (!existing) {
      throw new Error("Failed to close Late Registration: snapshot was not returned");
    }
    return existing;
  }
}
