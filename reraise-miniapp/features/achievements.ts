import { supabase } from "@/lib/supabase";
import type { PlayerAchievement } from "@/types/domain";
import type { PlayerAchievementRow } from "@/types/database";

const ACHIEVEMENT_TARGETS = {
  first_tournament: 1,
  ten_tournaments: 10,
  first_win: 1,
  rookie_100_rating: 100,
  pro_1000_rating: 1000,
} as const;

function mapPlayerAchievementRow(row: PlayerAchievementRow): PlayerAchievement {
  return {
    id: row.id,
    player_id: row.player_id,
    achievement_code: row.achievement_code,
    current_value: row.current_value,
    completed_at: row.completed_at,
    updated_at: row.updated_at,
  };
}

export async function getPlayerAchievements(playerId: string) {
  const { data, error } = await supabase
    .from("player_achievements")
    .select("*")
    .eq("player_id", playerId);

  if (error) {
    throw new Error(error.message);
  }

  return (data ?? []).map((row) =>
    mapPlayerAchievementRow(row as PlayerAchievementRow)
  );
}

async function getPlayerAchievementStats(playerId: string) {
  const [
    { count: playedCount, error: playedError },
    { data: winsData, error: winsError },
    { data: ratingData, error: ratingError },
  ] =
    await Promise.all([
      supabase
        .from("results")
        .select("*", { count: "exact", head: true })
        .eq("player_id", playerId),
      supabase
        .from("results")
        .select("id")
        .eq("player_id", playerId)
        .eq("place", 1),
      supabase
        .from("results")
        .select("rating_points")
        .eq("player_id", playerId),
    ]);

  if (playedError) {
    throw new Error(playedError.message);
  }

  if (winsError) {
    throw new Error(winsError.message);
  }

  if (ratingError) {
    throw new Error(ratingError.message);
  }

  const ratingTotal = (ratingData ?? []).reduce(
    (sum, row: any) => sum + (row.rating_points ?? 0),
    0
  );

  return {
    first_tournament: Math.min(
      playedCount ?? 0,
      ACHIEVEMENT_TARGETS.first_tournament
    ),
    ten_tournaments: Math.min(
      playedCount ?? 0,
      ACHIEVEMENT_TARGETS.ten_tournaments
    ),
    first_win: Math.min(
      (winsData ?? []).length,
      ACHIEVEMENT_TARGETS.first_win
    ),
    rookie_100_rating: Math.min(
      ratingTotal,
      ACHIEVEMENT_TARGETS.rookie_100_rating
    ),
    pro_1000_rating: Math.min(
      ratingTotal,
      ACHIEVEMENT_TARGETS.pro_1000_rating
    ),
  };
}

export async function syncPlayerAchievements(playerId: string) {
  const stats = await getPlayerAchievementStats(playerId);
  const now = new Date().toISOString();

  const payload = Object.entries(stats).map(([achievement_code, current_value]) => {
    const target =
      ACHIEVEMENT_TARGETS[achievement_code as keyof typeof ACHIEVEMENT_TARGETS];

    return {
      player_id: playerId,
      achievement_code,
      current_value,
      completed_at: current_value >= target ? now : null,
      updated_at: now,
    };
  });

  const { error } = await supabase
    .from("player_achievements")
    .upsert(payload, { onConflict: "player_id,achievement_code" });

  if (error) {
    throw new Error(error.message);
  }
}

export async function syncPlayersAchievements(playerIds: string[]) {
  const uniqueIds = Array.from(new Set(playerIds));
  await Promise.all(uniqueIds.map((playerId) => syncPlayerAchievements(playerId)));
}
