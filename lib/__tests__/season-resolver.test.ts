import { describe, expect, it } from "vitest";
import {
  AmbiguousSeasonError,
  InvalidSeasonRangeError,
  NoSeasonForDateError,
  SeasonRangeOverlapError,
  resolveSeasonForCalendarDate,
  toMoscowCalendarDate,
  validateSeasonRanges,
} from "@/lib/season-resolver";
import type { SeasonFullRow } from "@/lib/repositories/season/SeasonRepository";

function season(overrides: Partial<SeasonFullRow> = {}): SeasonFullRow {
  return {
    id: "s1",
    title: "Открытие",
    start_date: "2026-06-01",
    end_date: "2026-08-31",
    is_active: true,
    created_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

const OPENING = season({ id: "opening", title: "Открытие", start_date: "2026-06-01", end_date: "2026-08-31" });
const AUTUMN = season({
  id: "autumn",
  title: "Осень 2026",
  start_date: "2026-09-01",
  end_date: "2026-11-30",
  is_active: false,
});

describe("toMoscowCalendarDate", () => {
  it("converts a UTC-previous-day instant to the correct Europe/Moscow calendar date", () => {
    // 2026-09-01 00:30 Europe/Moscow == 2026-08-31 21:30 UTC.
    expect(toMoscowCalendarDate("2026-08-31T21:30:00.000Z")).toBe("2026-09-01");
  });

  it("Europe/Moscow midnight boundary -- one minute before/after resolves to different calendar dates", () => {
    expect(toMoscowCalendarDate("2026-08-31T20:59:59.000Z")).toBe("2026-08-31");
    expect(toMoscowCalendarDate("2026-08-31T21:00:00.000Z")).toBe("2026-09-01");
  });
});

describe("resolveSeasonForCalendarDate", () => {
  it("Aug 31 -> old season (inclusive end boundary)", () => {
    expect(resolveSeasonForCalendarDate("2026-08-31", [OPENING, AUTUMN]).id).toBe("opening");
  });

  it("Sep 1 -> new season (inclusive start boundary), even while the old season row is still is_active", () => {
    expect(resolveSeasonForCalendarDate("2026-09-01", [OPENING, AUTUMN]).id).toBe("autumn");
  });

  it("UTC previous-calendar-day instant for a Sep 1 Moscow tournament still resolves to the September season", () => {
    const calendarDate = toMoscowCalendarDate("2026-08-31T21:30:00.000Z");
    expect(resolveSeasonForCalendarDate(calendarDate, [OPENING, AUTUMN]).id).toBe("autumn");
  });

  it("searches an INACTIVE future season too -- does not require is_active", () => {
    expect(AUTUMN.is_active).toBe(false);
    expect(resolveSeasonForCalendarDate("2026-09-15", [OPENING, AUTUMN]).id).toBe("autumn");
  });

  it("no matching season -> NoSeasonForDateError", () => {
    expect(() => resolveSeasonForCalendarDate("2026-12-25", [OPENING, AUTUMN])).toThrow(
      NoSeasonForDateError
    );
  });

  it("overlapping ranges -> AmbiguousSeasonError, fails closed rather than picking either", () => {
    const overlapping = season({ id: "overlap", start_date: "2026-08-15", end_date: "2026-09-15" });
    expect(() => resolveSeasonForCalendarDate("2026-08-20", [OPENING, overlapping])).toThrow(
      AmbiguousSeasonError
    );
  });

  it("open-ended (end_date null) last season resolves any date on/after its start", () => {
    const openEnded = season({ id: "open", start_date: "2026-09-01", end_date: null, is_active: false });
    expect(resolveSeasonForCalendarDate("2027-06-01", [OPENING, openEnded]).id).toBe("open");
  });
});

describe("validateSeasonRanges", () => {
  it("accepts a valid non-overlapping configuration", () => {
    expect(() => validateSeasonRanges([OPENING, AUTUMN])).not.toThrow();
  });

  it("rejects overlapping ranges", () => {
    const overlapping = season({ id: "overlap", start_date: "2026-08-15", end_date: "2026-09-15" });
    expect(() => validateSeasonRanges([OPENING, overlapping])).toThrow(SeasonRangeOverlapError);
  });

  it("rejects end_date before start_date", () => {
    const invalid = season({ id: "bad", start_date: "2026-09-01", end_date: "2026-08-01" });
    expect(() => validateSeasonRanges([invalid])).toThrow(InvalidSeasonRangeError);
  });

  it("rejects more than one open-ended (end_date null) season", () => {
    const openA = season({ id: "a", start_date: "2026-01-01", end_date: null });
    const openB = season({ id: "b", start_date: "2026-06-01", end_date: null });
    expect(() => validateSeasonRanges([openA, openB])).toThrow(InvalidSeasonRangeError);
  });

  it("rejects an open-ended season that is NOT the chronologically last one", () => {
    const earlyOpenEnded = season({ id: "early-open", start_date: "2026-01-01", end_date: null });
    const laterClosed = season({ id: "later", start_date: "2026-06-01", end_date: "2026-08-31" });
    expect(() => validateSeasonRanges([earlyOpenEnded, laterClosed])).toThrow(InvalidSeasonRangeError);
  });

  it("allows a single open-ended season that genuinely is the latest", () => {
    const openEnded = season({ id: "open", start_date: "2026-09-01", end_date: null, is_active: false });
    expect(() => validateSeasonRanges([OPENING, openEnded])).not.toThrow();
  });
});
