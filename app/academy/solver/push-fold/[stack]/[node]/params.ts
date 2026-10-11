import "server-only";

import {
  AcademyPushFoldSelectionError,
  requireAcademyPushFoldSpotByStack,
  type AcademyPushFoldResolvedSpot,
} from "@/lib/academy/push-fold-trainer";

/**
 * Route params → real Push/Fold spot, or null. `stack` must be a plain
 * integer and `node` the lower-case key of an existing node of that stack's
 * whitelisted dataset; anything else is not found (never a constructed or
 * defaulted node).
 */
export function resolvePushFoldRouteSpot(stack: string, node: string): AcademyPushFoldResolvedSpot | null {
  if (!/^\d{1,4}$/.test(stack) || !/^[a-z0-9_]{1,64}$/.test(node)) return null;
  try {
    return requireAcademyPushFoldSpotByStack(Number(stack), node.toUpperCase());
  } catch (error) {
    if (error instanceof AcademyPushFoldSelectionError) return null;
    throw error;
  }
}
