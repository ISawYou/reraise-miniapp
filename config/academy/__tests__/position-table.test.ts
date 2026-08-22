import { describe, expect, it } from "vitest";
import {
  ACADEMY_TABLE_SEATS,
  getAcademyTableSeat,
} from "@/config/academy/position-table";
import type { PreflopPosition } from "@/types/academy";

describe("Academy 9-max position table", () => {
  it.each<[PreflopPosition, string]>([
    ["UTG", "UTG"],
    ["EP", "UTG+1"],
    ["MP1", "MP"],
    ["MP2", "LJ"],
    ["HJ", "HJ"],
    ["CO", "CO"],
    ["BTN", "BTN"],
  ])("maps lesson %s to highlighted seat %s", (lessonPosition, seatLabel) => {
    expect(getAcademyTableSeat(lessonPosition).label).toBe(seatLabel);
  });

  it("shows all nine seats without adding blind lessons", () => {
    expect(ACADEMY_TABLE_SEATS).toHaveLength(9);
    expect(
      ACADEMY_TABLE_SEATS.filter((seat) => seat.lessonPosition === null).map(
        (seat) => seat.label,
      ),
    ).toEqual(["SB", "BB"]);
  });
});
