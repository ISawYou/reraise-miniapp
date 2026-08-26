import { NextResponse } from "next/server";
import { DealerAlreadyOnShiftError, DealerNotActiveError, startDealerShift } from "@/features/dealers";

export const dynamic = "force-dynamic";

// "Начать смену" -- server re-confirms the dealer is active and has no
// other open shift (on top of the DB-level partial unique index) before
// snapshotting the current hourly_rate_rub into the new shift.
export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => null)) as
      | { dealerPlayerId?: string; startedAt?: string; createdByPlayerId?: string | null }
      | null;

    const dealerPlayerId = body?.dealerPlayerId?.trim();
    const startedAt = body?.startedAt?.trim();

    if (!dealerPlayerId || !startedAt) {
      return NextResponse.json({ error: "Не указан дилер или время прихода" }, { status: 400 });
    }

    const shift = await startDealerShift(dealerPlayerId, startedAt, body?.createdByPlayerId ?? null);
    return NextResponse.json({ shift });
  } catch (error) {
    if (error instanceof DealerNotActiveError) {
      return NextResponse.json({ error: "Дилер не активен" }, { status: 409 });
    }
    if (error instanceof DealerAlreadyOnShiftError) {
      return NextResponse.json({ error: "У дилера уже есть открытая смена" }, { status: 409 });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Не удалось начать смену" },
      { status: 400 }
    );
  }
}
