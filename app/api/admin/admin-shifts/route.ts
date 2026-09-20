import { NextResponse } from "next/server";
import {
  listAdminShiftsForManagement,
  createHistoricalAdminShift,
  AdminShiftTargetPlayerNotFoundError,
  InvalidStaffPlayerError,
  InvalidTournamentIdError,
  InvalidShiftRangeError,
  InvalidAmountError,
  TournamentRequiredError,
  AdminShiftDuplicateError,
  AdminShiftOverlapError,
} from "@/features/admin-shifts";
import { resolveCurrentServerActor } from "@/lib/admin-auth";

// Super-Admin-only (not on the operator allowlist -- see
// lib/admin-permissions.ts. "View all admin shifts" / "historical
// backfill" are both explicitly Super Admin capabilities per this
// release's scope).
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const shifts = await listAdminShiftsForManagement();
    return NextResponse.json({ shifts });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Не удалось загрузить смены" },
      { status: 500 }
    );
  }
}

// "Добавить прошлую смену" -- historical backfill, always created already
// COMPLETED (see createHistoricalAdminShift's doc comment). tournamentId
// is required here specifically, unlike the live self-service flow.
export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => null)) as
      | {
          adminPlayerId?: string;
          tournamentId?: string;
          startedAt?: string;
          endedAt?: string;
          amountRub?: number;
        }
      | null;

    const adminPlayerId = body?.adminPlayerId?.trim();
    const tournamentId = body?.tournamentId?.trim();
    const startedAt = body?.startedAt?.trim();
    const endedAt = body?.endedAt?.trim();

    if (!adminPlayerId || !tournamentId || !startedAt || !endedAt) {
      return NextResponse.json(
        { error: "adminPlayerId, tournamentId, startedAt и endedAt обязательны" },
        { status: 400 }
      );
    }
    if (typeof body?.amountRub !== "number") {
      return NextResponse.json({ error: "amountRub обязателен" }, { status: 400 });
    }

    const actor = await resolveCurrentServerActor();
    const shift = await createHistoricalAdminShift({
      adminPlayerId,
      tournamentId,
      startedAt,
      endedAt,
      amountRub: body.amountRub,
      createdByPlayerId: actor?.id ?? null,
    });
    return NextResponse.json({ shift });
  } catch (error) {
    if (error instanceof AdminShiftTargetPlayerNotFoundError) {
      return NextResponse.json({ error: "Игрок не найден" }, { status: 400 });
    }
    if (error instanceof InvalidStaffPlayerError) {
      return NextResponse.json(
        { error: "Игрок не является сотрудником (администратор/супер-администратор)" },
        { status: 400 }
      );
    }
    if (error instanceof InvalidTournamentIdError || error instanceof TournamentRequiredError) {
      return NextResponse.json({ error: "Турнир не найден или не указан" }, { status: 400 });
    }
    if (error instanceof InvalidShiftRangeError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    if (error instanceof InvalidAmountError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    if (error instanceof AdminShiftDuplicateError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    if (error instanceof AdminShiftOverlapError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Не удалось создать смену" },
      { status: 400 }
    );
  }
}
