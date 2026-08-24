import "server-only";

import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { academyLessonProgress, players } from "@/lib/db/schema";
import type {
  AcademyAdminProgressRow,
  AcademyProgressRepository,
  AcademyProgressRow,
  RecordAcademyAttemptInput,
  RecordAcademyAttemptResult,
} from "./AcademyProgressRepository";

function mapProgressRow(row: typeof academyLessonProgress.$inferSelect): AcademyProgressRow {
  return {
    lesson_code: row.lessonCode,
    attempts_count: row.attemptsCount,
    last_score_percent: row.lastScorePercent,
    best_score_percent: row.bestScorePercent,
    passed: row.passed,
    first_completed_at: row.firstCompletedAt?.toISOString() ?? null,
    last_attempt_at: row.lastAttemptAt.toISOString(),
  };
}

type RecordAttemptDbRow = {
  lesson_code: string;
  attempts_count: number;
  last_score_percent: number;
  best_score_percent: number;
  passed: boolean;
  first_completed_at: Date | string | null;
  last_attempt_at: Date | string;
  is_new_attempt: boolean;
  first_pass: boolean;
  new_best: boolean;
};

export class PostgresAcademyProgressRepository implements AcademyProgressRepository {
  async listAdminProgress(): Promise<AcademyAdminProgressRow[]> {
    const rows = await db.select({
      playerId: academyLessonProgress.playerId,
      lessonCode: academyLessonProgress.lessonCode,
      attemptsCount: academyLessonProgress.attemptsCount,
      lastScorePercent: academyLessonProgress.lastScorePercent,
      bestScorePercent: academyLessonProgress.bestScorePercent,
      passed: academyLessonProgress.passed,
      firstCompletedAt: academyLessonProgress.firstCompletedAt,
      lastAttemptAt: academyLessonProgress.lastAttemptAt,
      displayName: players.displayName,
      username: players.username,
      customAvatarUrl: players.customAvatarUrl,
      telegramAvatarUrl: players.telegramAvatarUrl,
    })
      .from(academyLessonProgress)
      .innerJoin(players, eq(academyLessonProgress.playerId, players.id))
      .orderBy(desc(academyLessonProgress.lastAttemptAt));

    return rows.map((row) => ({
      lesson_code: row.lessonCode,
      attempts_count: row.attemptsCount,
      last_score_percent: row.lastScorePercent,
      best_score_percent: row.bestScorePercent,
      passed: row.passed,
      first_completed_at: row.firstCompletedAt?.toISOString() ?? null,
      last_attempt_at: row.lastAttemptAt.toISOString(),
      player_id: row.playerId,
      player_display_name: row.displayName,
      player_username: row.username,
      player_avatar_url: row.customAvatarUrl ?? row.telegramAvatarUrl,
    }));
  }

  async getLessonProgress(
    playerId: string,
    lessonCode: string,
  ): Promise<AcademyProgressRow | null> {
    const [row] = await db
      .select()
      .from(academyLessonProgress)
      .where(and(
        eq(academyLessonProgress.playerId, playerId),
        eq(academyLessonProgress.lessonCode, lessonCode),
      ))
      .limit(1);

    return row ? mapProgressRow(row) : null;
  }

  async listCourseProgress(
    playerId: string,
    lessonCodes: readonly string[],
  ): Promise<AcademyProgressRow[]> {
    if (lessonCodes.length === 0) return [];

    const rows = await db
      .select()
      .from(academyLessonProgress)
      .where(and(
        eq(academyLessonProgress.playerId, playerId),
        inArray(academyLessonProgress.lessonCode, [...lessonCodes]),
      ));

    return rows.map(mapProgressRow);
  }

  async recordCompletedAttempt(
    input: RecordAcademyAttemptInput,
  ): Promise<RecordAcademyAttemptResult> {
    const rows = await db.execute<RecordAttemptDbRow>(sql`
      SELECT * FROM record_academy_training_attempt(
        ${input.attemptId}::uuid,
        ${input.playerId}::uuid,
        ${input.lessonCode}::text,
        ${input.scorePercent}::integer,
        ${input.passed}::boolean
      )
    `);
    const row = rows[0];
    if (!row) throw new Error("Academy attempt did not return progress");

    return {
      ...row,
      first_completed_at: row.first_completed_at
        ? new Date(row.first_completed_at).toISOString()
        : null,
      last_attempt_at: new Date(row.last_attempt_at).toISOString(),
    };
  }
}
