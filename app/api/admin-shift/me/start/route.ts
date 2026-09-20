import { NextResponse } from "next/server";
import {
  AdminShiftAlreadyOnShiftError,
  InvalidShiftRangeError,
  InvalidTournamentIdError,
  startAdminShift,
} from "@/features/admin-shifts";
import { assertServerActorRole, UnauthorizedActionError, ForbiddenActionError } from "@/lib/admin-auth";

// "Начать смену" -- self-service only. adminPlayerId is ALWAYS the
// authenticated caller's own id, resolved server-side via
// assertServerActorRole -- the client cannot submit a different one (there
// is no such field in the request body at all), so an operator has no way
// to start a shift for another admin even by tampering with the request.
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const actor = await assertServerActorRole(["admin", "operator"]);

    const body = (await request.json().catch(() => null)) as
      | { startedAt?: string; tournamentId?: string | null }
      | null;

    const startedAt = body?.startedAt?.trim();
    if (!startedAt) {
      return NextResponse.json({ error: "Не указано время начала" }, { status: 400 });
    }

    const tournamentId = body?.tournamentId?.trim() || null;

    const shift = await startAdminShift(actor.id, startedAt, tournamentId);
    return NextResponse.json({ shift });
  } catch (error) {
    if (error instanceof UnauthorizedActionError) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    if (error instanceof ForbiddenActionError) {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    if (error instanceof AdminShiftAlreadyOnShiftError) {
      return NextResponse.json({ error: "У вас уже есть открытая смена" }, { status: 409 });
    }
    if (error instanceof InvalidTournamentIdError) {
      return NextResponse.json({ error: "Турнир не найден" }, { status: 400 });
    }
    if (error instanceof InvalidShiftRangeError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Не удалось начать смену" },
      { status: 400 }
    );
  }
}
