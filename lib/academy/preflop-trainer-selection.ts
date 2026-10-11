/**
 * Pure, client-safe selection filters for the configurable preflop trainer.
 *
 * Every function narrows an explicit list of spots — on the server that list
 * is derived from the registered datasets' real nodes
 * (`listAcademyPreflopTrainerSpots` in lib/academy/preflop-trainer.ts), and
 * the setup page passes that same list to the client picker. Nothing here
 * hard-codes which combinations exist, so an option is offered iff a real,
 * validated node backs it.
 */
import type { AcademyPreflopTrainerSituation, AcademyPreflopTrainerSpot } from "@/types/academy";

/** Situations in tree order (first-in → facing a 5-bet). */
export const ACADEMY_PREFLOP_TRAINER_SITUATIONS = Object.freeze([
  "RFI",
  "FACING_OPEN",
  "FACING_3BET",
  "FACING_4BET",
  "FACING_5BET",
] as const satisfies readonly AcademyPreflopTrainerSituation[]);

export function isAcademyPreflopTrainerSituation(value: unknown): value is AcademyPreflopTrainerSituation {
  return typeof value === "string" && (ACADEMY_PREFLOP_TRAINER_SITUATIONS as readonly string[]).includes(value);
}

/** 9-max seat order used only for sorting options (table order). */
export const ACADEMY_PREFLOP_TRAINER_SEAT_ORDER = Object.freeze([
  "UTG", "UTG1", "UTG2", "LJ", "HJ", "CO", "BTN", "SB", "BB",
] as const);

function seatRank(seat: string): number {
  const index = (ACADEMY_PREFLOP_TRAINER_SEAT_ORDER as readonly string[]).indexOf(seat);
  return index === -1 ? ACADEMY_PREFLOP_TRAINER_SEAT_ORDER.length : index;
}

function uniqueSorted<T>(values: readonly T[], compare: (a: T, b: T) => number): T[] {
  return [...new Set(values)].sort(compare);
}

const bySeat = (a: string, b: string) => seatRank(a) - seatRank(b) || a.localeCompare(b);

/** Stacks that have at least one real node, ascending. */
export function listPreflopTrainerStacks(spots: readonly AcademyPreflopTrainerSpot[]): number[] {
  return uniqueSorted(spots.map((spot) => spot.stackBb), (a, b) => a - b);
}

/** Situations with at least one real node at `stackBb`, in tree order. */
export function listPreflopTrainerSituations(
  spots: readonly AcademyPreflopTrainerSpot[],
  stackBb: number,
): AcademyPreflopTrainerSituation[] {
  const present = new Set(spots.filter((spot) => spot.stackBb === stackBb).map((spot) => spot.situation));
  return ACADEMY_PREFLOP_TRAINER_SITUATIONS.filter((situation) => present.has(situation));
}

/** Hero seats with at least one real node for the stack + situation, in table order. */
export function listPreflopTrainerHeroPositions(
  spots: readonly AcademyPreflopTrainerSpot[],
  stackBb: number,
  situation: AcademyPreflopTrainerSituation,
): string[] {
  return uniqueSorted(
    spots.filter((spot) => spot.stackBb === stackBb && spot.situation === situation).map((spot) => spot.heroPosition),
    bySeat,
  );
}

/** Villain seats for the stack + situation + hero, in table order ([] for RFI). */
export function listPreflopTrainerVillainPositions(
  spots: readonly AcademyPreflopTrainerSpot[],
  stackBb: number,
  situation: AcademyPreflopTrainerSituation,
  heroPosition: string,
): string[] {
  return uniqueSorted(
    spots
      .filter((spot) => spot.stackBb === stackBb && spot.situation === situation && spot.heroPosition === heroPosition)
      .flatMap((spot) => (spot.villainPosition ? [spot.villainPosition] : [])),
    bySeat,
  );
}

/** Whether the situation is played against a villain (everything but RFI). */
export function preflopTrainerSituationHasVillain(situation: AcademyPreflopTrainerSituation): boolean {
  return situation !== "RFI";
}

/**
 * The real spot for a complete selection, or null when no validated node
 * exists for it (never constructs a spot).
 */
export function findPreflopTrainerSpot(
  spots: readonly AcademyPreflopTrainerSpot[],
  selection: {
    readonly stackBb: number;
    readonly situation: AcademyPreflopTrainerSituation;
    readonly heroPosition: string;
    readonly villainPosition?: string | null;
  },
): AcademyPreflopTrainerSpot | null {
  return spots.find((spot) =>
    spot.stackBb === selection.stackBb
    && spot.situation === selection.situation
    && spot.heroPosition === selection.heroPosition
    && (spot.villainPosition ?? null) === (selection.villainPosition ?? null)) ?? null;
}
