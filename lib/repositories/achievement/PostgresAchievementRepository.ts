import "server-only";

import { eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { playerAchievements } from "@/lib/db/schema";
import type { PlayerAchievement } from "@/types/domain";
import type {
  AchievementRepository,
  AchievementSummary,
  AchievementUpsert,
} from "./AchievementRepository";

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// Drizzle/Postgres counterpart of SupabaseAchievementRepository — same
// contract, no new behavior. Same two compensations as the other four
// domains: timestamp columns come back as native Date objects (converted
// to ISO strings to match PlayerAchievement's `string` fields), and
// upsertMany's conflict target mirrors the existing composite unique
// constraint (player_id, achievement_code) exactly as Supabase's
// `onConflict: "player_id,achievement_code"` did.
export class PostgresAchievementRepository implements AchievementRepository {
  async findByPlayerId(playerId: string): Promise<PlayerAchievement[]> {
    const rows = await db
      .select()
      .from(playerAchievements)
      .where(eq(playerAchievements.playerId, playerId));

    return rows.map((row) => ({
      id: row.id,
      player_id: row.playerId,
      achievement_code: row.achievementCode,
      current_value: row.currentValue,
      completed_at: row.completedAt ? row.completedAt.toISOString() : null,
      updated_at: row.updatedAt.toISOString(),
    }));
  }

  async findSummariesByPlayerId(playerId: string): Promise<AchievementSummary[]> {
    const rows = await db
      .select({
        achievement_code: playerAchievements.achievementCode,
        current_value: playerAchievements.currentValue,
        completed_at: playerAchievements.completedAt,
      })
      .from(playerAchievements)
      .where(eq(playerAchievements.playerId, playerId));

    return rows.map((row) => ({
      ...row,
      completed_at: row.completed_at ? row.completed_at.toISOString() : null,
    }));
  }

  async upsertMany(rows: AchievementUpsert[]): Promise<void> {
    if (rows.length === 0) {
      return;
    }

    await db
      .insert(playerAchievements)
      .values(
        rows.map((row) => ({
          playerId: row.player_id,
          achievementCode: row.achievement_code,
          currentValue: row.current_value,
          completedAt: row.completed_at ? new Date(row.completed_at) : null,
          updatedAt: new Date(row.updated_at),
        }))
      )
      .onConflictDoUpdate({
        target: [playerAchievements.playerId, playerAchievements.achievementCode],
        // Supabase's plain `.upsert(rows, { onConflict: "..." })` replaces
        // every non-key column on conflict — `excluded.*` is the row that
        // would have been inserted, the direct Postgres equivalent.
        set: {
          currentValue: sql`excluded.current_value`,
          completedAt: sql`excluded.completed_at`,
          updatedAt: sql`excluded.updated_at`,
        },
      });
  }

  async deleteByPlayerId(playerId: string): Promise<void> {
    try {
      await db.delete(playerAchievements).where(eq(playerAchievements.playerId, playerId));
    } catch (err) {
      throw new Error(`Ошибка удаления достижений: ${errorMessage(err)}`);
    }
  }
}
