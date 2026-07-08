import "server-only";

import { getSupabaseServer } from "@/lib/database";
import type {
  EmailOtpRepository,
  EmailOtpRow,
  EmailOtpInsert,
  EmailOtpPurpose,
} from "./EmailOtpRepository";

// Current, active implementation — wraps the exact same Supabase queries
// lib/email-otp.ts used to call directly. No new behavior: errors are
// thrown with the same messages as before.
export class SupabaseEmailOtpRepository implements EmailOtpRepository {
  async findLatestActive(
    email: string,
    purpose: EmailOtpPurpose
  ): Promise<EmailOtpRow | null> {
    const supabaseServer = getSupabaseServer();

    const { data, error } = await supabaseServer
      .from("email_otp_codes")
      .select("*")
      .eq("email", email)
      .eq("purpose", purpose)
      .is("consumed_at", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      throw new Error(`Failed to load OTP record: ${error.message}`);
    }

    return (data as EmailOtpRow | null) ?? null;
  }

  async invalidateActive(email: string, purpose: EmailOtpPurpose): Promise<void> {
    const supabaseServer = getSupabaseServer();
    const now = new Date().toISOString();

    await supabaseServer
      .from("email_otp_codes")
      .update({
        consumed_at: now,
        updated_at: now,
      })
      .eq("email", email)
      .eq("purpose", purpose)
      .is("consumed_at", null);
  }

  async create(data: EmailOtpInsert): Promise<void> {
    const supabaseServer = getSupabaseServer();

    const { error } = await supabaseServer.from("email_otp_codes").insert(data);

    if (error) {
      throw new Error(`Failed to store OTP code: ${error.message}`);
    }
  }

  async incrementFailedAttempts(id: string, failedAttempts: number): Promise<void> {
    const supabaseServer = getSupabaseServer();

    const { error } = await supabaseServer
      .from("email_otp_codes")
      .update({
        failed_attempts: failedAttempts,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id);

    if (error) {
      throw new Error(`Failed to update OTP attempts: ${error.message}`);
    }
  }

  async markConsumed(id: string): Promise<void> {
    const supabaseServer = getSupabaseServer();

    const { error } = await supabaseServer
      .from("email_otp_codes")
      .update({
        consumed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", id);

    if (error) {
      throw new Error(`Failed to consume OTP code: ${error.message}`);
    }
  }
}
