import "server-only";

import { getSupabaseServer } from "@/lib/database";
import type { PlayerAchievement } from "@/types/domain";
import type { PlayerAchievementRow } from "@/types/database";
import type {
  AchievementRepository,
  AchievementSummary,
  AchievementUpsert,
} from "./AchievementRepository";

// Moved here from features/achievements.ts, where it lived next to the
// queries it now replaces.
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

// Current, active implementation — wraps the exact same Supabase queries
// that were previously in features/achievements.ts, features/admin.ts
// (cascading delete) and app/api/players/[id]/achievements/route.ts.
export class SupabaseAchievementRepository implements AchievementRepository {
  async findByPlayerId(playerId: string): Promise<PlayerAchievement[]> {
    const supabase = getSupabaseServer();
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

  async findSummariesByPlayerId(playerId: string): Promise<AchievementSummary[]> {
    const supabase = getSupabaseServer();
    const { data, error } = await supabase
      .from("player_achievements")
      .select("achievement_code, current_value, completed_at")
      .eq("player_id", playerId);

    if (error) {
      throw new Error(error.message);
    }

    return (data ?? []) as AchievementSummary[];
  }

  async upsertMany(rows: AchievementUpsert[]): Promise<void> {
    const supabase = getSupabaseServer();
    const { error } = await supabase
      .from("player_achievements")
      .upsert(rows, { onConflict: "player_id,achievement_code" });

    if (error) {
      throw new Error(error.message);
    }
  }

  async deleteByPlayerId(playerId: string): Promise<void> {
    const supabase = getSupabaseServer();
    const { error } = await supabase
      .from("player_achievements")
      .delete()
      .eq("player_id", playerId);

    if (error) {
      throw new Error(`Ошибка удаления достижений: ${error.message}`);
    }
  }
}
