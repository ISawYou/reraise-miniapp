import "server-only";

import type { PokerClockClockState } from "@/types/poker-clock-live-state";

// Outbound Re-Raise -> Poker Clock call. This is a NEW, separate direction
// from the existing Poker Clock -> Re-Raise integration
// (app/api/integrations/v1/**, lib/integration-auth.ts) -- deliberately not
// reusing POKER_CLOCK_INTEGRATION_TOKEN, which authenticates the opposite
// caller. See POKER_CLOCK_LIVE_STATE_TOKEN below.
function getBaseUrl(): string | null {
  const url = process.env.POKER_CLOCK_BASE_URL;
  return url && url.trim().length > 0 ? url.replace(/\/+$/, "") : null;
}

// Verified constant-time-compare is not needed here: this token is sent BY
// us, not checked against a value someone else supplies, so there is no
// timing side-channel to guard against (unlike lib/integration-auth.ts's
// inbound check).
function getOutboundToken(): string | null {
  const token = process.env.POKER_CLOCK_LIVE_STATE_TOKEN;
  return token && token.trim().length > 0 ? token : null;
}

const REQUEST_TIMEOUT_MS = 4000;

function isFiniteNumberOrNull(value: unknown): value is number | null {
  return value === null || (typeof value === "number" && Number.isFinite(value));
}

function isBooleanOrNull(value: unknown): value is boolean | null {
  return value === null || typeof value === "boolean";
}

// Never trusts the external JSON. Missing/malformed fields must not be
// silently coerced into 0/undefined -- a running/paused clock without real
// level+blind numbers (or without a real isBreak) is treated as fully
// invalid (same outcome as a failed request) rather than rendered as
// "Ур. undefined · NaN / NaN" or a break inferred from 0/0 blinds.
function parseLiveState(json: unknown): PokerClockClockState | null {
  if (!json || typeof json !== "object") return null;
  const raw = json as Record<string, unknown>;

  const status = raw.status;
  if (
    status !== "draft" &&
    status !== "running" &&
    status !== "paused" &&
    status !== "finished"
  ) {
    return null;
  }

  if (raw.startedAt !== null && typeof raw.startedAt !== "string") return null;
  if (!isFiniteNumberOrNull(raw.currentLevel)) return null;
  if (!isFiniteNumberOrNull(raw.smallBlind)) return null;
  if (!isFiniteNumberOrNull(raw.bigBlind)) return null;
  if (!isFiniteNumberOrNull(raw.lateRegistrationRemainingSeconds)) return null;
  if (!isBooleanOrNull(raw.isBreak)) return null;

  const state: PokerClockClockState = {
    status,
    startedAt: (raw.startedAt as string | null) ?? null,
    currentLevel: raw.currentLevel as number | null,
    smallBlind: raw.smallBlind as number | null,
    bigBlind: raw.bigBlind as number | null,
    lateRegistrationRemainingSeconds:
      raw.lateRegistrationRemainingSeconds as number | null,
    isBreak: raw.isBreak as boolean | null,
  };

  // Same "controlled fallback, never 0/0" rule as currentLevel/smallBlind/
  // bigBlind above, extended to isBreak: a running/paused clock is
  // contractually required to carry the real BlindLevel.is_break, never
  // null. A response claiming LIVE without it is malformed -- treated as
  // fully invalid (same outcome as a failed request), not defaulted to
  // "not a break" and never inferred from smallBlind/bigBlind being 0.
  if (state.status === "running" || state.status === "paused") {
    if (
      state.currentLevel === null ||
      state.smallBlind === null ||
      state.bigBlind === null ||
      state.isBreak === null
    ) {
      return null;
    }
  }

  return state;
}

// Poker Clock must never become a dependency for the Re-Raise home page's
// availability. Every failure mode -- unset config, timeout, network error,
// non-2xx (404 for an unlinked tournament is an expected, normal case, not
// an error), and malformed JSON -- resolves to `null`. This function never
// throws.
export async function getPokerClockLiveState(
  tournamentId: string
): Promise<PokerClockClockState | null> {
  const baseUrl = getBaseUrl();
  const token = getOutboundToken();
  if (!baseUrl || !token) return null;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(
      `${baseUrl}/api/integrations/v1/tournaments/${encodeURIComponent(tournamentId)}/live-state`,
      {
        headers: { Authorization: `Bearer ${token}` },
        signal: controller.signal,
        cache: "no-store",
      }
    );

    if (!response.ok) return null;

    const json = await response.json().catch(() => null);
    return parseLiveState(json);
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}
