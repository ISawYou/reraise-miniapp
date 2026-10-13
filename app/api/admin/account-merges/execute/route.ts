import { NextResponse } from "next/server";
import {
  AccountMergeUnavailableError,
  AdminMergeConcurrentUpdateError,
  AdminMergeConfirmationError,
  ADMIN_MERGE_CONFIRMATION,
  executeAdminMerge,
  finalizeMergeSideEffects,
} from "@/lib/player-merge";
import { assertServerActorRole, ForbiddenActionError, UnauthorizedActionError } from "@/lib/admin-auth";

// Destructive, irreversible-from-the-UI account merge. Super Admin ONLY:
// - middleware.ts denies operators (route absent from
//   lib/admin-permissions.ts's fail-closed operator allowlist), and
// - this handler independently calls assertServerActorRole(["admin"]).
//
// The body is read for exactly three fields: targetPlayerId,
// sourcePlayerId, confirmation. Any client-supplied actor id, merge plan,
// field precedence or blocker decision is ignored -- the actor comes from
// the verified session, everything else is recomputed by executeAdminMerge
// inside its own SERIALIZABLE transaction. The typed confirmation is
// verified here AND inside executeAdminMerge.
//
// Logging: actor/target/source UUIDs + outcome category only -- never
// emails, Telegram ids, tokens, OTPs or cookies.
export const dynamic = "force-dynamic";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(request: Request) {
  let actorId: string | null = null;
  let targetPlayerId: string | null = null;
  let sourcePlayerId: string | null = null;

  try {
    const actor = await assertServerActorRole(["admin"]);
    actorId = actor.id;

    const body = (await request.json().catch(() => null)) as
      | { targetPlayerId?: unknown; sourcePlayerId?: unknown; confirmation?: unknown }
      | null;

    if (
      typeof body?.targetPlayerId !== "string" ||
      typeof body?.sourcePlayerId !== "string" ||
      !UUID_PATTERN.test(body.targetPlayerId) ||
      !UUID_PATTERN.test(body.sourcePlayerId)
    ) {
      return NextResponse.json({ error: "Выберите основной и присоединяемый аккаунты" }, { status: 400 });
    }

    targetPlayerId = body.targetPlayerId.toLowerCase();
    sourcePlayerId = body.sourcePlayerId.toLowerCase();

    if (body.confirmation !== ADMIN_MERGE_CONFIRMATION) {
      return NextResponse.json(
        { error: `Для объединения введите слово ${ADMIN_MERGE_CONFIRMATION}` },
        { status: 400 }
      );
    }

    const result = await executeAdminMerge({
      targetPlayerId,
      sourcePlayerId,
      confirmation: body.confirmation,
    });

    if (!result.merged) {
      console.info("[admin-account-merge] blocked", {
        actorPlayerId: actorId,
        targetPlayerId,
        sourcePlayerId,
        blockers: result.blockers.map((blocker) => blocker.code),
      });
      return NextResponse.json(
        { error: "Объединение заблокировано", blockers: result.blockers },
        { status: 409 }
      );
    }

    console.info("[admin-account-merge] merged", {
      actorPlayerId: actorId,
      targetPlayerId,
      sourcePlayerId,
    });

    // Post-commit derived-cache refresh. The merge itself is already
    // committed -- a failure here never rolls history/identity back; it is
    // reported separately.
    let achievementRefreshFailed = false;
    try {
      await finalizeMergeSideEffects(targetPlayerId);
    } catch (refreshError) {
      achievementRefreshFailed = true;
      console.error("[admin-account-merge] achievement refresh failed after commit", {
        actorPlayerId: actorId,
        targetPlayerId,
        error: refreshError instanceof Error ? refreshError.name : "unknown",
      });
    }

    return NextResponse.json({ ok: true, result, achievementRefreshFailed });
  } catch (error) {
    if (error instanceof UnauthorizedActionError) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    if (error instanceof ForbiddenActionError) {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    if (error instanceof AdminMergeConfirmationError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    if (error instanceof AdminMergeConcurrentUpdateError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    if (error instanceof AccountMergeUnavailableError) {
      return NextResponse.json({ error: "Объединение аккаунтов временно недоступно" }, { status: 503 });
    }
    console.error("[admin-account-merge] failed", {
      actorPlayerId: actorId,
      targetPlayerId,
      sourcePlayerId,
      error: error instanceof Error ? error.name : "unknown",
    });
    return NextResponse.json({ error: "Не удалось объединить аккаунты" }, { status: 500 });
  }
}
