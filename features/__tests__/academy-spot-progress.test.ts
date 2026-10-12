/**
 * v2: ready-made trainings ("Готовые тренировки"), lesson → preset deep links
 * and per-spot practice progress for "Продвинутым" / "Новичкам · Шаг 2" —
 * without a migration and without touching the catalog's historical progress.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { ACADEMY_BEGINNER_AFTER_OPEN_LESSONS, beginnerAfterOpenLessonRoute } from "@/config/academy/beginner-after-open";
import {
  ACADEMY_BASE_MTT_COURSE_CODE,
  getAcademyLessonByCode,
  listAllAcademyLessonCodes,
} from "@/config/academy/catalog";
import { ACADEMY_ADVANCED_STUDY_SPOTS } from "@/config/academy/navigation";
import { ACADEMY_SOLVER_PREFLOP_TRAINER_LESSON_CODE, preflopTrainerTrainRoute } from "@/config/academy/preflop-trainer";
import { pushFoldSpotRoute } from "@/config/academy/push-fold-trainer";
import {
  ACADEMY_SPOT_PROGRESS_UNITS,
  academySpotProgressCode,
  getAcademySpotProgressUnit,
  isAcademySpotProgressCode,
} from "@/config/academy/spot-progress";
import {
  ACADEMY_TRAINING_PRESETS,
  type AcademyTrainingPreset,
  academyTrainingPresetForLesson,
  academyTrainingPresetRoute,
  getAcademyTrainingPreset,
} from "@/config/academy/training-presets";
import { ACADEMY_PREFLOP_POSITIONS } from "@/lib/academy/preflop";
import { buildAcademyPreflopMixSession } from "@/lib/academy/preflop-mix";
import { buildAcademyPreflopTrainerSession, requireAcademyPreflopTrainerSpotByStack } from "@/lib/academy/preflop-trainer";
import { isAcademyPushFoldDatasetScored, requireAcademyPushFoldSpotByStack } from "@/lib/academy/push-fold-trainer";
import type { AcademyProgressRepository, AcademyProgressRow } from "@/lib/repositories/academy-progress";

vi.mock("@/lib/repositories", () => ({ academyProgressRepository: {} }));
vi.mock("@/lib/repositories/academy-progress", () => ({ academyProgressRepository: {} }));

const {
  AcademyValidationError,
  deriveAcademySpotAttemptId,
  getAcademyAdminProgress,
  getAcademyCourseProgress,
  getAcademySpotProgress,
  getAllAcademyCoursesProgress,
  submitAcademyTrainingAttempt,
} = await import("@/features/academy");
const { resolveTrainingPresetCard, listTrainingPresetCards } = await import("@/lib/academy/training-presets");
const { resolvePreflopTrainerRouteSpot } = await import("@/app/academy/solver/preflop/[stack]/[node]/params");
const { resolvePushFoldRouteSpot } = await import("@/app/academy/solver/push-fold/[stack]/[node]/params");
const { resolvePreflopTrainerContext } = await import("@/app/academy/solver/preflop/[stack]/[node]/train/context");

const ROOT = path.resolve(__dirname, "../..");
const PLAYER_ID = "55555555-5555-4555-8555-555555555555";
const ATTEMPT_ID = "88888888-8888-4888-8888-888888888888";
const OLD_CODES = ACADEMY_PREFLOP_POSITIONS.map((position) => `preflop_rfi_9max_100bb_${position.toLowerCase()}`);

// ---------------------------------------------------------------------------
// (10) presets resolve to REAL nodes of the EXISTING trainers
// ---------------------------------------------------------------------------

describe("(10) every preset deep-links into a real, resolvable node of an existing trainer", () => {
  it("preflop presets: the route parses back (through the train page's own lookup) to exactly the preset's node", () => {
    const preflop = ACADEMY_TRAINING_PRESETS.filter((preset) => preset.engine === "PREFLOP_TRAINER");
    expect(preflop.length).toBeGreaterThanOrEqual(6);
    for (const preset of preflop) {
      const { spot } = requireAcademyPreflopTrainerSpotByStack(preset.stackBb, preset.nodeKey);
      const url = new URL(academyTrainingPresetRoute(preset), "https://example.test");
      expect(url.pathname).toBe(preflopTrainerTrainRoute(preset.stackBb, preset.nodeKey));
      const [, , , , stack, node] = url.pathname.split("/");
      const resolved = resolvePreflopTrainerRouteSpot(stack, node)!;
      expect([resolved.spot.datasetId, resolved.spot.nodeKey]).toEqual([spot.datasetId, spot.nodeKey]);
      expect(url.searchParams.get("preset")).toBe(preset.id);
      // The session header names the preset; nothing else changes.
      expect(resolvePreflopTrainerContext(resolved.spot, Object.fromEntries(url.searchParams))).toEqual({
        eyebrow: preset.title, back: { href: "/academy/trainers", label: "Тренажёры" },
      });
    }
  });

  it("the Push/Fold preset is the existing NON-scored study page (scored Push/Fold stays disabled)", () => {
    const preset = getAcademyTrainingPreset("push-fold")!;
    expect(preset.engine).toBe("PUSH_FOLD_STUDY");
    const { spot } = requireAcademyPushFoldSpotByStack(preset.stackBb, preset.nodeKey);
    expect(isAcademyPushFoldDatasetScored(spot.datasetId)).toBe(false);
    expect(academyTrainingPresetRoute(preset)).toBe(pushFoldSpotRoute(preset.stackBb, preset.nodeKey));
    const [, , , , stack, node] = academyTrainingPresetRoute(preset).split("/");
    expect(resolvePushFoldRouteSpot(stack, node)?.spot.nodeKey).toBe(preset.nodeKey);
  });

  it("an invented node is never shown: the landing's resolver fails closed", () => {
    const fake = { ...ACADEMY_TRAINING_PRESETS[0], id: "open-raise", nodeKey: "RFI_NOPE" } as AcademyTrainingPreset;
    expect(resolveTrainingPresetCard(fake)).toBeNull();
    expect(resolveTrainingPresetCard({ ...fake, stackBb: 33, nodeKey: "RFI_CO" })).toBeNull();
    expect(resolveTrainingPresetCard({ ...fake, engine: "PUSH_FOLD_STUDY", stackBb: 10, nodeKey: "FIRST_IN_SHOVE_XX" })).toBeNull();
    // …and every configured preset does resolve.
    expect(listTrainingPresetCards().map((card) => card.id)).toEqual(ACADEMY_TRAINING_PRESETS.map((preset) => preset.id));
  });

  it("the ?preset= query is presentation only: ignored on any other node, unknown ids ignored", () => {
    const bbDefence = getAcademyTrainingPreset("bb-defence")!;
    const other = requireAcademyPreflopTrainerSpotByStack(40, "RFI_CO").spot;
    expect(resolvePreflopTrainerContext(other, { preset: bbDefence.id })).toBeUndefined();
    expect(resolvePreflopTrainerContext(other, { preset: "__proto__" })).toBeUndefined();
    expect(resolvePreflopTrainerContext(other, { preset: ["bb-defence", "x"] })).toBeUndefined();
    expect(resolvePreflopTrainerContext(other, { from: "advanced" })).toEqual({ back: { href: "/academy/advanced", label: "Продвинутым" } });
    expect(resolvePreflopTrainerContext(other, {})).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// (11) each Шаг 2 lesson → its OWN preset
// ---------------------------------------------------------------------------

describe("(11) every 'Новичкам · Шаг 2' lesson practises in its own ready-made training", () => {
  it("explicit mapping, one distinct preset per lesson, on the lesson's own node", () => {
    const mapping = Object.fromEntries(ACADEMY_BEGINNER_AFTER_OPEN_LESSONS.map((lesson) => [lesson.slug, academyTrainingPresetForLesson(lesson.slug)?.id]));
    expect(mapping).toEqual({
      "sb-first-in": "blind-vs-blind",
      "bb-defence": "bb-defence",
      "sb-vs-open": "sb-vs-open",
      "three-bet": "three-bet",
      "facing-three-bet": "facing-three-bet",
    });
    for (const lesson of ACADEMY_BEGINNER_AFTER_OPEN_LESSONS) {
      const preset = academyTrainingPresetForLesson(lesson.slug)!;
      expect([preset.stackBb, preset.nodeKey], lesson.slug).toEqual([lesson.spot.stackBb, lesson.spot.nodeKey]);
      const href = academyTrainingPresetRoute(preset, "lesson");
      expect(href).not.toBe("/academy/trainers");
      const url = new URL(href, "https://example.test");
      const [, , , , stack, node] = url.pathname.split("/");
      const resolved = resolvePreflopTrainerRouteSpot(stack, node)!;
      // From the lesson, the session's back link returns to that lesson.
      expect(resolvePreflopTrainerContext(resolved.spot, Object.fromEntries(url.searchParams))).toEqual({
        eyebrow: preset.title, back: { href: beginnerAfterOpenLessonRoute(lesson.slug), label: "К уроку" },
      });
    }
  });
});

// ---------------------------------------------------------------------------
// (12) per-spot progress: real numbers, historical safety
// ---------------------------------------------------------------------------

function row(lessonCode: string, passed = true, best = 90): AcademyProgressRow {
  return {
    lesson_code: lessonCode, attempts_count: 2, last_score_percent: best, best_score_percent: best, passed,
    first_completed_at: passed ? "2026-03-01T10:00:00.000Z" : null, last_attempt_at: "2026-03-02T10:00:00.000Z",
  };
}

/** In-memory repository honouring the real contract (filter by codes, idempotent attempt ids). */
function memoryRepository(initial: AcademyProgressRow[]) {
  const rows = new Map(initial.map((entry) => [entry.lesson_code, { ...entry }]));
  const attempts = new Map<string, { lessonCode: string; scorePercent: number }>();
  const calls: Array<{ attemptId: string; lessonCode: string; scorePercent: number; passed: boolean }> = [];
  const repository = {
    listCourseProgress: async (_playerId: string, codes: readonly string[]) => [...rows.values()].filter((entry) => codes.includes(entry.lesson_code)),
    listAdminProgress: async () => [...rows.values()].map((entry) => ({
      ...entry, player_id: PLAYER_ID, player_display_name: "Test", player_username: null, player_avatar_url: null,
    })),
    getLessonProgress: async (_playerId: string, code: string) => rows.get(code) ?? null,
    recordCompletedAttempt: async (input: { attemptId: string; lessonCode: string; scorePercent: number; passed: boolean }) => {
      calls.push(input);
      const previous = attempts.get(input.attemptId);
      if (previous && previous.lessonCode !== input.lessonCode) throw new Error("Academy attempt id was already used with different data");
      const isNew = !previous;
      if (isNew) {
        attempts.set(input.attemptId, input);
        const current = rows.get(input.lessonCode);
        rows.set(input.lessonCode, {
          lesson_code: input.lessonCode,
          attempts_count: (current?.attempts_count ?? 0) + 1,
          last_score_percent: input.scorePercent,
          best_score_percent: Math.max(current?.best_score_percent ?? 0, input.scorePercent),
          passed: Boolean(current?.passed) || input.passed,
          first_completed_at: current?.first_completed_at ?? (input.passed ? "2026-10-12T00:00:00.000Z" : null),
          last_attempt_at: "2026-10-12T00:00:00.000Z",
        });
      }
      return { ...rows.get(input.lessonCode)!, is_new_attempt: isNew, first_pass: false, new_best: false };
    },
  };
  return { repository: repository as unknown as AcademyProgressRepository, rows, calls };
}

const advancedCodes = ACADEMY_ADVANCED_STUDY_SPOTS.map((spot) => academySpotProgressCode(spot));

describe("(12) historical safety: a 7/7 player stays 7/7 with spot rows present", () => {
  it("course, all-courses and admin payloads are exactly as before; admin never throws on spot rows", async () => {
    const { repository } = memoryRepository([...OLD_CODES.map((code) => row(code)), row(advancedCodes[0]), row(advancedCodes[1], false, 60)]);
    const primary = await getAcademyCourseProgress(PLAYER_ID, repository);
    expect(primary.course).toEqual({ passedLessons: 7, totalLessons: 7, progressPercent: 100 });
    const all = await getAllAcademyCoursesProgress(PLAYER_ID, repository);
    expect(all.courses.map((course) => course.courseCode)).toEqual(["base_mtt", "solver_lab"]);
    expect(all.courses[0].course).toEqual({ passedLessons: 7, totalLessons: 7, progressPercent: 100 });
    const admin = await getAcademyAdminProgress(repository);
    const base = admin.players[0].courses.find((course) => course.courseCode === ACADEMY_BASE_MTT_COURSE_CODE)!;
    expect([base.passedLessons, base.totalLessons]).toEqual([7, 7]);
    expect(admin.players[0].lessons.some((lesson) => isAcademySpotProgressCode(lesson.lessonCode))).toBe(false);
  });

  it("the catalog is unchanged: 14 lesson codes, spot codes are not lessons and cannot be submitted directly", async () => {
    expect(listAllAcademyLessonCodes()).toHaveLength(14);
    for (const unit of ACADEMY_SPOT_PROGRESS_UNITS) {
      expect(listAllAcademyLessonCodes()).not.toContain(unit.code);
      expect(getAcademyLessonByCode(unit.code)).toBeNull();
    }
    const { repository } = memoryRepository([]);
    await expect(submitAcademyTrainingAttempt(PLAYER_ID, { attemptId: ATTEMPT_ID, lessonCode: advancedCodes[0], questions: [] }, repository))
      .rejects.toBeInstanceOf(AcademyValidationError);
  });

  it("getAcademySpotProgress returns real numbers (passed / best / attempts), zeros for untrained spots", async () => {
    const { repository } = memoryRepository([...OLD_CODES.map((code) => row(code)), row(advancedCodes[0]), row(advancedCodes[1], false, 60)]);
    const spots = await getAcademySpotProgress(PLAYER_ID, repository);
    expect(spots.map((spot) => spot.code)).toEqual(ACADEMY_SPOT_PROGRESS_UNITS.map((unit) => unit.code));
    const byCode = new Map(spots.map((spot) => [spot.code, spot]));
    expect(byCode.get(advancedCodes[0])).toMatchObject({ passed: true, bestScorePercent: 90, attemptsCount: 2 });
    expect(byCode.get(advancedCodes[1])).toMatchObject({ passed: false, bestScorePercent: 60, attemptsCount: 2 });
    expect(byCode.get(advancedCodes[2])).toMatchObject({ passed: false, bestScorePercent: 0, attemptsCount: 0 });
    // Old catalog rows never leak into spot progress.
    expect(spots.filter((spot) => spot.passed)).toHaveLength(1);
  });

  it("every tracked spot is a real node; advanced spots, Шаг 2 spots and preflop presets are all tracked", () => {
    for (const unit of ACADEMY_SPOT_PROGRESS_UNITS) {
      expect(() => requireAcademyPreflopTrainerSpotByStack(unit.stackBb, unit.nodeKey), unit.code).not.toThrow();
      expect(unit.code).toBe(`spot_practice_${unit.stackBb}bb_${unit.nodeKey.toLowerCase()}`);
    }
    for (const spot of [...ACADEMY_ADVANCED_STUDY_SPOTS, ...ACADEMY_BEGINNER_AFTER_OPEN_LESSONS.map((lesson) => lesson.spot)]) {
      expect(getAcademySpotProgressUnit(spot)).not.toBeNull();
    }
  });
});

describe("(12) submitting practice writes real spot progress (fixed-node only, idempotent)", () => {
  beforeAll(() => vi.stubEnv("SESSION_SECRET", "academy-spot-progress-secret"));
  afterAll(() => vi.unstubAllEnvs());
  function fixedNodeAnswers(stackBb: number, nodeKey: string, attemptId: string, correct: boolean) {
    const { spot } = requireAcademyPreflopTrainerSpotByStack(stackBb, nodeKey);
    const session = buildAcademyPreflopTrainerSession({ playerId: PLAYER_ID, attemptId, datasetId: spot.datasetId, nodeKey: spot.nodeKey });
    return session.map((question, questionIndex) => ({
      questionIndex,
      selectedAction: correct
        ? question.resolvedAction
        : question.actions.map((action) => action.code).find((code) => (question.frequencies[code] ?? 0) === 0) ?? question.resolvedAction,
      datasetId: spot.datasetId,
      nodeKey: spot.nodeKey,
    }));
  }

  it("a passed advanced-spot training counts that spot; a retry of the same attempt never double-counts", async () => {
    const { repository, calls } = memoryRepository([]);
    const spot = ACADEMY_ADVANCED_STUDY_SPOTS[1];
    const input = { attemptId: ATTEMPT_ID, lessonCode: ACADEMY_SOLVER_PREFLOP_TRAINER_LESSON_CODE, questions: fixedNodeAnswers(spot.stackBb, spot.nodeKey, ATTEMPT_ID, true) };
    const first = await submitAcademyTrainingAttempt(PLAYER_ID, input, repository);
    expect(first.result).toMatchObject({ percentage: 100, passed: true });
    expect(first.progress.lessonCode).toBe(ACADEMY_SOLVER_PREFLOP_TRAINER_LESSON_CODE);
    await submitAcademyTrainingAttempt(PLAYER_ID, input, repository); // network retry
    expect(calls.map((call) => call.lessonCode)).toEqual([
      ACADEMY_SOLVER_PREFLOP_TRAINER_LESSON_CODE, academySpotProgressCode(spot),
      ACADEMY_SOLVER_PREFLOP_TRAINER_LESSON_CODE, academySpotProgressCode(spot),
    ]);
    expect(calls[1].attemptId).toBe(deriveAcademySpotAttemptId(ATTEMPT_ID, academySpotProgressCode(spot)));
    expect(calls[1].attemptId).toBe(calls[3].attemptId);
    expect(calls[1].attemptId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    const spots = await getAcademySpotProgress(PLAYER_ID, repository);
    expect(spots.find((entry) => entry.code === academySpotProgressCode(spot))).toMatchObject({ passed: true, attemptsCount: 1, bestScorePercent: 100 });
    // The trainer's own row is the same one row as always.
    expect((await repository.getLessonProgress(PLAYER_ID, ACADEMY_SOLVER_PREFLOP_TRAINER_LESSON_CODE))?.attempts_count).toBe(1);
  });

  it("a failed training records the real (failing) score — the spot is started, not passed", async () => {
    const { repository } = memoryRepository([]);
    const spot = ACADEMY_ADVANCED_STUDY_SPOTS[0];
    const attemptId = "99999999-9999-4999-8999-999999999999";
    const result = await submitAcademyTrainingAttempt(PLAYER_ID, {
      attemptId, lessonCode: ACADEMY_SOLVER_PREFLOP_TRAINER_LESSON_CODE, questions: fixedNodeAnswers(spot.stackBb, spot.nodeKey, attemptId, false),
    }, repository);
    const progress = (await getAcademySpotProgress(PLAYER_ID, repository)).find((entry) => entry.code === academySpotProgressCode(spot))!;
    expect(progress).toMatchObject({ passed: result.result.passed, bestScorePercent: result.result.percentage, attemptsCount: 1 });
    expect(result.result.passed).toBe(false);
  });

  it("untracked nodes and Quick Mix attempts write no spot rows", async () => {
    const { repository, calls } = memoryRepository([]);
    const untracked = { stackBb: 20, nodeKey: "RFI_UTG" };
    expect(getAcademySpotProgressUnit(untracked)).toBeNull();
    await submitAcademyTrainingAttempt(PLAYER_ID, {
      attemptId: ATTEMPT_ID, lessonCode: ACADEMY_SOLVER_PREFLOP_TRAINER_LESSON_CODE, questions: fixedNodeAnswers(untracked.stackBb, untracked.nodeKey, ATTEMPT_ID, true),
    }, repository);
    const mixAttempt = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const mix = buildAcademyPreflopMixSession({ playerId: PLAYER_ID, attemptId: mixAttempt });
    await submitAcademyTrainingAttempt(PLAYER_ID, {
      attemptId: mixAttempt,
      lessonCode: ACADEMY_SOLVER_PREFLOP_TRAINER_LESSON_CODE,
      questions: mix.map((question, questionIndex) => ({
        questionIndex, selectedAction: question.resolvedAction, datasetId: question.spot.datasetId, nodeKey: question.spot.nodeKey, mode: "QUICK_MIX",
      })),
    }, repository);
    expect(calls.map((call) => call.lessonCode)).toEqual([ACADEMY_SOLVER_PREFLOP_TRAINER_LESSON_CODE, ACADEMY_SOLVER_PREFLOP_TRAINER_LESSON_CODE]);
  });
});

// ---------------------------------------------------------------------------
// (13) no migration
// ---------------------------------------------------------------------------

describe("(13) no migration: same SQL files, unconstrained lesson_code untouched", () => {
  it("still 30 migrations ending at 0029; none mentions spot codes; schema has no lesson_code constraint", () => {
    const dir = path.join(ROOT, "lib/db/migrations");
    const sql = readdirSync(dir).filter((name) => name.endsWith(".sql")).sort();
    expect(sql).toHaveLength(30);
    expect(sql.at(-1)).toBe("0029_powerful_argent.sql");
    for (const name of sql) expect(readFileSync(path.join(dir, name), "utf8"), name).not.toContain("spot_practice");
    const schema = readFileSync(path.join(ROOT, "lib/db/schema/academyProgress.ts"), "utf8");
    expect(schema).toContain('lessonCode: text("lesson_code").notNull()');
    expect(schema).not.toMatch(/check\([^)]*lesson_code/);
  });
});
