import "server-only";

import { getSupabaseServer } from "@/lib/database";
import type {
  SeasonRepository,
  SeasonRow,
  SeasonFullRow,
  SeasonInsert,
  SeasonCreateInput,
  SeasonUpdateInput,
} from "./SeasonRepository";

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

  async setActive(seasonId: string, isActive: boolean): Promise<void> {
    const supabase = getSupabaseServer();
    const { error } = await supabase
      .from("seasons")
      .update({ is_active: isActive })
      .eq("id", seasonId);

    if (error) {
      throw new Error(error.message);
    }
  }

  async insert(data: SeasonCreateInput): Promise<SeasonFullRow> {
    const supabase = getSupabaseServer();
    const { data: row, error } = await supabase
      .from("seasons")
      .insert({ title: data.title, start_date: data.start_date, end_date: data.end_date, is_active: data.is_active })
      .select()
      .single();

    if (error) {
      throw new Error(error.message);
    }

    return row as SeasonFullRow;
  }

  async update(seasonId: string, patch: SeasonUpdateInput): Promise<SeasonFullRow> {
    const supabase = getSupabaseServer();
    const { data: row, error } = await supabase
      .from("seasons")
      .update(patch)
      .eq("id", seasonId)
      .select()
      .single();

    if (error) {
      throw new Error(error.message);
    }

    return row as SeasonFullRow;
  }

  // Not a real transaction -- the supabase-js client has no multi-statement
  // transaction primitive without a bespoke RPC function, and this
  // repository is the legacy/local-dev fallback (production runs
  // DATABASE_PROVIDER=postgres, see PostgresSeasonRepository.setActivePair
  // for the transactional version the app actually deploys with). Best
  // effort: deactivate first, then activate, same ordering so a failure
  // between the two still can't leave two seasons active at once.
  async setActivePair(deactivateId: string | null, activateId: string): Promise<void> {
    const supabase = getSupabaseServer();

    if (deactivateId) {
      const { error } = await supabase.from("seasons").update({ is_active: false }).eq("id", deactivateId);
      if (error) {
        throw new Error(error.message);
      }
    }

    const { error } = await supabase.from("seasons").update({ is_active: true }).eq("id", activateId);
    if (error) {
      throw new Error(error.message);
    }
  }
}
