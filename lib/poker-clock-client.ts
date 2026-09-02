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

// Product item #8: after ReRaise successfully completes a linked
// points/free tournament, tell Poker Clock to finish its clock too. Unlike
// getPokerClockLiveState (a display-only read where every failure mode
// collapses to the same "nothing to show" null), a caller here needs to
// tell a normal no-op (no linked Clock tournament) apart from a real
// failure the admin may want to retry -- see
// app/api/admin/tournaments/[id]/complete-free/route.ts and
// app/api/admin/tournaments/[id]/poker-clock/finish/route.ts.
export type PokerClockFinishResult =
  | { status: "finished" }
  // Poker Clock's canonical generic 404 -- this ReRaise tournament has no
  // linked Clock tournament. Normal, not an error (see PokerClockFinishResult's
  // callers -- this must behave exactly like ordinary completion success).
  | { status: "not_linked" }
  // `reason` is an internal categorical label for server-side logs only --
  // never the raw upstream body/status text, never surfaced to the browser
  // as-is (see the admin-facing routes above for how it's translated).
  | { status: "failed"; reason: string };

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

// POST .../:tournamentId/finish -- same base URL, same outbound Bearer
// convention, same timeout discipline as getPokerClockLiveState above (this
// is the SAME deployed Poker Clock inbound auth as its live-state endpoint,
// so it reuses the SAME outbound credential -- no new env var, no new
// token). The tournamentId path segment is ReRaise's own tournament id,
// exactly like live-state -- Poker Clock resolves the binding by that id,
// not the other way around. No request body: the deployed contract needs
// none.
//
// Deliberately never throws -- every failure mode resolves to a
// PokerClockFinishResult the caller can act on (see that type's doc
// comment). This function is always called AFTER ReRaise's own completion
// has already succeeded (see complete-free/route.ts) -- it must never be
// able to make a caller believe ReRaise completion itself failed.
export async function finishPokerClockTournament(
  tournamentId: string
): Promise<PokerClockFinishResult> {
  const baseUrl = getBaseUrl();
  const token = getOutboundToken();
  if (!baseUrl || !token) {
    return { status: "failed", reason: "not_configured" };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(
      `${baseUrl}/api/integrations/v1/tournaments/${encodeURIComponent(tournamentId)}/finish`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        signal: controller.signal,
        cache: "no-store",
      }
    );

    if (response.ok) {
      return { status: "finished" };
    }

    // Canonical generic 404 -- no linked Poker Clock tournament. Normal,
    // not logged as a failure.
    if (response.status === 404) {
      return { status: "not_linked" };
    }

    if (response.status === 401 || response.status === 403) {
      return finishFailed(tournamentId, "unauthorized");
    }

    // Poker Clock's own lifecycle rule: a linked Clock tournament still in
    // draft can't transition draft -> finished (see this module's callers
    // for why ReRaise never tries to work around this by starting the
    // clock itself).
    if (response.status === 409) {
      return finishFailed(tournamentId, "lifecycle_conflict");
    }

    if (response.status >= 500) {
      return finishFailed(tournamentId, "upstream_error");
    }

    return finishFailed(tournamentId, `unexpected_status_${response.status}`);
  } catch (error) {
    const reason = error instanceof Error && error.name === "AbortError" ? "timeout" : "network_error";
    return finishFailed(tournamentId, reason);
  } finally {
    clearTimeout(timeout);
  }
}

// Centralizes the one FAILED-logging call site -- safe, categorical
// context only (tournament id + reason label), never the raw upstream
// status text/body.
function finishFailed(tournamentId: string, reason: string): PokerClockFinishResult {
  console.error("[poker-clock-client] finish failed", { tournamentId, reason });
  return { status: "failed", reason };
}
