import "server-only";

import { and, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { seasonRatingExclusions } from "@/lib/db/schema";
import type {
  SeasonRatingExclusionRepository,
  SeasonRatingExclusionRow,
  SeasonRatingExclusionInsert,
} from "./SeasonRatingExclusionRepository";

function mapRow(row: typeof seasonRatingExclusions.$inferSelect): SeasonRatingExclusionRow {
  return {
    id: row.id,
    season_id: row.seasonId,
    player_id: row.playerId,
    created_by_player_id: row.createdByPlayerId,
    reason: row.reason,
    created_at: row.createdAt.toISOString(),
  };
}

// Postgres-only, following the same recent-domain convention as
// dealer/club-activity/achievement-visual/featured-achievement -- no
// Supabase counterpart.
export class PostgresSeasonRatingExclusionRepository implements SeasonRatingExclusionRepository {
  async listBySeasonId(seasonId: string): Promise<SeasonRatingExclusionRow[]> {
    const rows = await db
      .select()
      .from(seasonRatingExclusions)
      .where(eq(seasonRatingExclusions.seasonId, seasonId));
    return rows.map(mapRow);
  }

  async findBySeasonAndPlayer(seasonId: string, playerId: string): Promise<SeasonRatingExclusionRow | null> {
    const rows = await db
      .select()
      .from(seasonRatingExclusions)
      .where(
        and(
          eq(seasonRatingExclusions.seasonId, seasonId),
          eq(seasonRatingExclusions.playerId, playerId)
        )
      )
      .limit(1);
    const [row] = rows;
    return row ? mapRow(row) : null;
  }

  async create(data: SeasonRatingExclusionInsert): Promise<SeasonRatingExclusionRow> {
    const rows = await db
      .insert(seasonRatingExclusions)
      .values({
        seasonId: data.season_id,
        playerId: data.player_id,
        createdByPlayerId: data.created_by_player_id,
        reason: data.reason,
      })
      .onConflictDoUpdate({
        target: [seasonRatingExclusions.seasonId, seasonRatingExclusions.playerId],
        set: {
          createdByPlayerId: sql`excluded.created_by_player_id`,
          reason: sql`excluded.reason`,
        },
      })
      .returning();
    const [row] = rows;
    if (!row) {
      throw new Error("Failed to create season rating exclusion: no rows returned");
    }
    return mapRow(row);
  }

  async remove(seasonId: string, playerId: string): Promise<void> {
    await db
      .delete(seasonRatingExclusions)
      .where(
        and(
          eq(seasonRatingExclusions.seasonId, seasonId),
          eq(seasonRatingExclusions.playerId, playerId)
        )
      );
  }
}
