import { NextResponse } from "next/server";
import { AccountMergeUnavailableError, previewAdminMerge } from "@/lib/player-merge";
import { assertServerActorRole, ForbiddenActionError, UnauthorizedActionError } from "@/lib/admin-auth";

// Read-only, server-computed merge preview for the Super-Admin Merge
// Center. Admin-only (not on the operator allowlist + explicit check here).
// executeAdminMerge never trusts this answer -- it recomputes everything
// inside its own SERIALIZABLE transaction.
export const dynamic = "force-dynamic";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(request: Request) {
  try {
    await assertServerActorRole(["admin"]);

    const body = (await request.json().catch(() => null)) as
      | { targetPlayerId?: unknown; sourcePlayerId?: unknown }
      | null;
    const targetPlayerId = body?.targetPlayerId;
    const sourcePlayerId = body?.sourcePlayerId;

    if (
      typeof targetPlayerId !== "string" ||
      typeof sourcePlayerId !== "string" ||
      !UUID_PATTERN.test(targetPlayerId) ||
      !UUID_PATTERN.test(sourcePlayerId)
    ) {
      return NextResponse.json({ error: "Выберите основной и присоединяемый аккаунты" }, { status: 400 });
    }

    const preview = await previewAdminMerge({
      targetPlayerId: targetPlayerId.toLowerCase(),
      sourcePlayerId: sourcePlayerId.toLowerCase(),
    });

    return NextResponse.json({ preview });
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
    console.error("[admin-account-merge] preview failed:", error instanceof Error ? error.name : "unknown");
    return NextResponse.json({ error: "Не удалось построить предпросмотр" }, { status: 500 });
  }
}
