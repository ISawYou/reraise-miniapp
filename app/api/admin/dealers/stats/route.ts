import { NextResponse } from "next/server";
import { getDealerPayrollStats, type DealerStatsPeriod } from "@/features/dealers";

// Super-Admin-only -- not on the operator allowlist ("Do NOT expose:
// payroll totals, historical financial statistics" to operator).
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const periodParam = searchParams.get("period");
    const period: DealerStatsPeriod = periodParam === "all" ? "all" : "month";

    const stats = await getDealerPayrollStats(period);
    return NextResponse.json({ period, ...stats });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Не удалось загрузить статистику" },
      { status: 500 }
    );
  }
}
