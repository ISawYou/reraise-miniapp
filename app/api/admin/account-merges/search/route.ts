import { NextResponse } from "next/server";
import { AccountMergeUnavailableError, searchPlayersForAdminMerge } from "@/lib/player-merge";
import { assertServerActorRole, ForbiddenActionError, UnauthorizedActionError } from "@/lib/admin-auth";

// Super-Admin Merge Center player search. Behind middleware.ts's
// /api/admin/:path* matcher AND deliberately absent from
// lib/admin-permissions.ts's operator allowlist (operators get 403 there),
// plus an explicit admin-only check here -- never relies on the client.
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    await assertServerActorRole(["admin"]);

    const query = new URL(request.url).searchParams.get("q") ?? "";
    const players = await searchPlayersForAdminMerge(query.slice(0, 200));

    return NextResponse.json({ players });
  } catch (error) {
    if (error instanceof UnauthorizedActionError) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    if (error instanceof ForbiddenActionError) {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    if (error instanceof AccountMergeUnavailableError) {
      return NextResponse.json({ error: "Объединение аккаунтов временно недоступно" }, { status: 503 });
    }
    console.error("[admin-account-merge] search failed:", error instanceof Error ? error.name : "unknown");
    return NextResponse.json({ error: "Не удалось выполнить поиск" }, { status: 500 });
  }
}
