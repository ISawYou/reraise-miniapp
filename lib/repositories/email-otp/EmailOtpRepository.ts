// Data-access boundary for email_otp_codes. Deliberately a thin CRUD
// surface, not a business-logic layer: code generation/hashing, expiry
// math, retry-after math, and attempt-limit decisions all stay in
// lib/email-otp.ts exactly as before.
export type EmailOtpPurpose = "login" | "link_email";

export type EmailOtpRow = {
  id: string;
  email: string;
  purpose: EmailOtpPurpose;
  player_id: string | null;
  code_hash: string;
  expires_at: string;
  resend_after_at: string;
  failed_attempts: number;
  consumed_at: string | null;
  created_at: string;
  updated_at: string;
};

export type EmailOtpInsert = {
  email: string;
  purpose: EmailOtpPurpose;
  player_id: string | null;
  code_hash: string;
  expires_at: string;
  resend_after_at: string;
  failed_attempts: number;
};

export interface EmailOtpRepository {
  findLatestActive(
    email: string,
    purpose: EmailOtpPurpose
  ): Promise<EmailOtpRow | null>;
  // Marks any existing unconsumed code for this email+purpose as consumed —
  // mirrors the "invalidate old codes before issuing a new one" update in
  // createEmailOtpCode.
  invalidateActive(email: string, purpose: EmailOtpPurpose): Promise<void>;
  create(data: EmailOtpInsert): Promise<void>;
  incrementFailedAttempts(id: string, failedAttempts: number): Promise<void>;
  markConsumed(id: string): Promise<void>;
}
