import { NextResponse } from "next/server";
import { AdminShiftNotFoundError, InvalidShiftRangeError, endMyAdminShift } from "@/features/admin-shifts";
import { assertServerActorRole, UnauthorizedActionError, ForbiddenActionError } from "@/lib/admin-auth";

// "Закончить смену" -- self-service only. Deliberately takes NO shiftId at
// all: endMyAdminShift resolves the caller's own OPEN shift server-side, so
// there is structurally no request parameter an operator could tamper with
// to end another admin's shift.
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const actor = await assertServerActorRole(["admin", "operator"]);

    const body = (await request.json().catch(() => null)) as { endedAt?: string } | null;
    const endedAt = body?.endedAt?.trim();
    if (!endedAt) {
      return NextResponse.json({ error: "Не указано время окончания" }, { status: 400 });
    }

    const shift = await endMyAdminShift(actor.id, endedAt);
    return NextResponse.json({ shift });
  } catch (error) {
    if (error instanceof UnauthorizedActionError) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    if (error instanceof ForbiddenActionError) {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    if (error instanceof AdminShiftNotFoundError) {
      return NextResponse.json({ error: "Открытая смена не найдена" }, { status: 404 });
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
