import "server-only";

import { createHash, randomInt } from "crypto";
import { emailOtpRepository } from "@/lib/repositories";
import type { EmailOtpPurpose } from "@/lib/repositories";

const OTP_TTL_MS = 10 * 60 * 1000;
const OTP_RESEND_MS = 60 * 1000;
const MAX_FAILED_ATTEMPTS = 5;

export type { EmailOtpPurpose } from "@/lib/repositories";

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
) {
  const normalized = normalizeEmail(email);
  return emailOtpRepository.findLatestActive(normalized, purpose);
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

  await emailOtpRepository.invalidateActive(normalized, params.purpose);

  const code = generateOtpCode();
  const codeHash = hashOtpCode(normalized, params.purpose, code);
  const expiresAt = new Date(now + OTP_TTL_MS).toISOString();
  const resendAfterAt = new Date(now + OTP_RESEND_MS).toISOString();

  await emailOtpRepository.create({
    email: normalized,
    purpose: params.purpose,
    player_id: params.playerId ?? null,
    code_hash: codeHash,
    expires_at: expiresAt,
    resend_after_at: resendAfterAt,
    failed_attempts: 0,
  });

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

    await emailOtpRepository.incrementFailedAttempts(record.id, nextFailedAttempts);

    return {
      ok: false as const,
      reason:
        nextFailedAttempts >= MAX_FAILED_ATTEMPTS
          ? ("attempts_exceeded" as const)
          : ("invalid" as const),
      remainingAttempts: Math.max(0, MAX_FAILED_ATTEMPTS - nextFailedAttempts),
    };
  }

  await emailOtpRepository.markConsumed(record.id);

  return {
    ok: true as const,
    playerId: record.player_id,
    otpId: record.id,
  };
}

