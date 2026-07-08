import "server-only";

import { getSupabaseServer } from "@/lib/database";
import type {
  ActivityRepository,
  ActivityEventInsert,
  ActivityEventDetail,
  ActivityEventSummary,
} from "./ActivityRepository";

// Current, active implementation — wraps the exact same Supabase queries
// lib/activity-logger.ts and app/api/admin/activity/route.ts used to call
// directly. No new behavior: read errors are still silently ignored
// (both call sites only ever read `data`, never `error`), matching today.
export class SupabaseActivityRepository implements ActivityRepository {
  async create(event: ActivityEventInsert): Promise<void> {
    const db = getSupabaseServer();
    await db.from("activity_events").insert(event);
  }

  async findByPlayerId(
    playerId: string,
    limit: number
  ): Promise<ActivityEventDetail[]> {
    const db = getSupabaseServer();
    const { data } = await db
      .from("activity_events")
      .select("event_type, event_label, metadata, platform, session_id, created_at")
      .eq("player_id", playerId)
      .order("created_at", { ascending: false })
      .limit(limit);
    return (data ?? []) as ActivityEventDetail[];
  }

  async findSince(
    sinceIso: string,
    limit: number
  ): Promise<ActivityEventSummary[]> {
    const db = getSupabaseServer();
    const { data } = await db
      .from("activity_events")
      .select("player_id, event_type, created_at")
      .gte("created_at", sinceIso)
      .order("created_at", { ascending: false })
      .limit(limit);
    return (data ?? []) as ActivityEventSummary[];
  }
}
