import { tournamentRepository, resultRepository } from "@/lib/repositories";
import { getTournamentDealerPayoutSummary } from "./dealers";
import { getTournamentAdminPayoutSummary } from "./admin-shifts";
import type { Tournament } from "@/types/domain";

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
  const [attendanceRows, dealerPayout, adminPayout] = await Promise.all([
    resultRepository.findAttendanceByTournamentId(tournament.id),
    getTournamentDealerPayoutSummary(tournament.id),
    getTournamentAdminPayoutSummary(tournament.id),
  ]);

  const attendance = summarizeTournamentAttendance(attendanceRows);

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
