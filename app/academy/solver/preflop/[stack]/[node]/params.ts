import "server-only";

import {
  AcademyPreflopTrainerSelectionError,
  requireAcademyPreflopTrainerSpotByStack,
  type AcademyPreflopTrainerResolvedSpot,
} from "@/lib/academy/preflop-trainer";

/**
 * Route params → real spot, or null. `stack` must be a plain integer and
 * `node` the lower-case key of an existing node of that stack's dataset;
 * anything else is not found (never a constructed or defaulted node).
 */
export function resolvePreflopTrainerRouteSpot(stack: string, node: string): AcademyPreflopTrainerResolvedSpot | null {
  if (!/^\d{1,4}$/.test(stack) || !/^[a-z0-9_]{1,64}$/.test(node)) return null;
  try {
    return requireAcademyPreflopTrainerSpotByStack(Number(stack), node.toUpperCase());
  } catch (error) {
    if (error instanceof AcademyPreflopTrainerSelectionError) return null;
    throw error;
  }
}
