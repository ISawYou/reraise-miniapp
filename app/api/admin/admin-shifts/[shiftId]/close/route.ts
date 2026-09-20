import { NextResponse } from "next/server";
import {
  AdminShiftNotFoundError,
  AdminShiftAlreadyClosedError,
  AdminShiftOverlapError,
  InvalidAmountError,
  InvalidShiftRangeError,
  InvalidTournamentIdError,
  closeAdminShiftAsSuperAdmin,
} from "@/features/admin-shifts";
import { resolveCurrentServerActor } from "@/lib/admin-auth";

// Super-Admin-only (not on the operator allowlist -- see
// lib/admin-permissions.ts). Closes ANOTHER admin's forgotten-open shift
// -- a real operational case distinct from the completed-shift correction
// flow (PATCH .../admin-shifts/:shiftId, which explicitly refuses an open
// shift). Never accepts adminPlayerId or startedAt -- the owner and start
// time are fixed; only endedAt/tournamentId/amountRub can be supplied.
export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ shiftId: string }> }
) {
  const { shiftId } = await params;

  try {
    const body = (await request.json().catch(() => null)) as
      | { endedAt?: string; tournamentId?: string | null; amountRub?: number }
      | null;

    const endedAt = body?.endedAt?.trim();
    if (!endedAt) {
      return NextResponse.json({ error: "Не указано время окончания" }, { status: 400 });
    }

    const actor = await resolveCurrentServerActor();
    const shift = await closeAdminShiftAsSuperAdmin(
      shiftId,
      {
        endedAt,
        tournamentId: body && "tournamentId" in body ? (body.tournamentId ?? null) : undefined,
        amountRub: body?.amountRub,
      },
      actor?.id ?? null
    );
    return NextResponse.json({ shift });
  } catch (error) {
    if (error instanceof AdminShiftNotFoundError) {
      return NextResponse.json({ error: "Смена не найдена" }, { status: 404 });
    }
    if (error instanceof AdminShiftAlreadyClosedError) {
      return NextResponse.json({ error: "Смена уже завершена" }, { status: 409 });
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
      { error: error instanceof Error ? error.message : "Не удалось завершить смену" },
      { status: 400 }
    );
  }
}
