import { NextResponse } from "next/server";
import {
  AdminShiftNotFoundError,
  AdminShiftOpenError,
  AdminShiftOverlapError,
  InvalidAmountError,
  InvalidShiftRangeError,
  InvalidTournamentIdError,
  setAdminShiftAmount,
  correctAdminShift,
} from "@/features/admin-shifts";
import { resolveCurrentServerActor } from "@/lib/admin-auth";

// Super-Admin-only (not on the operator allowlist -- explicit correction
// of a shift is a Super Admin capability, per this release's "operator
// must never edit timestamps/amount/tournament, not even their own"
// requirement).
//
// Two distinct paths, chosen by which keys the body contains:
// - amountRub ONLY: setAdminShiftAmount -- unchanged from before this
//   release, still works on an OPEN shift too (adjusting the payout
//   before an admin has even ended their own shift is a legitimate Super
//   Admin action, same as it always was).
// - tournamentId and/or startedAt/endedAt present (amountRub optionally
//   alongside): correctAdminShift -- the richer historical-correction
//   flow, COMPLETED shifts only (editing timestamps on a still-open shift
//   doesn't mean anything; end it via the self-service flow first).
// adminPlayerId is never accepted by either path -- reassigning a shift's
// owner is unsupported (see correctAdminShift's doc comment).
export const dynamic = "force-dynamic";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ shiftId: string }> }
) {
  const { shiftId } = await params;

  try {
    const body = (await request.json().catch(() => null)) as
      | {
          tournamentId?: string | null;
          startedAt?: string;
          endedAt?: string;
          amountRub?: number;
        }
      | null;

    if (!body) {
      return NextResponse.json({ error: "Нечего изменять" }, { status: 400 });
    }

    const actor = await resolveCurrentServerActor();
    const wantsFullCorrection =
      "tournamentId" in body || body.startedAt !== undefined || body.endedAt !== undefined;

    let shift;
    if (wantsFullCorrection) {
      shift = await correctAdminShift(
        shiftId,
        {
          tournamentId: "tournamentId" in body ? (body.tournamentId ?? null) : undefined,
          startedAt: body.startedAt,
          endedAt: body.endedAt,
          amountRub: body.amountRub,
        },
        actor?.id ?? null
      );
    } else if (typeof body.amountRub === "number") {
      shift = await setAdminShiftAmount(shiftId, body.amountRub, actor?.id ?? null);
    } else {
      return NextResponse.json({ error: "Нечего изменять" }, { status: 400 });
    }

    return NextResponse.json({ shift });
  } catch (error) {
    if (error instanceof AdminShiftNotFoundError) {
      return NextResponse.json({ error: "Смена не найдена" }, { status: 404 });
    }
    if (error instanceof AdminShiftOpenError) {
      return NextResponse.json({ error: "Нельзя редактировать открытую смену этим способом" }, { status: 409 });
    }
    if (error instanceof InvalidTournamentIdError) {
      return NextResponse.json({ error: "Турнир не найден" }, { status: 400 });
    }
    if (error instanceof InvalidShiftRangeError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    if (error instanceof InvalidAmountError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    if (error instanceof AdminShiftOverlapError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Не удалось изменить смену" },
      { status: 400 }
    );
  }
}
