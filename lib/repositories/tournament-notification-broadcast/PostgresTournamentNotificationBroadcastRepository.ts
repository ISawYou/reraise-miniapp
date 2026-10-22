import "server-only";

import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { tournamentNotificationBroadcasts } from "@/lib/db/schema";
import type {
  TournamentNotificationBroadcastClaim,
  TournamentNotificationBroadcastClaimResult,
  TournamentNotificationBroadcastCounts,
  TournamentNotificationBroadcastError,
  TournamentNotificationBroadcastRepository,
  TournamentNotificationBroadcastRow,
  TournamentNotificationBroadcastStatus,
} from "./TournamentNotificationBroadcastRepository";

function toRow(row: typeof tournamentNotificationBroadcasts.$inferSelect): TournamentNotificationBroadcastRow {
  return {
    id: row.id,
    broadcast_id: row.broadcastId,
    payload_fingerprint: row.payloadFingerprint,
    tournament_id: row.tournamentId,
    audience: row.audience === "access" ? "access" : "registered",
    test_mode: row.testMode,
    status: row.status as TournamentNotificationBroadcastStatus,
    total_recipients: row.totalRecipients,
    success_count: row.successCount,
    failed_count: row.failedCount,
    skipped_count: row.skippedCount,
    errors: Array.isArray(row.errors) ? (row.errors as TournamentNotificationBroadcastError[]) : [],
    created_at: row.createdAt.toISOString(),
    completed_at: row.completedAt ? row.completedAt.toISOString() : null,
  };
}

// Postgres-only (no Supabase counterpart), same convention as
// season-rating-exclusion / player-merge-intent.
export class PostgresTournamentNotificationBroadcastRepository implements TournamentNotificationBroadcastRepository {
  async findByBroadcastId(broadcastId: string): Promise<TournamentNotificationBroadcastRow | null> {
    const [row] = await db
      .select()
      .from(tournamentNotificationBroadcasts)
      .where(eq(tournamentNotificationBroadcasts.broadcastId, broadcastId))
      .limit(1);
    return row ? toRow(row) : null;
  }

  async claim(data: TournamentNotificationBroadcastClaim): Promise<TournamentNotificationBroadcastClaimResult> {
    // Single statement, autocommit. The unique index on broadcast_id makes
    // this the race arbiter: a concurrent INSERT of the same broadcast_id
    // waits for this one to commit and then hits DO NOTHING (zero rows
    // returned). Never SELECT-then-INSERT.
    const inserted = await db
      .insert(tournamentNotificationBroadcasts)
      .values({
        broadcastId: data.broadcast_id,
        payloadFingerprint: data.payload_fingerprint,
        tournamentId: data.tournament_id,
        audience: data.audience,
        testMode: data.test_mode,
        status: "processing",
        totalRecipients: data.total_recipients,
        skippedCount: data.skipped_count,
      })
      .onConflictDoNothing({ target: tournamentNotificationBroadcasts.broadcastId })
      .returning();

    const [row] = inserted;
    if (row) {
      return { claimed: true, row: toRow(row) };
    }

    const existing = await this.findByBroadcastId(data.broadcast_id);
    if (!existing) {
      // Only reachable if the conflicting row vanished between the two
      // statements (tournament deleted -> cascade). Fail closed: never
      // treat this as a successful claim.
      throw new Error("Broadcast claim conflicted but the existing row could not be read");
    }
    return { claimed: false, existing };
  }

  async markCompleted(broadcastId: string, counts: TournamentNotificationBroadcastCounts): Promise<boolean> {
    return this.finish(broadcastId, "completed", counts);
  }

  async markFailed(broadcastId: string, counts: TournamentNotificationBroadcastCounts): Promise<boolean> {
    return this.finish(broadcastId, "failed", counts);
  }

  private async finish(
    broadcastId: string,
    status: Exclude<TournamentNotificationBroadcastStatus, "processing">,
    counts: TournamentNotificationBroadcastCounts
  ): Promise<boolean> {
    const updated = await db
      .update(tournamentNotificationBroadcasts)
      .set({
        status,
        successCount: counts.success_count,
        failedCount: counts.failed_count,
        skippedCount: counts.skipped_count,
        errors: counts.errors,
        completedAt: new Date(),
      })
      .where(
        and(
          eq(tournamentNotificationBroadcasts.broadcastId, broadcastId),
          eq(tournamentNotificationBroadcasts.status, "processing")
        )
      )
      .returning({ id: tournamentNotificationBroadcasts.id });
    return updated.length > 0;
  }
}
