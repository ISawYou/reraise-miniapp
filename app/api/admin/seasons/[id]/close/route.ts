import { NextResponse } from "next/server";
import { closeSeason } from "@/features/seasons";

// Season finalization -- protected by middleware.ts's blanket
// `/api/admin/:path*` admin-role gate. Explicit, one-off admin action, not
// a cron/scheduled job. See features/seasons.ts::closeSeason for the full
// finalization semantics (winner determination, tie handling, Number One
// grant, idempotency).
export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;

  try {
    const result = await closeSeason(id);

    if (result.status === "tie") {
      return NextResponse.json(
        {
          error:
            "Ничья за 1-е место — Number One не может быть определён автоматически. Сезон НЕ закрыт.",
          ...result,
        },
        { status: 409 }
      );
    }

    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Не удалось закрыть сезон" },
      { status: 400 }
    );
  }
}
