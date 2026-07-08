import type { PlayerAchievement } from "@/types/domain";

// Data-access boundary for `player_achievements`. Deliberately a thin CRUD
// surface: deciding which achievements exist, their targets, and whether a
// given stat crosses the completion threshold all stays in
// features/achievements.ts, exactly as before.
export type AchievementSummary = {
  achievement_code: string;
  current_value: number;
  completed_at: string | null;
};

export type AchievementUpsert = {
  player_id: string;
  achievement_code: string;
  current_value: number;
  completed_at: string | null;
  updated_at: string;
};

export interface AchievementRepository {
  findByPlayerId(playerId: string): Promise<PlayerAchievement[]>;
  // Mirrors app/api/players/[id]/achievements/route.ts's exact 3-column
  // select — not the full row.
  findSummariesByPlayerId(playerId: string): Promise<AchievementSummary[]>;
  upsertMany(rows: AchievementUpsert[]): Promise<void>;
  deleteByPlayerId(playerId: string): Promise<void>;
}
