import { NextResponse } from "next/server";
import { getMyAdminShiftSummary } from "@/features/admin-shifts";
import { assertServerActorRole, UnauthorizedActionError, ForbiddenActionError } from "@/lib/admin-auth";

// Player-facing "Моя смена администратора" personal read path -- NOT under
// /api/admin, no middleware.ts involvement (same reasoning as
// /api/dealer/me). Both staff roles ('operator' and 'admin', see
// lib/roles.ts) may read their own shift status/history; a plain 'player'
// caller is rejected here explicitly, since admin shifts (unlike dealer
// profiles) are gated by staff role, not by a separate profile row.
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const actor = await assertServerActorRole(["admin", "operator"]);
    const summary = await getMyAdminShiftSummary(actor.id);
    return NextResponse.json(summary);
  } catch (error) {
    if (error instanceof UnauthorizedActionError) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    if (error instanceof ForbiddenActionError) {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Не удалось загрузить данные" },
      { status: 500 }
    );
  }
}
