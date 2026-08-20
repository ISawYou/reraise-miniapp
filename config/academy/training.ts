import type { AcademyTrainingBucket } from "@/types/academy";

export const ACADEMY_TRAINING_QUESTION_COUNT = 10;
export const ACADEMY_PASS_THRESHOLD = 0.8;

export const ACADEMY_TRAINING_BUCKET_TARGETS = {
  CORE_OPEN: 1,
  OPEN_BOUNDARY: 4,
  FOLD_BOUNDARY: 4,
  CLEAR_FOLD: 1,
} as const satisfies Record<AcademyTrainingBucket, number>;
