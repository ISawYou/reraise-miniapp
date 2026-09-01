import { NextResponse } from "next/server";
import {
  DealerShiftNotFoundError,
  InvalidTaxiAllowanceError,
  setDealerShiftTaxiAllowance,
} from "@/features/dealers";
import { resolveCurrentServerActor } from "@/lib/admin-auth";

// Deliberately narrower than PATCH .../shifts/:shiftId (Super-Admin-only,
// can also reassign the dealer, edit timestamps/rate, and correct the
// tournament) -- this is the ONE dealer-shift correction an operator gets:
// toggle the existing fixed 0/500 "Чай" allowance on a shift, nothing else.
// On the operator allowlist, see lib/admin-permissions.ts.
export const dynamic = "force-dynamic";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ shiftId: string }> }
) {
  const { shiftId } = await params;

  try {
    const body = (await request.json().catch(() => null)) as
      | { taxiAllowanceRub?: number }
      | null;

    if (!body || typeof body.taxiAllowanceRub !== "number") {
      return NextResponse.json({ error: "taxiAllowanceRub обязателен" }, { status: 400 });
    }

    const shift = await setDealerShiftTaxiAllowance(shiftId, body.taxiAllowanceRub);
    const actor = await resolveCurrentServerActor();

    // An operator caller never sees hourly_rate_rub/amount_rub -- same
    // "allowed route, reduced payload" split as GET /api/admin/dealers.
    if (actor?.role !== "admin") {
      return NextResponse.json({
        shift: { id: shift.id, taxiAllowanceRub: shift.taxi_allowance_rub },
      });
    }

    return NextResponse.json({ shift });
  } catch (error) {
    if (error instanceof DealerShiftNotFoundError) {
      return NextResponse.json({ error: "Смена не найдена" }, { status: 404 });
    }
    if (error instanceof InvalidTaxiAllowanceError) {
      return NextResponse.json({ error: "Некорректная сумма чая" }, { status: 400 });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Не удалось изменить чай" },
      { status: 400 }
    );
  }
}
