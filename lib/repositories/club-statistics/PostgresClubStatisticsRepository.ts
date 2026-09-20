import "server-only";

import { and, asc, desc, eq, gt, isNotNull, count, sum, max, type SQL } from "drizzle-orm";
import { db } from "@/lib/db";
import { results, players, playerAchievements } from "@/lib/db/schema";
import type {
  ClubStatisticsRepository,
  ClubStatisticRow,
  AchievementHolderRow,
} from "./ClubStatisticsRepository";

function mapStatRow(row: {
  player_id: string;
  // count()/sum()/max() each carry a different generic return type
  // (number | null vs string | null vs T | null) -- normalized to
  // `unknown` here since every caller of this function passes through the
  // same Number(value ?? 0) conversion regardless of which aggregate
  // produced it.
  value: unknown;
  username: string | null;
  display_name: string;
  telegram_avatar_url: string | null;
  custom_avatar_url: string | null;
}): ClubStatisticRow {
  return {
    player_id: row.player_id,
    username: row.username,
    display_name: row.display_name,
    telegram_avatar_url: row.telegram_avatar_url,
    custom_avatar_url: row.custom_avatar_url,
    // sum()/max() over an integer column can come back as a string from
    // the Postgres driver (numeric precision safety) -- always normalized
    // to a JS number here, once, rather than at every call site.
    value: Number(row.value ?? 0),
  };
}

export class PostgresClubStatisticsRepository implements ClubStatisticsRepository {
  // Shared aggregate-and-join query: GROUP BY results.player_id in a
  // subquery (never joining `players` before the GROUP BY, which would
  // otherwise force every selected player column into the GROUP BY
  // clause), then join `players` on the already-aggregated, already-
  // LIMITed subquery -- so the join only ever touches at most `limit`
  // rows, never the full results table. Ties broken deterministically by
  // player_id ascending (a stable, arbitrary-but-consistent convention,
  // per this release's "do not alter the underlying metric values to
  // break ties" requirement -- only presentation ORDER is affected).
  private async rankByAggregate(
    valueExpr: SQL<unknown>,
    where: SQL | undefined,
    limit: number
  ): Promise<ClubStatisticRow[]> {
    const agg = db
      .select({
        playerId: results.playerId,
        value: valueExpr.as("value"),
      })
      .from(results)
      .where(where)
      .groupBy(results.playerId)
      .as("agg");

    const rows = await db
      .select({
        player_id: agg.playerId,
        value: agg.value,
        username: players.username,
        display_name: players.displayName,
        telegram_avatar_url: players.telegramAvatarUrl,
        custom_avatar_url: players.customAvatarUrl,
      })
      .from(agg)
      .innerJoin(players, eq(agg.playerId, players.id))
      .orderBy(desc(agg.value), asc(agg.playerId))
      .limit(limit);

    return rows.map(mapStatRow);
  }

  getTournamentsPlayedTop(limit: number): Promise<ClubStatisticRow[]> {
    return this.rankByAggregate(count(), undefined, limit);
  }

  getWinsTop(limit: number): Promise<ClubStatisticRow[]> {
    return this.rankByAggregate(count(), eq(results.place, 1), limit);
  }

  getItmTop(limit: number): Promise<ClubStatisticRow[]> {
    return this.rankByAggregate(count(), gt(results.itmPoints, 0), limit);
  }

  getKnockoutsTop(limit: number): Promise<ClubStatisticRow[]> {
    return this.rankByAggregate(sum(results.knockouts), undefined, limit);
  }

  getBossKnockoutsTop(limit: number): Promise<ClubStatisticRow[]> {
    return this.rankByAggregate(sum(results.bossKnockouts), undefined, limit);
  }

  getHeadhunterTop(limit: number): Promise<ClubStatisticRow[]> {
    return this.rankByAggregate(max(results.knockouts), undefined, limit);
  }

  // No join needed -- players.referral_count is already the canonical
  // per-player value (see features/admin.ts::setPlayerReferralCount),
  // ordered directly on the players table.
  async getReferralsTop(limit: number): Promise<ClubStatisticRow[]> {
    const rows = await db
      .select({
        player_id: players.id,
        value: players.referralCount,
        username: players.username,
        display_name: players.displayName,
        telegram_avatar_url: players.telegramAvatarUrl,
        custom_avatar_url: players.customAvatarUrl,
      })
      .from(players)
      .orderBy(desc(players.referralCount), asc(players.id))
      .limit(limit);

    return rows.map(mapStatRow);
  }

  async getAchievementHolders(achievementCode: string, limit: number): Promise<AchievementHolderRow[]> {
    const rows = await db
      .select({
        player_id: playerAchievements.playerId,
        completed_at: playerAchievements.completedAt,
        username: players.username,
        display_name: players.displayName,
        telegram_avatar_url: players.telegramAvatarUrl,
        custom_avatar_url: players.customAvatarUrl,
      })
      .from(playerAchievements)
      .innerJoin(players, eq(playerAchievements.playerId, players.id))
      .where(
        and(eq(playerAchievements.achievementCode, achievementCode), isNotNull(playerAchievements.completedAt))
      )
      .orderBy(asc(playerAchievements.completedAt), asc(playerAchievements.playerId))
      .limit(limit);

    return rows.map((row) => ({
      player_id: row.player_id,
      username: row.username,
      display_name: row.display_name,
      telegram_avatar_url: row.telegram_avatar_url,
      custom_avatar_url: row.custom_avatar_url,
      // Non-null by construction -- filtered by isNotNull(completedAt) above.
      completed_at: row.completed_at!.toISOString(),
    }));
  }
}
