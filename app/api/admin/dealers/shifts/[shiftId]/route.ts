import { NextResponse } from "next/server";
import {
  DealerShiftNotFoundError,
  DealerShiftOpenError,
  InvalidShiftRangeError,
  InvalidTournamentIdError,
  InvalidTaxiAllowanceError,
  correctDealerShiftTournament,
  editDealerShiftTimestamps,
  setDealerShiftTaxiAllowance,
} from "@/features/dealers";

// Super-Admin-only (not on the operator allowlist -- "operator cannot edit
// completed shift", and financial mutation -- taxi allowance -- stays
// Super-Admin-only too).
export const dynamic = "force-dynamic";

// Three independent, optional corrections on one shift, applied in any
// combination present in the body:
// - startedAt/endedAt: "Изменить" a COMPLETED shift's timestamps.
//   worked_minutes/paid_hours/amount_rub are always recalculated
//   server-side; the snapshotted hourly_rate_rub is left untouched.
// - tournamentId: correct the linked tournament.
// - taxiAllowanceRub: toggle "Чай" (0 or 500) -- unlike the two above, this
//   works on an OPEN shift too (see setDealerShiftTaxiAllowance's doc
//   comment), and never touches worked_minutes/paid_hours/hourly_rate_rub/
//   amount_rub.
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ shiftId: string }> }
) {
  const { shiftId } = await params;

  try {
    const body = (await request.json().catch(() => null)) as
      | { startedAt?: string; endedAt?: string; tournamentId?: string | null; taxiAllowanceRub?: number }
      | null;

    let shift = null;

    const startedAt = body?.startedAt?.trim();
    const endedAt = body?.endedAt?.trim();

    if (startedAt && endedAt) {
      shift = await editDealerShiftTimestamps(shiftId, startedAt, endedAt);
    }

    if (body && "tournamentId" in body) {
      shift = await correctDealerShiftTournament(shiftId, body.tournamentId?.trim() || null);
    }

    if (body && "taxiAllowanceRub" in body && typeof body.taxiAllowanceRub === "number") {
      shift = await setDealerShiftTaxiAllowance(shiftId, body.taxiAllowanceRub);
    }

    if (!shift) {
      return NextResponse.json({ error: "Нечего изменять" }, { status: 400 });
    }

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
    if (error instanceof InvalidTournamentIdError) {
      return NextResponse.json({ error: "Турнир не найден" }, { status: 400 });
    }
    if (error instanceof InvalidTaxiAllowanceError) {
      return NextResponse.json({ error: "Некорректная сумма чая" }, { status: 400 });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Не удалось изменить смену" },
      { status: 400 }
    );
  }
}
