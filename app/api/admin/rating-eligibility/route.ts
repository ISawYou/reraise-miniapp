import { NextResponse } from "next/server";
import { seasonRepository } from "@/lib/repositories";
import { listRatingEligibility, setRatingEligibility } from "@/features/rating-eligibility";
import { resolveCurrentServerActor } from "@/lib/admin-auth";

// "Зачёт рейтинга" -- Super-Admin-only, NOT on the operator allowlist (see
// lib/admin-permissions.ts), so middleware.ts already guarantees only
// role === 'admin' ever reaches these handlers (operator/player both get
// 403 from middleware before this code runs). Actor identity is still
// resolved server-side on PATCH, purely for created_by_player_id
// attribution -- never trusted from the client body.
export const dynamic = "force-dynamic";

export async function GET() {
  const season = await seasonRepository.findActive();
  if (!season) {
    return NextResponse.json({ error: "Активный сезон не найден" }, { status: 404 });
  }

  try {
    const players = await listRatingEligibility(season.id);
    return NextResponse.json({ season: { id: season.id, title: season.title }, players });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Не удалось загрузить список игроков" },
      { status: 500 }
    );
  }
}

export async function PATCH(request: Request) {
  const season = await seasonRepository.findActive();
  if (!season) {
    return NextResponse.json({ error: "Активный сезон не найден" }, { status: 404 });
  }

  try {
    const body = (await request.json().catch(() => null)) as
      | { playerId?: string; excluded?: boolean; reason?: string | null }
      | null;

    const playerId = body?.playerId?.trim();
    if (!playerId || typeof body?.excluded !== "boolean") {
      return NextResponse.json({ error: "Не указан игрок или статус" }, { status: 400 });
    }

    const actor = await resolveCurrentServerActor();
    if (!actor) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    await setRatingEligibility(season.id, playerId, body.excluded, body.reason ?? null, actor.id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Не удалось изменить статус зачёта" },
      { status: 400 }
    );
  }
}
