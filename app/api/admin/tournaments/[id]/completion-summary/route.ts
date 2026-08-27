import { NextResponse } from "next/server";
import { getTournamentEntryStats } from "@/features/tournaments";
import { getTournamentDealerPayoutSummary } from "@/features/dealers";

// Super-Admin-only -- NOT on the operator allowlist (see
// lib/admin-permissions.ts). Bundles the completed-tournament admin summary
// (players/entries/rebuys/add-ons/free entries, from the canonical
// persisted results) with the dealer payout figures for this tournament,
// which are financial data and stay Super-Admin-only everywhere else in
// this app (dealer stats, dealer list) -- same boundary here.
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    const [entryStats, dealerPayout] = await Promise.all([
      getTournamentEntryStats(id),
      getTournamentDealerPayoutSummary(id),
    ]);

    return NextResponse.json({
      playersCount: entryStats.playersCount,
      totalEntries: entryStats.totalEntries,
      rebuysCount: entryStats.rebuysCount,
      addonsCount: entryStats.addonsCount,
      freeEntriesCount: entryStats.freeEntriesCount,
      dealersCount: dealerPayout.dealersCount,
      dealerPayoutRub: dealerPayout.payoutRub,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Не удалось загрузить сводку турнира" },
      { status: 500 }
    );
  }
}
