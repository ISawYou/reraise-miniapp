/**
 * Historical-progress safety of "Новичкам · Шаг 2" (the after-open block).
 *
 * The block is a separate unit OUTSIDE `ACADEMY_CATALOG`, so the 7 База MTT
 * opening lessons keep exactly their codes, content, routes and completion
 * math: a player who passed all 7 before this block existed is still 7/7.
 */
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  ACADEMY_BEGINNER_AFTER_OPEN_LESSONS,
  ACADEMY_BEGINNER_AFTER_OPEN_MODULE_CODE,
} from "@/config/academy/beginner-after-open";
import {
  ACADEMY_BASE_MTT_COURSE_CODE,
  ACADEMY_CATALOG,
  ACADEMY_PREFLOP_OPEN_RAISE_MODULE_CODE,
  getAcademyCourse,
  getAcademyLessonByCode,
  getAcademyModule,
  getPrimaryAcademyCourse,
  listAcademyCourseLessonCodes,
  listAllAcademyLessonCodes,
} from "@/config/academy/catalog";
import { ACADEMY_PREFLOP_POSITIONS } from "@/lib/academy/preflop";
import { calculateAcademyModuleProgress } from "@/lib/academy/progress";
import type { AcademyProgressRepository, AcademyProgressRow } from "@/lib/repositories/academy-progress";

vi.mock("@/lib/repositories", () => ({ academyProgressRepository: {} }));
vi.mock("@/lib/repositories/academy-progress", () => ({ academyProgressRepository: {} }));

const { getAcademyCourseProgress, getAllAcademyCoursesProgress, getAcademyAdminProgress } = await import("@/features/academy");

const ROOT = path.resolve(__dirname, "../..");
const PLAYER_ID = "55555555-5555-4555-8555-555555555555";
const OLD_CODES = ACADEMY_PREFLOP_POSITIONS.map((position) => `preflop_rfi_9max_100bb_${position.toLowerCase()}`);
const NEW_CODES = ACADEMY_BEGINNER_AFTER_OPEN_LESSONS.map((lesson) => lesson.code);

function row(lessonCode: string): AcademyProgressRow {
  return {
    lesson_code: lessonCode,
    attempts_count: 2,
    last_score_percent: 90,
    best_score_percent: 90,
    passed: true,
    first_completed_at: "2026-03-01T10:00:00.000Z",
    last_attempt_at: "2026-03-02T10:00:00.000Z",
  };
}

/** A player whose stored rows say: all 7 opening lessons passed (stored BEFORE Шаг 2 existed). */
function completedSevenRepository(): AcademyProgressRepository {
  const rows = OLD_CODES.map(row);
  return {
    listCourseProgress: async (_playerId: string, codes: readonly string[]) => rows.filter((entry) => codes.includes(entry.lesson_code)),
    listAdminProgress: async () => rows.map((entry) => ({
      ...entry,
      player_id: PLAYER_ID,
      player_display_name: "Test",
      player_username: null,
      player_avatar_url: null,
    })),
  } as unknown as AcademyProgressRepository;
}

describe("historical progress: a 7/7 player stays 7/7 after Шаг 2 is added", () => {
  it("primary (single-course) payload: База MTT 7 / 7 = 100%, module 7 / 7", async () => {
    const payload = await getAcademyCourseProgress(PLAYER_ID, completedSevenRepository());
    expect(payload.courseCode).toBe(ACADEMY_BASE_MTT_COURSE_CODE);
    expect(payload.course).toEqual({ passedLessons: 7, totalLessons: 7, progressPercent: 100 });
    expect(payload.modules).toEqual([
      { moduleCode: ACADEMY_PREFLOP_OPEN_RAISE_MODULE_CODE, passedLessons: 7, totalLessons: 7, progressPercent: 100 },
    ]);
  });

  it("all-courses payload: База MTT still 7 / 7, and no extra course appeared", async () => {
    const all = await getAllAcademyCoursesProgress(PLAYER_ID, completedSevenRepository());
    expect(all.courses.map((course) => course.courseCode)).toEqual(["base_mtt", "solver_lab"]);
    const base = all.courses.find((course) => course.courseCode === ACADEMY_BASE_MTT_COURSE_CODE)!;
    expect(base.course).toEqual({ passedLessons: 7, totalLessons: 7, progressPercent: 100 });
  });

  it("admin view: the player's База MTT course and module are still complete", async () => {
    const admin = await getAcademyAdminProgress(completedSevenRepository());
    const base = admin.players[0].courses.find((course) => course.courseCode === ACADEMY_BASE_MTT_COURSE_CODE)!;
    expect([base.passedLessons, base.totalLessons]).toEqual([7, 7]);
    expect([base.modules[0].passedLessons, base.modules[0].totalLessons]).toEqual([7, 7]);
    expect(admin.players[0].lessons.map((lesson) => lesson.lessonCode)).not.toEqual(expect.arrayContaining([NEW_CODES[0]]));
  });

  it("module math over the frozen lesson array is unchanged", () => {
    const openRaiseModule = getAcademyModule(ACADEMY_PREFLOP_OPEN_RAISE_MODULE_CODE)!;
    const progress = OLD_CODES.map((lessonCode) => ({ lessonCode, passed: true }));
    expect(calculateAcademyModuleProgress(progress, openRaiseModule)).toEqual({
      moduleCode: ACADEMY_PREFLOP_OPEN_RAISE_MODULE_CODE, passedLessons: 7, totalLessons: 7, progressPercent: 100,
    });
  });
});

describe("the new lessons never leak into the old module / catalog", () => {
  it("База MTT keeps exactly its 7 lesson codes, routes and binary trainer", () => {
    const base = getAcademyCourse(ACADEMY_BASE_MTT_COURSE_CODE)!;
    expect(base).toBe(getPrimaryAcademyCourse());
    expect(base.modules.map((entry) => entry.code)).toEqual([ACADEMY_PREFLOP_OPEN_RAISE_MODULE_CODE]);
    expect(listAcademyCourseLessonCodes(base)).toEqual(OLD_CODES);
    expect(base.modules[0].lessons.map((lesson) => lesson.route)).toEqual(
      ACADEMY_PREFLOP_POSITIONS.map((position) => `/academy/preflop/${position.toLowerCase()}`));
    expect(base.modules[0].lessons.every((lesson) => lesson.trainerKind === "PREFLOP_RFI_BINARY")).toBe(true);
  });

  it("new codes are genuinely new and are not catalog lessons (not counted, not recordable)", () => {
    expect(NEW_CODES).toHaveLength(5);
    expect(new Set(NEW_CODES).size).toBe(5);
    expect(ACADEMY_CATALOG.map((course) => course.code)).toEqual(["base_mtt", "solver_lab"]);
    expect(listAllAcademyLessonCodes()).toHaveLength(14);
    for (const code of NEW_CODES) {
      expect(listAllAcademyLessonCodes()).not.toContain(code);
      expect(OLD_CODES).not.toContain(code);
      expect(code).not.toMatch(/^preflop_rfi_9max_100bb_/);
      // Fail closed: nothing can record progress under these codes today.
      expect(getAcademyLessonByCode(code)).toBeNull();
    }
    expect(getAcademyModule(ACADEMY_BEGINNER_AFTER_OPEN_MODULE_CODE)).toBeNull();
  });

  it("the old opening lessons' content and routes are byte-unchanged (SHA-256)", () => {
    const sha = (file: string) => createHash("sha256").update(readFileSync(path.join(ROOT, file))).digest("hex");
    expect({
      "config/academy/lessons.ts": sha("config/academy/lessons.ts"),
      "config/academy/preflop-ranges.ts": sha("config/academy/preflop-ranges.ts"),
      "lib/academy/preflop.ts": sha("lib/academy/preflop.ts"),
      "app/academy/preflop/page.tsx": sha("app/academy/preflop/page.tsx"),
      "app/academy/preflop/[position]/page.tsx": sha("app/academy/preflop/[position]/page.tsx"),
      "app/academy/preflop/[position]/train/page.tsx": sha("app/academy/preflop/[position]/train/page.tsx"),
      "config/academy/catalog-codes.ts": sha("config/academy/catalog-codes.ts"),
    }).toEqual({
      "config/academy/lessons.ts": "6791f1aa264331fece75d4d4133e5a8ea2be024e38d0204cc3f37166195f5da7",
      "config/academy/preflop-ranges.ts": "404d874d3e6ae834f8158d02d7f4a30328140450f45424471580c32a8c9fdf9c",
      "lib/academy/preflop.ts": "1a07f8e3fd1e0e208a2a6b379553b45b98969e1799aa00d415fa1d49cd1cc883",
      "app/academy/preflop/page.tsx": "5a9e1f7f5d3cf87c8d6df40cd8988fe550b205b35a180260a913d8a52a2a064b",
      "app/academy/preflop/[position]/page.tsx": "c378f36956997306ac9800ce6ec58e2253db266f49a956956f54cd074cc244ec",
      "app/academy/preflop/[position]/train/page.tsx": "c600f11bc5d8ead72a61ff1f7c69915556c3318b518a1a83e04eab9f681e2a10",
      "config/academy/catalog-codes.ts": "d1f540ae6e8f5fec4fee815e018fbf4ac464365dd65c44d12fd3936be0fe7ed6",
    });
  });

  it("no migration was added for the new lessons", () => {
    const dir = path.join(ROOT, "lib/db/migrations");
    const sql = readdirSync(dir).filter((name) => name.endsWith(".sql")).sort();
    expect(sql).toHaveLength(30);
    expect(sql.at(-1)).toBe("0029_powerful_argent.sql");
    for (const name of sql) {
      const text = readFileSync(path.join(dir, name), "utf8");
      for (const code of [...NEW_CODES, ACADEMY_BEGINNER_AFTER_OPEN_MODULE_CODE]) expect(text, name).not.toContain(code);
    }
  });
});
