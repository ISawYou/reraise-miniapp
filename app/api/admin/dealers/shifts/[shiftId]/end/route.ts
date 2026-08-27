import { NextResponse } from "next/server";
import {
  DealerShiftAlreadyClosedError,
  DealerShiftNotFoundError,
  InvalidShiftRangeError,
  endDealerShift,
} from "@/features/dealers";
import { resolveCurrentServerActor } from "@/lib/admin-auth";

export const dynamic = "force-dynamic";

// "Закончить смену" -- worked_minutes/paid_hours/amount_rub are always
// recalculated server-side from timestamps; the client's live preview is
// never trusted as the persisted value. Actor attribution
// (ended_by_player_id) is resolved from the authenticated caller
// server-side, same as starting a shift -- see shifts/route.ts.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ shiftId: string }> }
) {
  const { shiftId } = await params;

  try {
    const body = (await request.json().catch(() => null)) as { endedAt?: string } | null;

    const endedAt = body?.endedAt?.trim();
    if (!endedAt) {
      return NextResponse.json({ error: "Не указано время окончания" }, { status: 400 });
    }

    const actor = await resolveCurrentServerActor();
    const shift = await endDealerShift(shiftId, endedAt, actor?.id ?? null);
    return NextResponse.json({ shift });
  } catch (error) {
    if (error instanceof DealerShiftNotFoundError) {
      return NextResponse.json({ error: "Смена не найдена" }, { status: 404 });
    }
    if (error instanceof DealerShiftAlreadyClosedError) {
      return NextResponse.json({ error: "Смена уже завершена" }, { status: 409 });
    }
    if (error instanceof InvalidShiftRangeError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Не удалось завершить смену" },
      { status: 400 }
    );
  }
}
