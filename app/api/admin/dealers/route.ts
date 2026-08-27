import { NextResponse } from "next/server";
import { activateDealer, listActiveDealers } from "@/features/dealers";
import { resolveCurrentServerActor } from "@/lib/admin-auth";

// GET is on the operator allowlist (see lib/admin-permissions.ts) --
// operator needs "see active dealers currently working". Everything else
// here (POST/activation) is Super-Admin-only, enforced by middleware.ts's
// fail-closed allowlist (this route's POST has no entry there).
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const actor = await resolveCurrentServerActor();
    const dealers = await listActiveDealers();

    // Operator gets a reduced, non-financial view -- hourly_rate_rub is
    // explicitly forbidden ("Do NOT expose: hourly rates" -- see the
    // operator dealer view spec). Super Admin gets the full payload
    // unchanged.
    if (actor?.role !== "admin") {
      return NextResponse.json({
        dealers: dealers.map((dealer) => ({
          player: dealer.player,
          openShift: dealer.openShift,
        })),
      });
    }

    return NextResponse.json({ dealers });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Не удалось загрузить дилеров" },
      { status: 500 }
    );
  }
}

// "Добавить дилера" -- activates (or re-activates) an EXISTING player's
// dealer profile. Never creates a second player row. Super-Admin-only
// (not on the operator allowlist).
export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => null)) as { playerId?: string } | null;
    const playerId = body?.playerId?.trim();

    if (!playerId) {
      return NextResponse.json({ error: "Не указан игрок" }, { status: 400 });
    }

    const profile = await activateDealer(playerId);
    return NextResponse.json({ profile });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Не удалось назначить дилера" },
      { status: 400 }
    );
  }
}
