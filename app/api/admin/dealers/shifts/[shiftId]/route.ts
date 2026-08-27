import { NextResponse } from "next/server";
import {
  DealerNotFoundError,
  DealerShiftNotFoundError,
  DealerShiftOpenError,
  InvalidShiftRangeError,
  InvalidTournamentIdError,
  InvalidTaxiAllowanceError,
  correctDealerShiftDealer,
  correctDealerShiftTournament,
  editDealerShiftTimestamps,
  setDealerShiftTaxiAllowance,
} from "@/features/dealers";

// Super-Admin-only (not on the operator allowlist -- "operator cannot edit
// completed shift", and financial mutation -- rate/taxi allowance -- stays
// Super-Admin-only too).
export const dynamic = "force-dynamic";

// Four independent, optional corrections on one shift, applied in any
// combination present in the body -- this is the ONLY write path for a
// completed shift's payroll-affecting fields; amount_rub itself is never
// directly editable, always recomputed:
// - startedAt/endedAt (+ optional hourlyRateRub): "Изменить" a COMPLETED
//   shift. worked_minutes/paid_hours/amount_rub are always recalculated
//   server-side from whichever timestamps/rate apply (existing rate kept
//   if hourlyRateRub is omitted) via the one canonical payroll formula.
// - tournamentId: correct the linked tournament.
// - dealerPlayerId: correct WHICH dealer a completed shift belongs to --
//   moves it between personal dealer history/stats immediately. Never
//   recalculates payroll.
// - taxiAllowanceRub: toggle "Чай" (0 or 500) -- unlike the others, this
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
      | {
          startedAt?: string;
          endedAt?: string;
          hourlyRateRub?: number;
          tournamentId?: string | null;
          dealerPlayerId?: string;
          taxiAllowanceRub?: number;
        }
      | null;

    let shift = null;

    if (body && "dealerPlayerId" in body && body.dealerPlayerId?.trim()) {
      shift = await correctDealerShiftDealer(shiftId, body.dealerPlayerId.trim());
    }

    const startedAt = body?.startedAt?.trim();
    const endedAt = body?.endedAt?.trim();

    if (startedAt && endedAt) {
      const hourlyRateRub =
        typeof body?.hourlyRateRub === "number" ? body.hourlyRateRub : undefined;
      shift = await editDealerShiftTimestamps(shiftId, startedAt, endedAt, hourlyRateRub);
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
    if (error instanceof DealerNotFoundError) {
      return NextResponse.json({ error: "Дилер не найден" }, { status: 400 });
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
