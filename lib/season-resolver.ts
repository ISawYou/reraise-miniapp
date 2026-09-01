// Canonical season-resolution logic -- the ONE place that turns a
// tournament date into a season. Reused by tournament create/edit
// (features/tournaments.ts), the reconciliation resync, and the admin
// season-preview endpoint. Nothing else in the app may re-implement this
// date math (see this module's callers).
//
// Product rule: the tournament DATE decides its season, not the currently
// active season. `tournaments.season_id` is a persisted historical
// assignment computed once (at create/edit time) from this rule -- it is
// deliberately NOT re-derived every time a leaderboard is read.
import type { SeasonFullRow } from "@/lib/repositories/season/SeasonRepository";

const CLUB_TIME_ZONE = "Europe/Moscow";

// YYYY-MM-DD in the club's own calendar, not the server/UTC calendar day --
// a tournament at 2026-09-01 00:30 Europe/Moscow is 2026-08-31 21:30 UTC,
// and must resolve against "2026-09-01", not "2026-08-31". Intl's
// timeZone-aware formatter (not manual +3h math) so this stays correct even
// if Russia's DST rules ever change again -- ICU data is the source of
// truth, not a hardcoded offset.
const moscowDateFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: CLUB_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

export function toMoscowCalendarDate(input: string | Date): string {
  const date = typeof input === "string" ? new Date(input) : input;
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid date: ${String(input)}`);
  }
  // en-CA locale formats as YYYY-MM-DD directly -- no manual part reassembly.
  return moscowDateFormatter.format(date);
}

export class NoSeasonForDateError extends Error {
  constructor(public readonly calendarDate: string) {
    super(`Для даты турнира ${formatRu(calendarDate)} не настроен сезон`);
    this.name = "NoSeasonForDateError";
  }
}

export class AmbiguousSeasonError extends Error {
  constructor(public readonly calendarDate: string, public readonly seasonIds: string[]) {
    super(
      `Для даты турнира ${formatRu(calendarDate)} настроено несколько пересекающихся сезонов (${seasonIds.join(", ")}) — ошибка конфигурации сезонов`
    );
    this.name = "AmbiguousSeasonError";
  }
}

export class InvalidSeasonRangeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidSeasonRangeError";
  }
}

export class SeasonRangeOverlapError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SeasonRangeOverlapError";
  }
}

function formatRu(calendarDate: string): string {
  const [year, month, day] = calendarDate.split("-");
  return `${day}.${month}.${year}`;
}

// A season's range is inclusive on both ends; `end_date: null` means
// open-ended (only ever valid for the chronologically last range -- see
// validateSeasonRanges). Plain string comparison is safe because every
// date here is the same YYYY-MM-DD shape, which sorts identically to
// chronological order.
function dateInRange(calendarDate: string, season: Pick<SeasonFullRow, "start_date" | "end_date">): boolean {
  if (calendarDate < season.start_date) return false;
  if (season.end_date !== null && calendarDate > season.end_date) return false;
  return true;
}

// Resolves the ONE season a given club-calendar date belongs to. Searches
// EVERY season passed in, active or not -- a future, still-inactive season
// must be resolvable before it's ever activated (September tournaments
// created while "Открытие" is still active).
export function resolveSeasonForCalendarDate(
  calendarDate: string,
  seasons: readonly SeasonFullRow[]
): SeasonFullRow {
  const matches = seasons.filter((season) => dateInRange(calendarDate, season));

  if (matches.length === 0) {
    throw new NoSeasonForDateError(calendarDate);
  }
  if (matches.length > 1) {
    throw new AmbiguousSeasonError(
      calendarDate,
      matches.map((season) => season.id)
    );
  }

  return matches[0];
}

// Full-set consistency check -- run at season create/edit time (fail
// closed BEFORE writing a range that would make some date unresolvable or
// ambiguous), not at every resolution call. Two ranges overlap if either's
// start falls within the other's [start, end-or-infinity] span.
export function validateSeasonRanges(seasons: readonly SeasonFullRow[]): void {
  for (const season of seasons) {
    if (season.end_date !== null && season.end_date < season.start_date) {
      throw new InvalidSeasonRangeError(
        `Сезон "${season.title}": дата окончания раньше даты начала`
      );
    }
  }

  const openEnded = seasons.filter((season) => season.end_date === null);
  if (openEnded.length > 1) {
    throw new InvalidSeasonRangeError(
      `Больше одного открытого (без даты окончания) сезона: ${openEnded.map((s) => s.title).join(", ")}`
    );
  }
  if (openEnded.length === 1) {
    const [open] = openEnded;
    const isLatest = seasons.every(
      (season) => season.id === open.id || season.start_date <= open.start_date
    );
    if (!isLatest) {
      throw new InvalidSeasonRangeError(
        `Сезон "${open.title}" открыт (без даты окончания), но начинается раньше другого сезона — открытым может быть только последний по времени сезон`
      );
    }
  }

  const sorted = [...seasons].sort((a, b) => a.start_date.localeCompare(b.start_date));
  for (let i = 0; i < sorted.length; i++) {
    for (let j = i + 1; j < sorted.length; j++) {
      const a = sorted[i];
      const b = sorted[j];
      const aEnd = a.end_date ?? "9999-12-31";
      // Inclusive ranges overlap unless one ends strictly before the other starts.
      if (b.start_date <= aEnd) {
        throw new SeasonRangeOverlapError(
          `Сезоны "${a.title}" и "${b.title}" пересекаются по датам`
        );
      }
    }
  }
}
