import "server-only";

import { and, count, desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { follows, players } from "@/lib/db/schema";
import type { FollowPlayerSummary, FollowRepository } from "./FollowRepository";

const playerSummarySelection = {
  id: players.id,
  display_name: players.displayName,
  telegram_avatar_url: players.telegramAvatarUrl,
  custom_avatar_url: players.customAvatarUrl,
};

export class PostgresFollowRepository implements FollowRepository {
  async create(followerPlayerId: string, followedPlayerId: string): Promise<void> {
    await db
      .insert(follows)
      .values({ followerPlayerId, followedPlayerId })
      .onConflictDoNothing({ target: [follows.followerPlayerId, follows.followedPlayerId] });
  }

  async delete(followerPlayerId: string, followedPlayerId: string): Promise<void> {
    await db
      .delete(follows)
      .where(and(
        eq(follows.followerPlayerId, followerPlayerId),
        eq(follows.followedPlayerId, followedPlayerId),
      ));
  }

  async exists(followerPlayerId: string, followedPlayerId: string): Promise<boolean> {
    const [row] = await db
      .select({ id: follows.id })
      .from(follows)
      .where(and(
        eq(follows.followerPlayerId, followerPlayerId),
        eq(follows.followedPlayerId, followedPlayerId),
      ))
      .limit(1);
    return Boolean(row);
  }

  async countFollowers(playerId: string): Promise<number> {
    const [row] = await db
      .select({ value: count() })
      .from(follows)
      .where(eq(follows.followedPlayerId, playerId));
    return row?.value ?? 0;
  }

  async countFollowing(playerId: string): Promise<number> {
    const [row] = await db
      .select({ value: count() })
      .from(follows)
      .where(eq(follows.followerPlayerId, playerId));
    return row?.value ?? 0;
  }

  async listFollowers(playerId: string, limit: number, offset: number): Promise<FollowPlayerSummary[]> {
    return db
      .select(playerSummarySelection)
      .from(follows)
      .innerJoin(players, eq(follows.followerPlayerId, players.id))
      .where(eq(follows.followedPlayerId, playerId))
      .orderBy(desc(follows.createdAt), desc(follows.id))
      .limit(limit)
      .offset(offset);
  }

  async listFollowing(playerId: string, limit: number, offset: number): Promise<FollowPlayerSummary[]> {
    return db
      .select(playerSummarySelection)
      .from(follows)
      .innerJoin(players, eq(follows.followedPlayerId, players.id))
      .where(eq(follows.followerPlayerId, playerId))
      .orderBy(desc(follows.createdAt), desc(follows.id))
      .limit(limit)
      .offset(offset);
  }

  async listFollowingIds(playerId: string): Promise<string[]> {
    const rows = await db
      .select({ id: follows.followedPlayerId })
      .from(follows)
      .where(eq(follows.followerPlayerId, playerId));
    return rows.map((row) => row.id);
  }
}
