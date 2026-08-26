import { NextResponse } from "next/server";
import {
  DealerShiftNotFoundError,
  DealerShiftOpenError,
  InvalidShiftRangeError,
  editDealerShiftTimestamps,
} from "@/features/dealers";

export const dynamic = "force-dynamic";

// "Изменить" a completed shift -- only started_at/ended_at are accepted;
// worked_minutes/paid_hours/amount_rub are always recalculated
// server-side, and the shift's snapshotted hourly_rate_rub is left
// untouched (never re-read from the dealer's current profile rate).
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ shiftId: string }> }
) {
  const { shiftId } = await params;

  try {
    const body = (await request.json().catch(() => null)) as
      | { startedAt?: string; endedAt?: string }
      | null;

    const startedAt = body?.startedAt?.trim();
    const endedAt = body?.endedAt?.trim();

    if (!startedAt || !endedAt) {
      return NextResponse.json({ error: "Не указано время прихода или ухода" }, { status: 400 });
    }

    const shift = await editDealerShiftTimestamps(shiftId, startedAt, endedAt);
    return NextResponse.json({ shift });
  } catch (error) {
    if (error instanceof DealerShiftNotFoundError) {
      return NextResponse.json({ error: "Смена не найдена" }, { status: 404 });
    }
    if (error instanceof DealerShiftOpenError) {
      return NextResponse.json({ error: "Нельзя редактировать открытую смену" }, { status: 409 });
    }
    if (error instanceof InvalidShiftRangeError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Не удалось изменить смену" },
      { status: 400 }
    );
  }
}
