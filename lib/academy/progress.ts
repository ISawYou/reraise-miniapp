import {
  listAcademyCourseLessonCodes,
  listAcademyModuleLessonCodes,
} from "@/config/academy/catalog";
import type {
  AcademyCourse,
  AcademyLessonCode,
  AcademyLessonCollectionProgress,
  AcademyLessonProgress,
  AcademyModule,
  AcademyModuleProgress,
} from "@/types/academy";

type PassedLessonProgress = Pick<AcademyLessonProgress, "lessonCode" | "passed">;

/**
 * Passed/total over an explicit lesson-code collection. There is no default
 * total: callers must pass the collection (normally derived from the catalog).
 * Progress rows for codes outside the collection are ignored for this
 * collection; duplicate codes are counted once.
 */
export function calculateAcademyProgressForLessons(
  progress: readonly PassedLessonProgress[],
  lessonCodes: readonly AcademyLessonCode[],
): AcademyLessonCollectionProgress {
  const collection = new Set(lessonCodes);
  const passed = new Set(
    progress
      .filter((entry) => entry.passed && collection.has(entry.lessonCode))
      .map((entry) => entry.lessonCode),
  );
  const totalLessons = collection.size;
  const passedLessons = passed.size;

  return {
    passedLessons,
    totalLessons,
    progressPercent: totalLessons === 0 ? 0 : Math.round((passedLessons / totalLessons) * 100),
  };
}

export function calculateAcademyCourseProgress(
  progress: readonly PassedLessonProgress[],
  course: AcademyCourse,
): AcademyLessonCollectionProgress {
  return calculateAcademyProgressForLessons(progress, listAcademyCourseLessonCodes(course));
}

export function calculateAcademyModuleProgress(
  progress: readonly PassedLessonProgress[],
  courseModule: AcademyModule,
): AcademyModuleProgress {
  return {
    moduleCode: courseModule.code,
    ...calculateAcademyProgressForLessons(progress, listAcademyModuleLessonCodes(courseModule)),
  };
}
