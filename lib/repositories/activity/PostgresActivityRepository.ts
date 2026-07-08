import "server-only";

import { desc, eq, gte } from "drizzle-orm";
import { db } from "@/lib/db";
import { activityEvents } from "@/lib/db/schema";
import type {
  ActivityRepository,
  ActivityEventInsert,
  ActivityEventDetail,
  ActivityEventSummary,
} from "./ActivityRepository";

// Drizzle/Postgres counterpart of SupabaseActivityRepository. All three
// methods there never checked `.error` — activity logging is deliberately
// non-critical (see lib/activity-logger.ts, which already wraps its own
// call in try/catch). Replicated the same silent-swallow here rather than
// letting Drizzle throw, so a Postgres connection hiccup can't newly turn
// "activity logging failed" into an unhandled rejection somewhere that
// today tolerates it silently.
//
// timestamp columns come back from postgres-js as native Date objects, not
// the ISO strings Supabase/PostgREST serializes over JSON — every
// `created_at` the interface types as `string` needs an explicit
// .toISOString() to keep the contract identical regardless of backend.
export class PostgresActivityRepository implements ActivityRepository {
  async create(event: ActivityEventInsert): Promise<void> {
    try {
      await db.insert(activityEvents).values({
        playerId: event.player_id,
        eventType: event.event_type,
        eventLabel: event.event_label,
        metadata: event.metadata,
        platform: event.platform,
        sessionId: event.session_id,
      });
    } catch {
      // Silently ignored — matches the Supabase implementation.
    }
  }

  async findByPlayerId(playerId: string, limit: number): Promise<ActivityEventDetail[]> {
    try {
      const rows = await db
        .select({
          event_type: activityEvents.eventType,
          event_label: activityEvents.eventLabel,
          metadata: activityEvents.metadata,
          platform: activityEvents.platform,
          session_id: activityEvents.sessionId,
          created_at: activityEvents.createdAt,
        })
        .from(activityEvents)
        .where(eq(activityEvents.playerId, playerId))
        .orderBy(desc(activityEvents.createdAt))
        .limit(limit);

      return rows.map((row) => ({ ...row, created_at: row.created_at.toISOString() }));
    } catch {
      return [];
    }
  }

  async findSince(sinceIso: string, limit: number): Promise<ActivityEventSummary[]> {
    try {
      const rows = await db
        .select({
          player_id: activityEvents.playerId,
          event_type: activityEvents.eventType,
          created_at: activityEvents.createdAt,
        })
        .from(activityEvents)
        .where(gte(activityEvents.createdAt, new Date(sinceIso)))
        .orderBy(desc(activityEvents.createdAt))
        .limit(limit);

      return rows.map((row) => ({ ...row, created_at: row.created_at.toISOString() }));
    } catch {
      return [];
    }
  }
}
