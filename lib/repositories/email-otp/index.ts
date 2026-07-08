import { SupabaseEmailOtpRepository } from "./SupabaseEmailOtpRepository";
import { PostgresEmailOtpRepository } from "./PostgresEmailOtpRepository";
import type { EmailOtpRepository } from "./EmailOtpRepository";

export type {
  EmailOtpRepository,
  EmailOtpRow,
  EmailOtpInsert,
  EmailOtpPurpose,
} from "./EmailOtpRepository";

const usePostgres = process.env.DATABASE_PROVIDER === "postgres";

export const emailOtpRepository: EmailOtpRepository = usePostgres
  ? new PostgresEmailOtpRepository()
  : new SupabaseEmailOtpRepository();
