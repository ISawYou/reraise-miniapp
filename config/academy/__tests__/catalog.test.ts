import { describe, expect, it } from "vitest";
import {
  ACADEMY_BASE_MTT_COURSE_CODE,
  ACADEMY_CATALOG,
  ACADEMY_PREFLOP_OPEN_RAISE_MODULE_CODE,
  AcademyUnknownLessonError,
  getAcademyCourse,
  getAcademyLessonByCode,
  getAcademyLessonContext,
  getAcademyModule,
  getPrimaryAcademyCourse,
  listAcademyCourseLessonCodes,
  listAcademyCourseLessons,
  listAllAcademyLessonCodes,
  requireAcademyLesson,
} from "@/config/academy/catalog";
import {
  ACADEMY_PREFLOP_LESSONS,
  ACADEMY_PREFLOP_LESSON_CODES,
  getAcademyPreflopLesson,
  getAcademyPreflopLessonByCode,
} from "@/config/academy/lessons";
import { ACADEMY_PREFLOP_POSITIONS } from "@/lib/academy/preflop";

// Literal persisted values. Intentionally hard-coded: if any of these change,
// existing academy_lesson_progress rows would orphan.
const PERSISTED_LESSON_CODES = [
  "preflop_rfi_9max_100bb_utg",
  "preflop_rfi_9max_100bb_ep",
  "preflop_rfi_9max_100bb_mp1",
  "preflop_rfi_9max_100bb_mp2",
  "preflop_rfi_9max_100bb_hj",
  "preflop_rfi_9max_100bb_co",
  "preflop_rfi_9max_100bb_btn",
] as const;

describe("Academy catalog structure", () => {
  it("contains exactly one course", () => {
    expect(ACADEMY_CATALOG).toHaveLength(1);
    expect(getPrimaryAcademyCourse()).toBe(ACADEMY_CATALOG[0]);
    expect(ACADEMY_CATALOG[0]).toMatchObject({
      code: ACADEMY_BASE_MTT_COURSE_CODE,
      title: "База MTT",
      description:
        "Базовые навыки турнирного покера: позиции, префлоп и фундамент принятия решений.",
    });
  });

  it("puts the seven current RFI lessons into the course's Open Raise module", () => {
    const course = getPrimaryAcademyCourse();
    expect(course.modules).toHaveLength(1);
    const [courseModule] = course.modules;
    expect(courseModule).toMatchObject({
      code: ACADEMY_PREFLOP_OPEN_RAISE_MODULE_CODE,
      title: "Open Raise · 100 BB",
      description: "Диапазоны первого входа в банк с разных позиций за полным столом.",
      route: "/academy/preflop",
    });
    expect(listAcademyCourseLessons(course)).toHaveLength(7);
    expect(courseModule.lessons.map((lesson) => lesson.order)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    for (const lesson of courseModule.lessons) {
      expect(lesson.lessonKind).toBe("PREFLOP_RFI");
      expect(lesson.trainerKind).toBe("PREFLOP_RFI_BINARY");
    }
  });

  it("keeps lesson codes byte-identical to the persisted literal values, in order", () => {
    expect(listAcademyCourseLessonCodes(getPrimaryAcademyCourse())).toEqual(PERSISTED_LESSON_CODES);
    expect(listAllAcademyLessonCodes()).toEqual(PERSISTED_LESSON_CODES);
    expect([...ACADEMY_PREFLOP_LESSON_CODES]).toEqual(PERSISTED_LESSON_CODES);
  });

  it("derives lesson copy from ACADEMY_PREFLOP_LESSONS instead of duplicating it", () => {
    const lessons = getPrimaryAcademyCourse().modules[0].lessons;
    ACADEMY_PREFLOP_POSITIONS.forEach((position, index) => {
      const source = ACADEMY_PREFLOP_LESSONS[position];
      expect(lessons[index]).toMatchObject({
        code: source.code,
        title: source.displayLabel,
        description: source.theory[0],
      });
      expect(lessons[index].subtitle.endsWith(source.fullName)).toBe(true);
    });
    expect(lessons[1].subtitle).toBe("EP · Early Position");
    expect(lessons[0].subtitle).toBe("Under the Gun");
  });

  it("has unique lesson, module and course codes", () => {
    const courseCodes = ACADEMY_CATALOG.map((course) => course.code);
    const moduleCodes = ACADEMY_CATALOG.flatMap((course) => course.modules.map((m) => m.code));
    const lessonCodes = ACADEMY_CATALOG.flatMap((course) => listAcademyCourseLessonCodes(course));

    expect(new Set(courseCodes).size).toBe(courseCodes.length);
    expect(new Set(moduleCodes).size).toBe(moduleCodes.length);
    expect(new Set(lessonCodes).size).toBe(lessonCodes.length);
  });

  it("gives every lesson a non-empty route matching the existing /academy/preflop/[position] URLs", () => {
    const lessons = getPrimaryAcademyCourse().modules[0].lessons;
    ACADEMY_PREFLOP_POSITIONS.forEach((position, index) => {
      expect(lessons[index].route).toBe(`/academy/preflop/${position.toLowerCase()}`);
    });
    for (const lesson of lessons) {
      expect(lesson.route).toMatch(/^\/academy\/preflop\/(utg|ep|mp1|mp2|hj|co|btn)$/);
      // The dynamic route upper-cases the param and validates it as a PreflopPosition.
      const param = lesson.route.split("/").at(-1)!;
      expect(ACADEMY_PREFLOP_POSITIONS).toContain(param.toUpperCase());
    }
  });

  it("keeps getAcademyPreflopLesson / getAcademyPreflopLessonByCode resolving all seven lessons", () => {
    for (const position of ACADEMY_PREFLOP_POSITIONS) {
      const lesson = getAcademyPreflopLesson(position);
      expect(lesson.position).toBe(position);
      expect(getAcademyPreflopLessonByCode(lesson.code)).toBe(lesson);
      expect(getAcademyLessonByCode(lesson.code)?.code).toBe(lesson.code);
    }
  });
});

describe("Academy catalog lookups", () => {
  it("resolves course/module/lesson context for a persisted code", () => {
    const context = getAcademyLessonContext("preflop_rfi_9max_100bb_co");
    expect(context?.course.code).toBe(ACADEMY_BASE_MTT_COURSE_CODE);
    expect(context?.module.code).toBe(ACADEMY_PREFLOP_OPEN_RAISE_MODULE_CODE);
    expect(context?.lesson).toMatchObject({ title: "CO", route: "/academy/preflop/co" });
    expect(getAcademyCourse(ACADEMY_BASE_MTT_COURSE_CODE)).toBe(context?.course);
    expect(getAcademyModule(ACADEMY_PREFLOP_OPEN_RAISE_MODULE_CODE)).toBe(context?.module);
  });

  it("fails closed for unknown lesson codes", () => {
    expect(getAcademyLessonByCode("preflop_rfi_9max_100bb_sb")).toBeNull();
    expect(getAcademyLessonByCode("PREFLOP_RFI_9MAX_100BB_UTG")).toBeNull();
    expect(getAcademyLessonByCode("")).toBeNull();
    expect(getAcademyLessonByCode("toString")).toBeNull();
    expect(() => requireAcademyLesson("legacy_unknown_code")).toThrow(AcademyUnknownLessonError);
    expect(() => requireAcademyLesson("legacy_unknown_code")).toThrow(/legacy_unknown_code/);
  });

  it("needs no migration/backfill: every persisted code resolves to itself as-is", () => {
    for (const code of PERSISTED_LESSON_CODES) {
      expect(requireAcademyLesson(code).code).toBe(code);
    }
  });
});
