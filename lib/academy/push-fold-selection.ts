/**
 * Pure, client-safe selection filters for the Push/Fold trainer.
 *
 * Every function narrows an explicit list of spots — on the server that list
 * is derived from the whitelisted datasets' real nodes
 * (`listAcademyPushFoldSpots` in lib/academy/push-fold-trainer.ts), and the
 * home page passes that same list to the client picker. Nothing here
 * hard-codes which combinations exist: an option is offered iff a real,
 * validated node backs it.
 */
import { ACADEMY_PREFLOP_TRAINER_SEAT_ORDER } from "@/lib/academy/preflop-trainer-selection";
import type { AcademyPushFoldSituation, AcademyPushFoldSpot } from "@/types/academy";

/** The two decision families, in the order the home page shows them. */
export const ACADEMY_PUSH_FOLD_SITUATIONS = Object.freeze([
  "FIRST_IN_SHOVE",
  "CALL_VS_SHOVE",
] as const satisfies readonly AcademyPushFoldSituation[]);

export function isAcademyPushFoldSituation(value: unknown): value is AcademyPushFoldSituation {
  return typeof value === "string" && (ACADEMY_PUSH_FOLD_SITUATIONS as readonly string[]).includes(value);
}

/** Same 9-max seat order as the shared table and the MTT trainer (UTG … BB). */
export const ACADEMY_PUSH_FOLD_SEAT_ORDER = ACADEMY_PREFLOP_TRAINER_SEAT_ORDER;

function seatRank(seat: string): number {
  const index = (ACADEMY_PUSH_FOLD_SEAT_ORDER as readonly string[]).indexOf(seat);
  return index === -1 ? ACADEMY_PUSH_FOLD_SEAT_ORDER.length : index;
}

const bySeat = (a: string, b: string) => seatRank(a) - seatRank(b) || a.localeCompare(b);

function uniqueSorted<T>(values: readonly T[], compare: (a: T, b: T) => number): T[] {
  return [...new Set(values)].sort(compare);
}

/** Stacks with at least one real node of the family, ascending. */
export function listPushFoldStacks(spots: readonly AcademyPushFoldSpot[], situation?: AcademyPushFoldSituation): number[] {
  return uniqueSorted(
    spots.filter((spot) => !situation || spot.situation === situation).map((spot) => spot.stackBb),
    (a, b) => a - b,
  );
}

/** Hero seats with a real node for stack + family, in table order. */
export function listPushFoldHeroPositions(
  spots: readonly AcademyPushFoldSpot[],
  stackBb: number,
  situation: AcademyPushFoldSituation,
): string[] {
  return uniqueSorted(
    spots.filter((spot) => spot.stackBb === stackBb && spot.situation === situation).map((spot) => spot.heroPosition),
    bySeat,
  );
}

/** Shover seats for stack + CALL_VS_SHOVE + hero, in table order ([] for first-in). */
export function listPushFoldVillainPositions(
  spots: readonly AcademyPushFoldSpot[],
  stackBb: number,
  situation: AcademyPushFoldSituation,
  heroPosition: string,
): string[] {
  return uniqueSorted(
    spots
      .filter((spot) => spot.stackBb === stackBb && spot.situation === situation && spot.heroPosition === heroPosition)
      .flatMap((spot) => (spot.villainPosition ? [spot.villainPosition] : [])),
    bySeat,
  );
}

export function pushFoldSituationHasVillain(situation: AcademyPushFoldSituation): boolean {
  return situation === "CALL_VS_SHOVE";
}

/** The real spot for a complete selection, or null (never constructs a spot). */
export function findPushFoldSpot(
  spots: readonly AcademyPushFoldSpot[],
  selection: {
    readonly stackBb: number;
    readonly situation: AcademyPushFoldSituation;
    readonly heroPosition: string;
    readonly villainPosition?: string | null;
  },
): AcademyPushFoldSpot | null {
  return spots.find((spot) =>
    spot.stackBb === selection.stackBb
    && spot.situation === selection.situation
    && spot.heroPosition === selection.heroPosition
    && (spot.villainPosition ?? null) === (selection.villainPosition ?? null)) ?? null;
}
