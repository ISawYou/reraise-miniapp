export type AcademyProgressRow = {
  lesson_code: string;
  attempts_count: number;
  last_score_percent: number;
  best_score_percent: number;
  passed: boolean;
  first_completed_at: string | null;
  last_attempt_at: string;
};

export type RecordAcademyAttemptInput = {
  attemptId: string;
  playerId: string;
  lessonCode: string;
  scorePercent: number;
  passed: boolean;
};

export type RecordAcademyAttemptResult = AcademyProgressRow & {
  is_new_attempt: boolean;
  first_pass: boolean;
  new_best: boolean;
};

export interface AcademyProgressRepository {
  getLessonProgress(playerId: string, lessonCode: string): Promise<AcademyProgressRow | null>;
  listCourseProgress(
    playerId: string,
    lessonCodes: readonly string[],
  ): Promise<AcademyProgressRow[]>;
  recordCompletedAttempt(input: RecordAcademyAttemptInput): Promise<RecordAcademyAttemptResult>;
}
