import { NextResponse } from "next/server";
import { getPersonalDealerSummary } from "@/features/dealers";
import { resolveCurrentServerActor } from "@/lib/admin-auth";

// Player-facing "Моя работа" personal read path -- NOT under /api/admin, no
// middleware.ts involvement. Identity comes only from the authenticated
// caller (Telegram initData or the reraise_session web cookie, via the same
// resolveCurrentServerActor used across /api/admin -- see lib/admin-auth.ts),
// never from a client-supplied playerId. A dealer can only ever see their
// own dealer_profiles/dealer_shifts rows this way.
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const actor = await resolveCurrentServerActor();
    if (!actor) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const summary = await getPersonalDealerSummary(actor.id);
    return NextResponse.json(summary);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Не удалось загрузить данные" },
      { status: 500 }
    );
  }
}
