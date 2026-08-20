import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres, { type Sql } from "postgres";
import { ACADEMY_PREFLOP_LESSONS } from "@/config/academy/lessons";
import { getAcademyPreflopRange } from "@/config/academy/preflop-ranges";
import { CANONICAL_STARTING_HANDS, getTeachingAction } from "@/lib/academy/preflop";
import type { AcademyTrainingAnswer, PreflopPosition } from "@/types/academy";

const TEST_DATABASE_URL = process.env.ACADEMY_POSTGRES_TEST_URL;
const describePostgres = TEST_DATABASE_URL ? describe : describe.skip;
const PLAYER_ID = "90000000-0000-4000-8000-000000000001";

function assertSafeTestDatabaseUrl(value: string): void {
  const url = new URL(value);
  if (!["127.0.0.1", "localhost"].includes(url.hostname) || !url.pathname.includes("test")) {
    throw new Error("Academy PostgreSQL integration tests require a localhost test database");
  }
}

function answersFor(position: PreflopPosition, correctCount: number): AcademyTrainingAnswer[] {
  const strategy = getAcademyPreflopRange(position).referenceStrategy;
  return CANONICAL_STARTING_HANDS.slice(0, 10).map((hand, index) => {
    const correctAction = getTeachingAction(strategy[hand] ?? 0);
    return {
      hand,
      selectedAction: index < correctCount
        ? correctAction
        : correctAction === "OPEN" ? "FOLD" : "OPEN",
    };
  });
}

function attempt(
  position: PreflopPosition,
  correctCount: number,
  attemptId: string,
) {
  return {
    attemptId,
    lessonCode: ACADEMY_PREFLOP_LESSONS[position].code,
    questions: answersFor(position, correctCount),
  };
}

async function expectSqlState(operation: Promise<unknown>, expectedCode: string): Promise<void> {
  try {
    await operation;
    throw new Error(`Expected PostgreSQL error ${expectedCode}`);
  } catch (error) {
    expect((error as { code?: string }).code).toBe(expectedCode);
  }
}

describePostgres("Academy PostgreSQL persistence", () => {
  let client: Sql;
  let submitAcademyTrainingAttempt: typeof import("@/features/academy")["submitAcademyTrainingAttempt"];
  let getAcademyLessonProgress: typeof import("@/features/academy")["getAcademyLessonProgress"];

  beforeAll(async () => {
    assertSafeTestDatabaseUrl(TEST_DATABASE_URL!);
    process.env.DATABASE_PROVIDER = "postgres";
    process.env.DATABASE_URL = TEST_DATABASE_URL!;
    client = postgres(TEST_DATABASE_URL!, { max: 10 });
    ({ submitAcademyTrainingAttempt, getAcademyLessonProgress } = await import("@/features/academy"));

    await client`DELETE FROM players WHERE id = ${PLAYER_ID}::uuid`;
    await client`INSERT INTO players (id, display_name) VALUES (${PLAYER_ID}::uuid, 'Academy Integration')`;
  });

  afterAll(async () => {
    if (!client) return;
    await client`DELETE FROM players WHERE id = ${PLAYER_ID}::uuid`;
    await client.end();
  });

  it("persists server-calculated fail, first pass, improvement and regression", async () => {
    const failed = await submitAcademyTrainingAttempt(
      PLAYER_ID,
      attempt("UTG", 7, "90000000-0000-4000-8000-000000000011"),
    );
    const passed = await submitAcademyTrainingAttempt(
      PLAYER_ID,
      attempt("UTG", 8, "90000000-0000-4000-8000-000000000012"),
    );
    const firstCompletedAt = passed.progress.firstCompletedAt;
    const improved = await submitAcademyTrainingAttempt(
      PLAYER_ID,
      attempt("UTG", 10, "90000000-0000-4000-8000-000000000013"),
    );
    const regressed = await submitAcademyTrainingAttempt(
      PLAYER_ID,
      attempt("UTG", 6, "90000000-0000-4000-8000-000000000014"),
    );

    expect(failed.result).toMatchObject({ percentage: 70, passed: false });
    expect(failed.progress).toMatchObject({ attemptsCount: 1, lastScorePercent: 70, bestScorePercent: 70, passed: false, firstCompletedAt: null });
    expect(passed).toMatchObject({ firstPass: true, newBest: true });
    expect(passed.progress).toMatchObject({ attemptsCount: 2, lastScorePercent: 80, bestScorePercent: 80, passed: true });
    expect(improved.progress).toMatchObject({ attemptsCount: 3, lastScorePercent: 100, bestScorePercent: 100, passed: true, firstCompletedAt });
    expect(regressed.progress).toMatchObject({ attemptsCount: 4, lastScorePercent: 60, bestScorePercent: 100, passed: true, firstCompletedAt });
  });

  it("replays one attemptId without changing aggregate state", async () => {
    const input = attempt("EP", 8, "90000000-0000-4000-8000-000000000021");
    const first = await submitAcademyTrainingAttempt(PLAYER_ID, input);
    const retry = await submitAcademyTrainingAttempt(PLAYER_ID, input);
    const [attemptCount] = await client<{ count: number }[]>`
      SELECT count(*)::int AS count FROM academy_training_attempts
      WHERE player_id = ${PLAYER_ID}::uuid AND lesson_code = ${input.lessonCode}
    `;

    expect(first).toMatchObject({ isNewAttempt: true, firstPass: true, newBest: true });
    expect(retry).toMatchObject({ isNewAttempt: false, firstPass: true, newBest: true });
    expect(retry.progress.attemptsCount).toBe(1);
    expect(attemptCount.count).toBe(1);
  });

  it("serializes different concurrent attempts without losing updates", async () => {
    const [first, second] = await Promise.all([
      submitAcademyTrainingAttempt(
        PLAYER_ID,
        attempt("MP1", 7, "90000000-0000-4000-8000-000000000031"),
      ),
      submitAcademyTrainingAttempt(
        PLAYER_ID,
        attempt("MP1", 10, "90000000-0000-4000-8000-000000000032"),
      ),
    ]);
    const progress = await getAcademyLessonProgress(
      PLAYER_ID,
      ACADEMY_PREFLOP_LESSONS.MP1.code,
    );
    const [latestAttempt] = await client<{ score_percent: number }[]>`
      SELECT score_percent FROM academy_training_attempts
      WHERE player_id = ${PLAYER_ID}::uuid
        AND lesson_code = ${ACADEMY_PREFLOP_LESSONS.MP1.code}
      ORDER BY completed_at DESC
      LIMIT 1
    `;

    expect(first.isNewAttempt).toBe(true);
    expect(second.isNewAttempt).toBe(true);
    expect(progress).toMatchObject({ attemptsCount: 2, bestScorePercent: 100, passed: true });
    expect([70, 100]).toContain(progress?.lastScorePercent);
    expect(progress?.lastScorePercent).toBe(latestAttempt.score_percent);
    expect(progress?.firstCompletedAt).not.toBeNull();
  });

  it("serializes concurrent retries of the same attemptId", async () => {
    const input = attempt("MP2", 8, "90000000-0000-4000-8000-000000000041");
    const results = await Promise.all([
      submitAcademyTrainingAttempt(PLAYER_ID, input),
      submitAcademyTrainingAttempt(PLAYER_ID, input),
    ]);
    const progress = await getAcademyLessonProgress(
      PLAYER_ID,
      ACADEMY_PREFLOP_LESSONS.MP2.code,
    );

    expect(results.map((result) => result.isNewAttempt).sort()).toEqual([false, true]);
    expect(progress?.attemptsCount).toBe(1);
  });

  it("enforces score, unique, foreign-key and not-null constraints", async () => {
    await expectSqlState(client`
      INSERT INTO academy_training_attempts (id, player_id, lesson_code, score_percent, passed)
      VALUES ('90000000-0000-4000-8000-000000000051', ${PLAYER_ID}::uuid, 'constraint_low', -1, false)
    `, "23514");
    await expectSqlState(client`
      INSERT INTO academy_training_attempts (id, player_id, lesson_code, score_percent, passed)
      VALUES ('90000000-0000-4000-8000-000000000052', ${PLAYER_ID}::uuid, 'constraint_high', 101, false)
    `, "23514");
    await expectSqlState(client`
      INSERT INTO academy_training_attempts (id, player_id, lesson_code, score_percent, passed)
      VALUES ('90000000-0000-4000-8000-000000000053', '90000000-0000-4000-8000-999999999999', 'constraint_fk', 50, false)
    `, "23503");
    await expectSqlState(client`
      INSERT INTO academy_training_attempts (id, player_id, lesson_code, score_percent, passed)
      VALUES ('90000000-0000-4000-8000-000000000054', ${PLAYER_ID}::uuid, NULL, 50, false)
    `, "23502");

    await client`
      INSERT INTO academy_lesson_progress (
        player_id, lesson_code, attempts_count, last_score_percent,
        best_score_percent, passed, last_attempt_at
      ) VALUES (${PLAYER_ID}::uuid, 'constraint_unique', 1, 50, 50, false, now())
    `;
    await expectSqlState(client`
      INSERT INTO academy_lesson_progress (
        player_id, lesson_code, attempts_count, last_score_percent,
        best_score_percent, passed, last_attempt_at
      ) VALUES (${PLAYER_ID}::uuid, 'constraint_unique', 1, 50, 50, false, now())
    `, "23505");

    await client`
      INSERT INTO academy_training_attempts (id, player_id, lesson_code, score_percent, passed)
      VALUES ('90000000-0000-4000-8000-000000000055', ${PLAYER_ID}::uuid, 'constraint_attempt', 50, false)
    `;
    await expectSqlState(client`
      INSERT INTO academy_training_attempts (id, player_id, lesson_code, score_percent, passed)
      VALUES ('90000000-0000-4000-8000-000000000055', ${PLAYER_ID}::uuid, 'constraint_attempt', 50, false)
    `, "23505");
  });

  it("uses invoker rights, a fixed search_path and owner-only execution", async () => {
    const [catalog] = await client<{
      volatility: string;
      security_definer: boolean;
      settings: string[];
      public_execute: boolean;
      owner_name: string;
      current_user_name: string;
    }[]>`
      SELECT
        proc.provolatile AS volatility,
        proc.prosecdef AS security_definer,
        coalesce(proc.proconfig, ARRAY[]::text[]) AS settings,
        pg_get_userbyid(proc.proowner) AS owner_name,
        current_user AS current_user_name,
        has_function_privilege(
          'public',
          'record_academy_training_attempt(uuid,uuid,text,integer,boolean)',
          'EXECUTE'
        ) AS public_execute
      FROM pg_proc AS proc
      WHERE proc.oid = 'record_academy_training_attempt(uuid,uuid,text,integer,boolean)'::regprocedure
    `;
    const rls = await client<{ table_name: string; enabled: boolean }[]>`
      SELECT relname AS table_name, relrowsecurity AS enabled
      FROM pg_class
      WHERE relname IN ('academy_lesson_progress', 'academy_training_attempts')
      ORDER BY relname
    `;

    expect(catalog).toMatchObject({
      volatility: "v",
      security_definer: false,
      public_execute: false,
    });
    expect(catalog.settings).toContain("search_path=public, pg_temp");
    expect(catalog.owner_name).toBe(catalog.current_user_name);
    expect(rls).toEqual([
      { table_name: "academy_lesson_progress", enabled: true },
      { table_name: "academy_training_attempts", enabled: true },
    ]);

    await client.unsafe("CREATE ROLE academy_phase4_rls_test NOLOGIN");
    try {
      await client.unsafe("GRANT USAGE ON SCHEMA public TO academy_phase4_rls_test");
      await client.unsafe(
        "GRANT SELECT, INSERT, UPDATE ON academy_lesson_progress, academy_training_attempts TO academy_phase4_rls_test",
      );
      await client.unsafe(
        "GRANT EXECUTE ON FUNCTION record_academy_training_attempt(uuid, uuid, text, integer, boolean) TO academy_phase4_rls_test",
      );
      await expectSqlState(client.begin(async (transaction) => {
        await transaction.unsafe("SET LOCAL ROLE academy_phase4_rls_test");
        await transaction`
          SELECT * FROM record_academy_training_attempt(
            '90000000-0000-4000-8000-000000000061',
            ${PLAYER_ID}::uuid,
            'rls_probe',
            50,
            false
          )
        `;
      }), "42501");
    } finally {
      await client.unsafe(
        "REVOKE EXECUTE ON FUNCTION record_academy_training_attempt(uuid, uuid, text, integer, boolean) FROM academy_phase4_rls_test",
      );
      await client.unsafe(
        "REVOKE ALL ON academy_lesson_progress, academy_training_attempts FROM academy_phase4_rls_test",
      );
      await client.unsafe("REVOKE USAGE ON SCHEMA public FROM academy_phase4_rls_test");
      await client.unsafe("DROP ROLE academy_phase4_rls_test");
    }
  });
});
