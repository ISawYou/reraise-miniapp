import { SupabaseEmailOtpRepository } from "./SupabaseEmailOtpRepository";
import type { EmailOtpRepository } from "./EmailOtpRepository";

export type {
  EmailOtpRepository,
  EmailOtpRow,
  EmailOtpInsert,
  EmailOtpPurpose,
} from "./EmailOtpRepository";

export const emailOtpRepository: EmailOtpRepository =
  new SupabaseEmailOtpRepository();
