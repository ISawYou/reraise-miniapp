import { NextResponse } from "next/server";
import { verifyFinanceSyncRequest } from "@/lib/finance-sync-auth";
import { getFinanceTournamentExport } from "@/features/finance-export";

// GET /api/internal/finance/tournaments?from=YYYY-MM-DD&to=YYYY-MM-DD
// Read-only, Bearer-auth (FINANCE_SYNC_TOKEN). Feeds the separate RERAISE
// Finance app's own frozen tournament snapshot -- see
// features/finance-export.ts's doc comment. Never exposes DB access, never
// accepts writes.
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!verifyFinanceSyncRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const tournaments = await getFinanceTournamentExport({
    from: url.searchParams.get("from") ?? undefined,
    to: url.searchParams.get("to") ?? undefined,
  });

  return NextResponse.json({ tournaments });
}
