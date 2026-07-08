import { achievementRepository, resultRepository } from "@/lib/repositories";

const ACHIEVEMENT_TARGETS = {
  first_tournament: 1,
  ten_tournaments: 10,
  first_win: 1,
  rookie_100_rating: 100,
  pro_1000_rating: 1000,
} as const;

export async function getPlayerAchievements(playerId: string) {
  return achievementRepository.findByPlayerId(playerId);
}

async function getPlayerAchievementStats(playerId: string) {
  const [playedCount, winIds, ratingRows] = await Promise.all([
    resultRepository.countByPlayerId(playerId),
    resultRepository.findWinIdsByPlayerId(playerId),
    resultRepository.findRatingPointsByPlayerId(playerId),
  ]);

  const ratingTotal = ratingRows.reduce(
    (sum, row) => sum + (row.rating_points ?? 0),
    0
  );

  return {
    first_tournament: Math.min(
      playedCount,
      ACHIEVEMENT_TARGETS.first_tournament
    ),
    ten_tournaments: Math.min(
      playedCount,
      ACHIEVEMENT_TARGETS.ten_tournaments
    ),
    first_win: Math.min(
      winIds.length,
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

  await achievementRepository.upsertMany(payload);
}

export async function syncPlayersAchievements(playerIds: string[]) {
  const uniqueIds = Array.from(new Set(playerIds));
  await Promise.all(uniqueIds.map((playerId) => syncPlayerAchievements(playerId)));
}
