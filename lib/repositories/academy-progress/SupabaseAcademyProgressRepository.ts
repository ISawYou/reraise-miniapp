import "server-only";

import { getSupabaseServer } from "@/lib/database/supabase/server";
import type {
  AcademyProgressRepository,
  AcademyProgressRow,
  RecordAcademyAttemptInput,
  RecordAcademyAttemptResult,
} from "./AcademyProgressRepository";

export class SupabaseAcademyProgressRepository implements AcademyProgressRepository {
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
