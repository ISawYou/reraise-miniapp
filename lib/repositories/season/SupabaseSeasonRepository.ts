import "server-only";

import { getSupabaseServer } from "@/lib/database";
import type { SeasonRepository, SeasonRow, SeasonFullRow, SeasonInsert } from "./SeasonRepository";

// Current, active implementation — wraps the exact same
// "is_active=true, limit 1" query that used to be duplicated across
// features/tournaments.ts, app/api/leaderboard/route.ts and
// app/api/admin/tournaments/route.ts, each with a different select list.
// select("*") is a superset of every one of those, so a single method
// covers all of them without changing what's returned to any caller.
export class SupabaseSeasonRepository implements SeasonRepository {
  async findActive(): Promise<SeasonRow | null> {
    const supabase = getSupabaseServer();
    const { data, error } = await supabase
      .from("seasons")
      .select("*")
      .eq("is_active", true)
      .limit(1)
      .maybeSingle();

    if (error) {
      throw new Error(error.message);
    }

    return data ?? null;
  }

  async listAll(): Promise<SeasonFullRow[]> {
    const supabase = getSupabaseServer();
    const { data, error } = await supabase.from("seasons").select("*");

    if (error) {
      throw new Error(error.message);
    }

    return (data ?? []) as SeasonFullRow[];
  }

  async create(data: SeasonInsert): Promise<void> {
    const supabase = getSupabaseServer();
    const { error } = await supabase.from("seasons").upsert(data, { onConflict: "id" });

    if (error) {
      throw new Error(error.message);
    }
  }
}
