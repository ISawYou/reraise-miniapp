import "server-only";

import { getSupabaseServer } from "@/lib/database/supabase/server";
import type {
  AcademyAdminProgressRow,
  AcademyProgressRepository,
  AcademyProgressRow,
  RecordAcademyAttemptInput,
  RecordAcademyAttemptResult,
} from "./AcademyProgressRepository";

export class SupabaseAcademyProgressRepository implements AcademyProgressRepository {
  async listAdminProgress(): Promise<AcademyAdminProgressRow[]> {
    const supabase = getSupabaseServer();
    const { data, error } = await supabase
      .from("academy_lesson_progress")
      .select("lesson_code, attempts_count, last_score_percent, best_score_percent, passed, first_completed_at, last_attempt_at, player_id, players!inner(display_name, username, custom_avatar_url, telegram_avatar_url)")
      .order("last_attempt_at", { ascending: false });

    if (error) throw new Error(`Failed to load Academy admin progress: ${error.message}`);
    return (data ?? []).map((row) => {
      const player = (row as unknown as {
        players: {
          display_name: string;
          username: string | null;
          custom_avatar_url: string | null;
          telegram_avatar_url: string | null;
        };
      }).players;
      return {
        lesson_code: row.lesson_code,
        attempts_count: row.attempts_count,
        last_score_percent: row.last_score_percent,
        best_score_percent: row.best_score_percent,
        passed: row.passed,
        first_completed_at: row.first_completed_at,
        last_attempt_at: row.last_attempt_at,
        player_id: row.player_id,
        player_display_name: player.display_name,
        player_username: player.username,
        player_avatar_url: player.custom_avatar_url ?? player.telegram_avatar_url,
      } satisfies AcademyAdminProgressRow;
    });
  }

  async getLessonProgress(
    playerId: string,
    lessonCode: string,
  ): Promise<AcademyProgressRow | null> {
    const supabase = getSupabaseServer();
    const { data, error } = await supabase
      .from("academy_lesson_progress")
      .select("lesson_code, attempts_count, last_score_percent, best_score_percent, passed, first_completed_at, last_attempt_at")
      .eq("player_id", playerId)
      .eq("lesson_code", lessonCode)
      .maybeSingle();

    if (error) throw new Error(`Failed to load Academy lesson progress: ${error.message}`);
    return (data as AcademyProgressRow | null) ?? null;
  }

  async listCourseProgress(
    playerId: string,
    lessonCodes: readonly string[],
  ): Promise<AcademyProgressRow[]> {
    if (lessonCodes.length === 0) return [];

    const supabase = getSupabaseServer();
    const { data, error } = await supabase
      .from("academy_lesson_progress")
      .select("lesson_code, attempts_count, last_score_percent, best_score_percent, passed, first_completed_at, last_attempt_at")
      .eq("player_id", playerId)
      .in("lesson_code", [...lessonCodes]);

    if (error) throw new Error(`Failed to load Academy course progress: ${error.message}`);
    return (data ?? []) as AcademyProgressRow[];
  }

  async recordCompletedAttempt(
    input: RecordAcademyAttemptInput,
  ): Promise<RecordAcademyAttemptResult> {
    const supabase = getSupabaseServer();
    const { data, error } = await supabase.rpc("record_academy_training_attempt", {
      p_attempt_id: input.attemptId,
      p_player_id: input.playerId,
      p_lesson_code: input.lessonCode,
      p_score_percent: input.scorePercent,
      p_passed: input.passed,
    });

    if (error) throw new Error(`Failed to record Academy attempt: ${error.message}`);
    const row = Array.isArray(data) ? data[0] : data;
    if (!row) throw new Error("Academy attempt did not return progress");
    return row as RecordAcademyAttemptResult;
  }
}
