import { NextResponse } from "next/server";
import {
  DealerAlreadyOnShiftError,
  DealerNotActiveError,
  InvalidTournamentIdError,
  startDealerShift,
} from "@/features/dealers";
import { resolveCurrentServerActor } from "@/lib/admin-auth";

export const dynamic = "force-dynamic";

// "Начать смену" -- server re-confirms the dealer is active and has no
// other open shift (on top of the DB-level partial unique index) before
// snapshotting the current hourly_rate_rub into the new shift. Actor
// attribution (created_by_player_id) is resolved from the authenticated
// caller server-side -- the client can no longer submit it (see
// lib/admin-auth.ts's resolveCurrentServerActor, the same mechanism
// middleware.ts itself uses to authorize this route in the first place).
export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => null)) as
      | { dealerPlayerId?: string; startedAt?: string; tournamentId?: string | null }
      | null;

    const dealerPlayerId = body?.dealerPlayerId?.trim();
    const startedAt = body?.startedAt?.trim();

    if (!dealerPlayerId || !startedAt) {
      return NextResponse.json({ error: "Не указан дилер или время прихода" }, { status: 400 });
    }

    const actor = await resolveCurrentServerActor();
    const tournamentId = body?.tournamentId?.trim() || null;

    const shift = await startDealerShift(dealerPlayerId, startedAt, tournamentId, actor?.id ?? null);
    return NextResponse.json({ shift });
  } catch (error) {
    if (error instanceof DealerNotActiveError) {
      return NextResponse.json({ error: "Дилер не активен" }, { status: 409 });
    }
    if (error instanceof DealerAlreadyOnShiftError) {
      return NextResponse.json({ error: "У дилера уже есть открытая смена" }, { status: 409 });
    }
    if (error instanceof InvalidTournamentIdError) {
      return NextResponse.json({ error: "Турнир не найден" }, { status: 400 });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Не удалось начать смену" },
      { status: 400 }
    );
  }
}
