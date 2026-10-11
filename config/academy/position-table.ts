import type { PreflopPosition } from "@/types/academy";

export type AcademyTableSeat = {
  readonly label:
    | "UTG"
    | "UTG+1"
    | "MP"
    | "LJ"
    | "HJ"
    | "CO"
    | "BTN"
    | "SB"
    | "BB";
  readonly lessonPosition: PreflopPosition | null;
  /**
   * The same physical seat in the configurable trainer's 9-max naming
   * (`ACADEMY_PREFLOP_TRAINER_SEAT_ORDER`): UTG+1 = UTG1, MP = UTG2.
   */
  readonly trainerSeat: "UTG" | "UTG1" | "UTG2" | "LJ" | "HJ" | "CO" | "BTN" | "SB" | "BB";
  readonly x: number;
  readonly y: number;
};

export const ACADEMY_TABLE_SEATS: readonly AcademyTableSeat[] = [
  { label: "UTG", lessonPosition: "UTG", trainerSeat: "UTG", x: 63, y: 20 },
  { label: "UTG+1", lessonPosition: "EP", trainerSeat: "UTG1", x: 149, y: 6 },
  { label: "MP", lessonPosition: "MP1", trainerSeat: "UTG2", x: 235, y: 20 },
  { label: "LJ", lessonPosition: "MP2", trainerSeat: "LJ", x: 290, y: 70 },
  { label: "HJ", lessonPosition: "HJ", trainerSeat: "HJ", x: 278, y: 145 },
  { label: "CO", lessonPosition: "CO", trainerSeat: "CO", x: 215, y: 190 },
  { label: "BTN", lessonPosition: "BTN", trainerSeat: "BTN", x: 128, y: 194 },
  { label: "SB", lessonPosition: null, trainerSeat: "SB", x: 42, y: 174 },
  { label: "BB", lessonPosition: null, trainerSeat: "BB", x: 8, y: 92 },
] as const;

/** Seat by trainer seat code ("UTG1", "BB", …), or undefined. */
export function findAcademyTableSeatByTrainerSeat(trainerSeat: string): AcademyTableSeat | undefined {
  return ACADEMY_TABLE_SEATS.find((candidate) => candidate.trainerSeat === trainerSeat);
}

export function getAcademyTableSeat(
  position: PreflopPosition,
): AcademyTableSeat {
  const seat = ACADEMY_TABLE_SEATS.find(
    (candidate) => candidate.lessonPosition === position,
  );
  if (!seat) throw new Error(`Неизвестная позиция Academy: ${position}`);
  return seat;
}
