import "server-only";

import { createHmac } from "node:crypto";
import type { AcademySolverRandom } from "@/lib/academy/solver";

/**
 * Deterministic, secret-keyed randomness for Solver Lab sessions.
 *
 * `HMAC-SHA256(SESSION_SECRET, parts.join(":"))` → first 4 digest bytes as a
 * big-endian uint32 → divided by 2^32, giving a value in [0, 1). Same parts +
 * same secret always give the same value, so the server can regenerate a whole
 * session (at question-serve time and again at verify time) without storing
 * per-session state, and the client cannot predict or choose the outcome.
 *
 * Fails closed when SESSION_SECRET is absent (same pattern as
 * lib/telegram-web-session.ts). The secret is never logged or included in any
 * error message or return value.
 */
function getSessionSecret(): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error("SESSION_SECRET is not set");
  return secret;
}

const UINT32_RANGE = 2 ** 32;

export function deriveDeterministicUnit(parts: readonly string[]): number {
  if (parts.length === 0) throw new Error("deriveDeterministicUnit requires at least one part");
  const digest = createHmac("sha256", getSessionSecret()).update(parts.join(":")).digest();
  return digest.readUInt32BE(0) / UINT32_RANGE;
}

/**
 * A reproducible random stream: the n-th call returns
 * `deriveDeterministicUnit([...parts, String(n)])`.
 */
export function createDeterministicRandom(parts: readonly string[]): AcademySolverRandom {
  // Resolve the secret eagerly so a missing secret fails at stream creation.
  getSessionSecret();
  let counter = 0;
  return () => {
    const value = deriveDeterministicUnit([...parts, String(counter)]);
    counter += 1;
    return value;
  };
}
