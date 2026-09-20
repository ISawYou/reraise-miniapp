import { NextResponse } from "next/server";
import { AdminShiftNotFoundError, InvalidAmountError, setAdminShiftAmount } from "@/features/admin-shifts";
import { resolveCurrentServerActor } from "@/lib/admin-auth";

// Super-Admin-only (not on the operator allowlist -- explicit correction
// of amount_rub is a Super Admin capability, per this release's "operator
// must never edit the payout amount, not even their own" requirement).
// The ONLY field this route ever writes is amount_rub -- never
// started_at/ended_at/tournament_id.
export const dynamic = "force-dynamic";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ shiftId: string }> }
) {
  const { shiftId } = await params;

  try {
    const body = (await request.json().catch(() => null)) as { amountRub?: number } | null;
    if (!body || typeof body.amountRub !== "number") {
      return NextResponse.json({ error: "amountRub обязателен" }, { status: 400 });
    }

    const actor = await resolveCurrentServerActor();
    const shift = await setAdminShiftAmount(shiftId, body.amountRub, actor?.id ?? null);
    return NextResponse.json({ shift });
  } catch (error) {
    if (error instanceof AdminShiftNotFoundError) {
      return NextResponse.json({ error: "Смена не найдена" }, { status: 404 });
    }
    if (error instanceof InvalidAmountError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Не удалось изменить сумму" },
      { status: 400 }
    );
  }
}
