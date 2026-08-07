import "server-only";

import { getSupabaseServer } from "@/lib/database";
import type {
  TournamentMysteryBountyRepository,
  MysteryBountyRow,
  MysteryBountyInsert,
  MysteryBountyPatch,
} from "./TournamentMysteryBountyRepository";

export class SupabaseTournamentMysteryBountyRepository
  implements TournamentMysteryBountyRepository
{
  async findByTournamentId(tournamentId: string): Promise<MysteryBountyRow | null> {
    const supabase = getSupabaseServer();
    const { data, error } = await supabase
      .from("tournament_mystery_bounty")
      .select("*")
      .eq("tournament_id", tournamentId)
      .maybeSingle();

    if (error) {
      throw new Error(error.message);
    }

    return (data as MysteryBountyRow | null) ?? null;
  }

  async insert(data: MysteryBountyInsert): Promise<MysteryBountyRow> {
    const supabase = getSupabaseServer();
    const { data: row, error } = await supabase
      .from("tournament_mystery_bounty")
      .insert(data)
      .select("*")
      .single();

    if (error) {
      throw new Error(error.message);
    }

    return row as MysteryBountyRow;
  }

  async update(tournamentId: string, patch: MysteryBountyPatch): Promise<MysteryBountyRow> {
    const supabase = getSupabaseServer();
    const { data: row, error } = await supabase
      .from("tournament_mystery_bounty")
      .update(patch)
      .eq("tournament_id", tournamentId)
      .select("*")
      .single();

    if (error) {
      throw new Error(error.message);
    }

    return row as MysteryBountyRow;
  }
}
