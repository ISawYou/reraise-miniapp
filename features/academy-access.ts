import "server-only";

/**
 * Academy access — the ONE server-authoritative access model.
 *
 *   page / API route → features/academy-access.ts → repositories → DB
 *
 * - `getAcademyAccess(player)` derives the tier from canonical facts on
 *   every call (no stored entitlement, no cache): staff (admin / operator)
 *   → FULL; otherwise FULL only if the player actually participated in a
 *   game of the CURRENT active season (`seasonRepository.findActive()` +
 *   `AcademyAccessRepository`); no active season → BEGINNER_ONLY (fail
 *   closed, never a crash).
 * - `assertAcademyAccess(player, targets)` is the single enforcement call
 *   for pages, sessions, reveals and attempt submissions. It runs BEFORE any
 *   question / range / reveal payload is built, and throws
 *   `AcademyAccessDeniedError` (HTTP 403 — the player is authenticated, just
 *   not entitled).
 * - The `academy*Target(s)` builders (lib/academy/access-targets.ts) turn a request into policy
 *   targets. Session, reveal AND attempt of the same trainer use the SAME
 *   builder, so they can never drift apart. Targets are always re-derived
 *   from server-validated data (registry lookups / catalog) — client context
 *   such as `?from=beginner` is never an input.
 *
 * The player passed in must be the canonical player resolved by the session
 * layer (`getPlayerFromSessionServer` → `resolveCanonicalPlayer`); a
 * merged-away id never reaches this module.
 */
import { isStaff } from "@/lib/roles";
import {
  ACADEMY_ACCESS_COPY,
  type AcademyAccessTier,
  type AcademyAccessView,
} from "@/config/academy/access-copy";
import { isAcademyAccessAllowed, type AcademyAccessTarget } from "@/config/academy/access-policy";
import { academyAccessRepository, type AcademyAccessRepository } from "@/lib/repositories/academy-access";
import { seasonRepository } from "@/lib/repositories/season";
import type { Player } from "@/types/domain";

export type { AcademyAccessTarget } from "@/config/academy/access-policy";
// Target builders shared by pages, sessions, reveals and attempts (re-exported for the routes).
export {
  academyAttemptTargets,
  academyCatalogLessonTarget,
  academyPreflopQuickMixTarget,
  academyPreflopSpotTarget,
  academyPushFoldTarget,
} from "@/lib/academy/access-targets";

/** Authenticated but not entitled → 403 (never 401). Deliberately NOT an `AcademyValidationError`. */
export class AcademyAccessDeniedError extends Error {
  readonly tier: AcademyAccessTier;

  constructor(tier: AcademyAccessTier) {
    super(ACADEMY_ACCESS_COPY.apiDenied);
    this.name = "AcademyAccessDeniedError";
    this.tier = tier;
  }
}

/** The only player fields the access model reads. */
export type AcademyAccessPlayer = Pick<Player, "id" | "role">;

export type AcademyAccessDeps = {
  readonly findActiveSeason: () => Promise<{ id: string; title: string } | null>;
  readonly participation: AcademyAccessRepository;
};

const defaultDeps: AcademyAccessDeps = {
  findActiveSeason: () => seasonRepository.findActive(),
  participation: academyAccessRepository,
};

/** Tier + minimal season info for the player. Always recomputed from canonical facts. */
export async function getAcademyAccess(
  player: AcademyAccessPlayer,
  deps: AcademyAccessDeps = defaultDeps,
): Promise<AcademyAccessView> {
  const active = await deps.findActiveSeason();
  const season = active ? { id: active.id, title: active.title } : null;

  if (isStaff(player.role)) return { access: "FULL", season };
  if (!season) return { access: "BEGINNER_ONLY", season: null };

  const participated = await deps.participation.hasPlayerParticipatedInSeason(player.id, season.id);
  return { access: participated ? "FULL" : "BEGINNER_ONLY", season };
}

/**
 * THE enforcement call: resolves the player's tier and requires EVERY target
 * to be allowed by the policy. Returns the resolved view; throws
 * `AcademyAccessDeniedError` otherwise. An empty target list is denied.
 */
export async function assertAcademyAccess(
  player: AcademyAccessPlayer,
  targets: AcademyAccessTarget | readonly AcademyAccessTarget[],
  deps: AcademyAccessDeps = defaultDeps,
): Promise<AcademyAccessView> {
  const list: readonly AcademyAccessTarget[] = Array.isArray(targets) ? targets : [targets as AcademyAccessTarget];
  const view = await getAcademyAccess(player, deps);
  if (list.length === 0 || !list.every((target) => isAcademyAccessAllowed(view.access, target))) {
    throw new AcademyAccessDeniedError(view.access);
  }
  return view;
}
