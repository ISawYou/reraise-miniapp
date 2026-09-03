import "server-only";

import { desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { playerMergeIntents } from "@/lib/db/schema";
import type {
  PlayerMergeIntentRepository,
  PlayerMergeIntentRow,
  PlayerMergeIntentInsert,
  MergeIntentStatus,
} from "./PlayerMergeIntentRepository";

function toRow(row: typeof playerMergeIntents.$inferSelect): PlayerMergeIntentRow {
  return {
    id: row.id,
    target_player_id: row.targetPlayerId,
    source_player_id: row.sourcePlayerId,
    email: row.email,
    otp_verification_id: row.otpVerificationId,
    status: row.status as MergeIntentStatus,
    conflict_reason: row.conflictReason,
    expires_at: row.expiresAt.toISOString(),
    created_at: row.createdAt.toISOString(),
    resolved_at: row.resolvedAt ? row.resolvedAt.toISOString() : null,
  };
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export class PostgresPlayerMergeIntentRepository implements PlayerMergeIntentRepository {
  async findById(id: string): Promise<PlayerMergeIntentRow | null> {
    try {
      const [row] = await db
        .select()
        .from(playerMergeIntents)
        .where(eq(playerMergeIntents.id, id))
        .limit(1);

      return row ? toRow(row) : null;
    } catch (err) {
      throw new Error(`Failed to load merge intent: ${errorMessage(err)}`);
    }
  }

  async create(data: PlayerMergeIntentInsert): Promise<PlayerMergeIntentRow> {
    try {
      const [row] = await db
        .insert(playerMergeIntents)
        .values({
          targetPlayerId: data.target_player_id,
          sourcePlayerId: data.source_player_id,
          email: data.email,
          otpVerificationId: data.otp_verification_id,
          status: data.status,
          conflictReason: data.conflict_reason,
          expiresAt: new Date(data.expires_at),
        })
        .returning();

      return toRow(row);
    } catch (err) {
      throw new Error(`Failed to create merge intent: ${errorMessage(err)}`);
    }
  }

  async listConflicts(): Promise<PlayerMergeIntentRow[]> {
    try {
      const rows = await db
        .select()
        .from(playerMergeIntents)
        .where(eq(playerMergeIntents.status, "conflict"))
        .orderBy(desc(playerMergeIntents.createdAt));

      return rows.map(toRow);
    } catch (err) {
      throw new Error(`Failed to list merge conflicts: ${errorMessage(err)}`);
    }
  }
}
