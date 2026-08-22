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
  readonly x: number;
  readonly y: number;
};

export const ACADEMY_TABLE_SEATS: readonly AcademyTableSeat[] = [
  { label: "UTG", lessonPosition: "UTG", x: 63, y: 20 },
  { label: "UTG+1", lessonPosition: "EP", x: 149, y: 6 },
  { label: "MP", lessonPosition: "MP1", x: 235, y: 20 },
  { label: "LJ", lessonPosition: "MP2", x: 290, y: 70 },
  { label: "HJ", lessonPosition: "HJ", x: 278, y: 145 },
  { label: "CO", lessonPosition: "CO", x: 215, y: 190 },
  { label: "BTN", lessonPosition: "BTN", x: 128, y: 194 },
  { label: "SB", lessonPosition: null, x: 42, y: 174 },
  { label: "BB", lessonPosition: null, x: 8, y: 92 },
] as const;

export function getAcademyTableSeat(
  position: PreflopPosition,
): AcademyTableSeat {
  const seat = ACADEMY_TABLE_SEATS.find(
    (candidate) => candidate.lessonPosition === position,
  );
  if (!seat) throw new Error(`Неизвестная позиция Academy: ${position}`);
  return seat;
}
