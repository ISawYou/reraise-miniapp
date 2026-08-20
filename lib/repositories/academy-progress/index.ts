import { PostgresAcademyProgressRepository } from "./PostgresAcademyProgressRepository";
import { SupabaseAcademyProgressRepository } from "./SupabaseAcademyProgressRepository";
import type { AcademyProgressRepository } from "./AcademyProgressRepository";

export type {
  AcademyProgressRepository,
  AcademyProgressRow,
  RecordAcademyAttemptInput,
  RecordAcademyAttemptResult,
} from "./AcademyProgressRepository";

const usePostgres = process.env.DATABASE_PROVIDER === "postgres";

export const academyProgressRepository: AcademyProgressRepository = usePostgres
  ? new PostgresAcademyProgressRepository()
  : new SupabaseAcademyProgressRepository();
