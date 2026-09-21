import { tournamentRepository, resultRepository, dealerRepository, playerRepository } from "@/lib/repositories";
import { getTournamentDealerPayoutSummary } from "./dealers";
import { getTournamentAdminPayoutSummary } from "./admin-shifts";
import type { Tournament } from "@/types/domain";
import type { ResultAttendanceRow } from "@/lib/repositories/result/ResultRepository";

// RERAISE Finance data foundation. Exposes completed-tournament operational
// data (frozen `results` + completed `dealer_shifts`) so the separate
// RERAISE Finance app can import it as its own frozen snapshot -- see
// app/api/internal/finance/tournaments/route.ts and CLAUDE.md's "Finance
// will eventually receive RERAISE operational data only through a
// protected read-only HTTP API exposed by RERAISE main". Never reads live
// tournament state (tournament_live_entries etc.), never writes anything.

export type FinanceTournamentExportRow = {
  sourceTournamentId: string;
  title: string;
  tournamentType: string;
  startAt: string;
  playersCount: number;
  entryCount: number;
  reentryCount: number;
  addonCount: number;
  // Actually-used free payment units (results.free_reentries, summed for
  // arrived players -- see summarizeTournamentAttendance). NOT
  // players.free_reentries_balance and NOT the referral/Yandex reward
  // system -- an unrelated, per-tournament factual count. RERAISE performs
  // no monetary calculation on this; Finance subtracts it from
  // entry+reentry+addon itself. Additive alongside the existing raw counts
  // -- entryCount/reentryCount/addonCount are never reduced by it.
  freeReentryCount: number;
  // Automatic analytical classification of freeReentryCount by likely
  // cause -- purely additive breakdown of the SAME total above, never a
  // second count. See classifyFreeReentries's doc comment for the
  // priority rules and lib/roles.ts for what "owner"/"operator" mean at
  // the DB level. Always present when the tournament was exported at all
  // (buildExportRow throws rather than exporting an inconsistent one --
  // see FreeReentryBreakdownInvariantError).
  freeReentryBreakdown: FreeReentryBreakdown;
  dealerPayrollRub: number;
  // SUM(amount_rub) of COMPLETED admin_shifts (ended_at IS NOT NULL)
  // linked to this tournament -- see
  // features/admin-shifts.ts::getTournamentAdminPayoutSummary. Live
  // self-service shifts and historical/backfilled ones are indistinguishable
  // once completed (same table, no separate concept) -- both count
  // identically. A shift with no tournament_id, or one still open, never
  // contributes. Zero is a legitimate value, not a data-quality signal --
  // never folded into attendanceUnknownCount/financiallyReliable below.
  adminPayrollRub: number;
  attendanceUnknownCount: number;
  financiallyReliable: boolean;
  // No column on `tournaments` or `results` represents "last meaningfully
  // updated" today (tournaments.created_at is insert-time only; results has
  // no updated_at at all -- see lib/db/schema/tournaments.ts /
  // lib/db/schema/results.ts). Never invented/backfilled: null until a
  // real, reliable column exists to source this from.
  sourceUpdatedAt: string | null;
};

export type TournamentAttendanceSummary = {
  playersCount: number;
  entryCount: number;
  reentryCount: number;
  addonCount: number;
  freeReentryCount: number;
  attendanceUnknownCount: number;
  financiallyReliable: boolean;
};

// Historical `results.reentries` stores "total entries including the
// initial entry" (reentries=1 means the player entered once with no
// re-entry at all; reentries=3 means two actual re-entries). Finance's
// reentryCount must be the count of entries BEYOND the first -- normalized
// here, once, so Finance never needs to learn this table's historical
// convention.
function normalizeReentryCount(rawReentries: number): number {
  return Math.max(rawReentries - 1, 0);
}

// Pure aggregation over one tournament's frozen `results` rows.
// `arrived` is tri-state (NULL on historical rows predating the column) --
// NULL is never treated as false. It is excluded from every count below
// and tracked separately via attendanceUnknownCount, which is exactly what
// financiallyReliable gates on. This is a DIFFERENT, stricter convention
// than isEffectiveArrivedResult (lib/repositories/result/ResultRepository.ts)
// -- that helper's rating-points fallback is never reused here.
export function summarizeTournamentAttendance(
  rows: Array<{
    arrived: boolean | null;
    reentries: number;
    addons: number;
    free_reentries?: number | null;
  }>
): TournamentAttendanceSummary {
  let playersCount = 0;
  let reentryCount = 0;
  let addonCount = 0;
  let freeReentryCount = 0;
  let attendanceUnknownCount = 0;

  for (const row of rows) {
    if (row.arrived === true) {
      playersCount += 1;
      reentryCount += normalizeReentryCount(row.reentries);
      addonCount += row.addons;
      // Same population as reentryCount/addonCount above (arrived players
      // only) -- a free unit is only ever consumed against a unit this
      // player actually paid/attended for. Null/undefined (legacy rows,
      // or the Supabase provider, which has no such column at all --
      // see SupabaseResultRepository.ts) normalized to 0, never guessed.
      freeReentryCount += row.free_reentries ?? 0;
    } else if (row.arrived === null) {
      attendanceUnknownCount += 1;
    }
    // row.arrived === false: not counted anywhere, deliberately.
  }

  return {
    playersCount,
    entryCount: playersCount,
    reentryCount,
    addonCount,
    freeReentryCount,
    attendanceUnknownCount,
    financiallyReliable: attendanceUnknownCount === 0,
  };
}

// Automatic analytical classification of freeReentryCount -- "why" a free
// unit was used, as far as it can be inferred from data RERAISE already
// has. "Промо" (promoFreeCount) is deliberately a single catch-all bucket
// for every cause this data can't distinguish (girls, referral/friend
// bonuses, reviews, other promotions, and historically-unknown reasons) --
// see this feature's task doc comment, never split further here.
export type FreeReentryBreakdown = {
  ownerFreeCount: number;
  operatorFreeCount: number;
  dealerFreeCount: number;
  promoFreeCount: number;
};

// A completed dealer shift's flat payout only ever covers up to 2 free
// game units per tournament (matches the existing dealer-shift payroll
// convention of a flat per-shift amount, not a per-unit one) -- any
// free_reentries beyond that for the same player/tournament falls back to
// Promo, never silently over-counted as dealer-caused.
const DEALER_FREE_UNIT_CAP = 2;

export class FreeReentryBreakdownInvariantError extends Error {
  constructor(tournamentId: string, expected: number, actual: number) {
    super(
      `Free re-entry breakdown for tournament ${tournamentId} sums to ${actual}, expected ${expected} (freeReentryCount) -- refusing to export an inconsistent breakdown`
    );
    this.name = "FreeReentryBreakdownInvariantError";
  }
}

// Classifies the SAME freeReentryCount total already computed by
// summarizeTournamentAttendance -- never a second/parallel count, purely a
// per-player breakdown of it. STRICT priority, checked in this order for
// every arrived player with free_reentries > 0:
//
//   A. role === "admin"    (DB "admin" = Super Admin / owner)  -> ownerFreeCount, all of it
//   B. role === "operator" (DB "operator" = club Administrator) -> operatorFreeCount, all of it
//   C. worked a COMPLETED dealer shift tied to THIS tournament  -> dealerFreeCount, up to
//      DEALER_FREE_UNIT_CAP units; any remainder -> promoFreeCount
//   D. none of the above                                        -> promoFreeCount, all of it
//
// Role classification uses the player's CURRENT role (no role-history in
// this codebase yet) -- see this feature's task doc comment for why that's
// an accepted, deliberate limitation for historical tournaments, not a bug.
export function classifyFreeReentries(
  rows: Pick<ResultAttendanceRow, "player_id" | "arrived" | "free_reentries">[],
  roleByPlayerId: ReadonlyMap<string, string>,
  dealerPlayerIdsForTournament: ReadonlySet<string>
): FreeReentryBreakdown {
  let ownerFreeCount = 0;
  let operatorFreeCount = 0;
  let dealerFreeCount = 0;
  let promoFreeCount = 0;

  for (const row of rows) {
    if (row.arrived !== true) continue;
    const free = row.free_reentries ?? 0;
    if (free <= 0) continue;

    const role = roleByPlayerId.get(row.player_id);
    if (role === "admin") {
      ownerFreeCount += free;
    } else if (role === "operator") {
      operatorFreeCount += free;
    } else if (dealerPlayerIdsForTournament.has(row.player_id)) {
      const dealerUnits = Math.min(free, DEALER_FREE_UNIT_CAP);
      dealerFreeCount += dealerUnits;
      promoFreeCount += free - dealerUnits;
    } else {
      promoFreeCount += free;
    }
  }

  return { ownerFreeCount, operatorFreeCount, dealerFreeCount, promoFreeCount };
}

export type FinanceTournamentExportOptions = {
  from?: string;
  to?: string;
};

function toRangeStart(date?: string): Date | undefined {
  return date ? new Date(`${date}T00:00:00.000Z`) : undefined;
}

function toRangeEnd(date?: string): Date | undefined {
  return date ? new Date(`${date}T23:59:59.999Z`) : undefined;
}

async function buildExportRow(tournament: Tournament): Promise<FinanceTournamentExportRow> {
  const [attendanceRows, dealerPayout, adminPayout, dealerShifts] = await Promise.all([
    resultRepository.findAttendanceByTournamentId(tournament.id),
    getTournamentDealerPayoutSummary(tournament.id),
    getTournamentAdminPayoutSummary(tournament.id),
    dealerRepository.listShiftsByTournamentId(tournament.id),
  ]);

  const attendance = summarizeTournamentAttendance(attendanceRows);

  // Only the players who actually need classifying (arrived, free_reentries
  // > 0) -- one bulk role lookup per tournament, never per-row (see
  // playerRepository.findSummariesByIds's own doc comment: it already
  // exists for exactly this kind of bulk id->role lookup).
  const freeReentryPlayerIds = Array.from(
    new Set(
      attendanceRows
        .filter((row) => row.arrived === true && (row.free_reentries ?? 0) > 0)
        .map((row) => row.player_id)
    )
  );
  const roleSummaries = freeReentryPlayerIds.length
    ? await playerRepository.findSummariesByIds(freeReentryPlayerIds)
    : [];
  const roleByPlayerId = new Map(roleSummaries.map((player) => [player.id, player.role]));

  // Same "only COMPLETED shifts count" convention as
  // getTournamentDealerPayoutSummary above -- an open shift never makes a
  // player count as "worked this tournament" for classification either.
  const dealerPlayerIdsForTournament = new Set(
    dealerShifts.filter((shift) => shift.ended_at !== null).map((shift) => shift.dealer_player_id)
  );

  const freeReentryBreakdown = classifyFreeReentries(
    attendanceRows,
    roleByPlayerId,
    dealerPlayerIdsForTournament
  );
  const breakdownSum =
    freeReentryBreakdown.ownerFreeCount +
    freeReentryBreakdown.operatorFreeCount +
    freeReentryBreakdown.dealerFreeCount +
    freeReentryBreakdown.promoFreeCount;
  if (breakdownSum !== attendance.freeReentryCount) {
    throw new FreeReentryBreakdownInvariantError(tournament.id, attendance.freeReentryCount, breakdownSum);
  }

  return {
    sourceTournamentId: tournament.id,
    title: tournament.title,
    tournamentType: tournament.tournament_type,
    startAt: tournament.start_at,
    playersCount: attendance.playersCount,
    entryCount: attendance.entryCount,
    reentryCount: attendance.reentryCount,
    addonCount: attendance.addonCount,
    freeReentryCount: attendance.freeReentryCount,
    freeReentryBreakdown,
    dealerPayrollRub: dealerPayout.payoutRub,
    adminPayrollRub: adminPayout.payoutRub,
    attendanceUnknownCount: attendance.attendanceUnknownCount,
    financiallyReliable: attendance.financiallyReliable,
    sourceUpdatedAt: null,
  };
}

// Completed tournaments only, optionally bounded by start_at (inclusive
// UTC day boundaries on either end -- either bound omitted means unbounded
// on that side).
export async function getFinanceTournamentExport(
  options: FinanceTournamentExportOptions = {}
): Promise<FinanceTournamentExportRow[]> {
  const tournaments = await tournamentRepository.listCompletedInRange(
    toRangeStart(options.from),
    toRangeEnd(options.to)
  );

  return Promise.all(tournaments.map(buildExportRow));
}
