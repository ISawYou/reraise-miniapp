import "server-only";

import { createHash, randomInt } from "crypto";
import { getSupabaseServer } from "@/lib/supabase-server";

const OTP_TTL_MS = 10 * 60 * 1000;
const OTP_RESEND_MS = 60 * 1000;
const MAX_FAILED_ATTEMPTS = 5;

export type EmailOtpPurpose = "login" | "link_email";

type EmailOtpRow = {
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

function getOtpSecret() {
  const secret = process.env.SESSION_SECRET;

  if (!secret && process.env.NODE_ENV === "production") {
    throw new Error("SESSION_SECRET is not set");
  }

  return secret ?? "dev-insecure-secret";
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function hashOtpCode(email: string, purpose: EmailOtpPurpose, code: string) {
  return createHash("sha256")
    .update(`${normalizeEmail(email)}:${purpose}:${code}:${getOtpSecret()}`)
    .digest("hex");
}

function generateOtpCode() {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

export async function getLatestActiveOtp(
  email: string,
  purpose: EmailOtpPurpose
): Promise<EmailOtpRow | null> {
  const normalized = normalizeEmail(email);
  const supabaseServer = getSupabaseServer();

  const { data, error } = await supabaseServer
    .from("email_otp_codes")
    .select("*")
    .eq("email", normalized)
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

export async function createEmailOtpCode(params: {
  email: string;
  purpose: EmailOtpPurpose;
  playerId?: string | null;
}) {
  const normalized = normalizeEmail(params.email);
  const existing = await getLatestActiveOtp(normalized, params.purpose);
  const now = Date.now();

  if (existing) {
    const resendAfterTime = new Date(existing.resend_after_at).getTime();

    if (resendAfterTime > now) {
      return {
        ok: false as const,
        retryAfterSeconds: Math.max(
          1,
          Math.ceil((resendAfterTime - now) / 1000)
        ),
      };
    }
  }

  const supabaseServer = getSupabaseServer();
  await supabaseServer
    .from("email_otp_codes")
    .update({
      consumed_at: new Date(now).toISOString(),
      updated_at: new Date(now).toISOString(),
    })
    .eq("email", normalized)
    .eq("purpose", params.purpose)
    .is("consumed_at", null);

  const code = generateOtpCode();
  const codeHash = hashOtpCode(normalized, params.purpose, code);
  const expiresAt = new Date(now + OTP_TTL_MS).toISOString();
  const resendAfterAt = new Date(now + OTP_RESEND_MS).toISOString();

  const { error } = await supabaseServer.from("email_otp_codes").insert({
    email: normalized,
    purpose: params.purpose,
    player_id: params.playerId ?? null,
    code_hash: codeHash,
    expires_at: expiresAt,
    resend_after_at: resendAfterAt,
    failed_attempts: 0,
  });

  if (error) {
    throw new Error(`Failed to store OTP code: ${error.message}`);
  }

  return {
    ok: true as const,
    code,
    retryAfterSeconds: Math.ceil(OTP_RESEND_MS / 1000),
  };
}

export async function verifyEmailOtpCode(params: {
  email: string;
  purpose: EmailOtpPurpose;
  code: string;
}) {
  const normalized = normalizeEmail(params.email);
  const supabaseServer = getSupabaseServer();
  const record = await getLatestActiveOtp(normalized, params.purpose);

  if (!record) {
    return { ok: false as const, reason: "missing" as const };
  }

  if (record.consumed_at) {
    return { ok: false as const, reason: "consumed" as const };
  }

  if (new Date(record.expires_at).getTime() <= Date.now()) {
    return { ok: false as const, reason: "expired" as const };
  }

  if (record.failed_attempts >= MAX_FAILED_ATTEMPTS) {
    return { ok: false as const, reason: "attempts_exceeded" as const };
  }

  const expectedHash = hashOtpCode(normalized, params.purpose, params.code);

  if (record.code_hash !== expectedHash) {
    const nextFailedAttempts = record.failed_attempts + 1;

    const { error } = await supabaseServer
      .from("email_otp_codes")
      .update({
        failed_attempts: nextFailedAttempts,
        updated_at: new Date().toISOString(),
      })
      .eq("id", record.id);

    if (error) {
      throw new Error(`Failed to update OTP attempts: ${error.message}`);
    }

    return {
      ok: false as const,
      reason:
        nextFailedAttempts >= MAX_FAILED_ATTEMPTS
          ? ("attempts_exceeded" as const)
          : ("invalid" as const),
      remainingAttempts: Math.max(0, MAX_FAILED_ATTEMPTS - nextFailedAttempts),
    };
  }

  const { error } = await supabaseServer
    .from("email_otp_codes")
    .update({
      consumed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", record.id);

  if (error) {
    throw new Error(`Failed to consume OTP code: ${error.message}`);
  }

  return {
    ok: true as const,
    playerId: record.player_id,
  };
}

