import { describe, expect, it } from "vitest";
import { getPrimaryAcademyCourse } from "@/config/academy/catalog";
import {
  calculateAcademyCourseProgress,
  calculateAcademyModuleProgress,
  calculateAcademyProgressForLessons,
} from "@/lib/academy/progress";
import type { AcademyCourse, AcademyLesson, AcademyModule } from "@/types/academy";

function syntheticLesson(code: string, order: number): AcademyLesson {
  return {
    code,
    title: code,
    subtitle: code,
    description: code,
    order,
    route: `/academy/test/${code}`,
    lessonKind: "PREFLOP_RFI",
    trainerKind: "PREFLOP_RFI_BINARY",
  };
}

function syntheticModule(code: string, lessonCodes: string[]): AcademyModule {
  return {
    code,
    title: code,
    description: code,
    order: 1,
    route: `/academy/test/${code}`,
    lessons: lessonCodes.map(syntheticLesson),
  };
}

describe("calculateAcademyProgressForLessons", () => {
  it("has no magic default total — the collection is a required argument", () => {
    expect(calculateAcademyProgressForLessons.length).toBe(2);
  });

  it("uses the size of the supplied collection, not a hardcoded 7", () => {
    const codes = ["a", "b", "c"];
    expect(calculateAcademyProgressForLessons(
      [{ lessonCode: "a", passed: true }, { lessonCode: "b", passed: false }],
      codes,
    )).toEqual({ passedLessons: 1, totalLessons: 3, progressPercent: 33 });
    expect(calculateAcademyProgressForLessons([], [])).toEqual({
      passedLessons: 0,
      totalLessons: 0,
      progressPercent: 0,
    });
  });

  it("ignores progress for lessons outside the collection and de-duplicates codes", () => {
    expect(calculateAcademyProgressForLessons(
      [
        { lessonCode: "a", passed: true },
        { lessonCode: "a", passed: true },
        { lessonCode: "other", passed: true },
      ],
      ["a", "b", "b"],
    )).toEqual({ passedLessons: 1, totalLessons: 2, progressPercent: 50 });
  });
});

describe("course and module progress", () => {
  const course = getPrimaryAcademyCourse();
  const codes = course.modules[0].lessons.map((lesson) => lesson.code);

  it.each([[0, 0], [1, 14], [4, 57], [7, 100]])(
    "calculates %i/7 of the catalog course as %i%%",
    (passedLessons, expectedPercent) => {
      const progress = codes.map((lessonCode, index) => ({ lessonCode, passed: index < passedLessons }));
      expect(calculateAcademyCourseProgress(progress, course)).toEqual({
        passedLessons,
        totalLessons: 7,
        progressPercent: expectedPercent,
      });
    },
  );

  it("counts a course over all of its modules' lessons", () => {
    const twoModuleCourse: AcademyCourse = {
      code: "synthetic_course",
      title: "Synthetic",
      description: "",
      order: 1,
      modules: [syntheticModule("m1", ["a", "b"]), syntheticModule("m2", ["c", "d", "e"])],
    };
    const progress = [
      { lessonCode: "a", passed: true },
      { lessonCode: "c", passed: true },
      { lessonCode: "d", passed: false },
    ];

    expect(calculateAcademyCourseProgress(progress, twoModuleCourse)).toEqual({
      passedLessons: 2,
      totalLessons: 5,
      progressPercent: 40,
    });
    expect(calculateAcademyModuleProgress(progress, twoModuleCourse.modules[0])).toEqual({
      moduleCode: "m1",
      passedLessons: 1,
      totalLessons: 2,
      progressPercent: 50,
    });
    expect(calculateAcademyModuleProgress(progress, twoModuleCourse.modules[1])).toEqual({
      moduleCode: "m2",
      passedLessons: 1,
      totalLessons: 3,
      progressPercent: 33,
    });
  });
});
