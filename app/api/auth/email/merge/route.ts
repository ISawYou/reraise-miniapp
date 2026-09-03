import { type NextRequest, NextResponse } from "next/server";
import { COOKIE_NAME } from "@/lib/telegram-web-session";
import { getPlayerFromSessionServer } from "@/features/auth-server";
import { playerRepository } from "@/lib/repositories";
import {
  AccountMergeUnavailableError,
  executeMerge,
  finalizeMergeSideEffects,
  MergeIntentExpiredError,
  MergeIntentForbiddenError,
  MergeIntentNotFoundError,
  MergeIntentNotPendingError,
} from "@/lib/player-merge";

// Postgres SQLSTATE for a SERIALIZABLE transaction losing a write-skew
// race -- executeMerge() re-verifies eligibility inside the transaction,
// but a concurrent write to a table it reads (a new registration, say)
// between that read and the transaction's commit can still force Postgres
// to abort it rather than risk an inconsistent result. This is exactly the
// TOCTOU protection working as intended, not a bug -- retried once, since
// the vast majority of the time nothing was actually racing and a retry
// succeeds immediately.
const SERIALIZATION_FAILURE_SQLSTATE = "40001";

// drizzle-orm's postgres-js adapter wraps every query-level error with the
// SQL text for debuggability, which pushes the *real* Postgres error -- and
// its SQLSTATE -- onto `.cause`, not the top-level error object. A
// commit-time (rather than mid-query) failure can surface at the top level
// instead, so this walks the cause chain instead of assuming either shape.
function isSerializationFailure(err: unknown): boolean {
  let current: unknown = err;
  for (let i = 0; i < 5 && current; i++) {
    if (
      typeof current === "object" &&
      "code" in current &&
      (current as { code?: unknown }).code === SERIALIZATION_FAILURE_SQLSTATE
    ) {
      return true;
    }
    current = (current as { cause?: unknown })?.cause;
  }
  return false;
}

export async function POST(request: NextRequest) {
  try {
    // Target is always the caller's own verified, canonical-resolved
    // session -- never a client-supplied id. See lib/player-merge.ts's
    // executeMerge(), which separately re-checks this against the intent's
    // own recorded target.
    const sessionValue = request.cookies.get(COOKIE_NAME)?.value;
    const sessionPlayer = await getPlayerFromSessionServer(sessionValue);

    if (!sessionPlayer) {
      return NextResponse.json({ error: "Необходимо войти в систему" }, { status: 401 });
    }

    const sessionPlayerId = sessionPlayer.id;

    const body = (await request.json()) as { mergeIntentId?: string };
    const mergeIntentId = body.mergeIntentId;

    if (!mergeIntentId || typeof mergeIntentId !== "string") {
      return NextResponse.json({ error: "mergeIntentId обязателен" }, { status: 400 });
    }

    let result;
    try {
      result = await executeMerge({ intentId: mergeIntentId, sessionPlayerId });
    } catch (err) {
      if (isSerializationFailure(err)) {
        result = await executeMerge({ intentId: mergeIntentId, sessionPlayerId });
      } else {
        throw err;
      }
    }

    if (!result.merged) {
      return NextResponse.json(
        {
          error: "Автоматическое объединение недоступно из-за конфликта данных",
          detail: result.reason,
        },
        { status: 409 }
      );
    }

    await finalizeMergeSideEffects(sessionPlayerId);

    const player = await playerRepository.findById(sessionPlayerId);

    return NextResponse.json({ ok: true, player });
  } catch (error) {
    if (error instanceof MergeIntentNotFoundError) {
      return NextResponse.json({ error: "Запрос на объединение не найден" }, { status: 404 });
    }
    if (error instanceof MergeIntentForbiddenError) {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    if (error instanceof MergeIntentNotPendingError) {
      return NextResponse.json({ error: "Этот запрос уже обработан" }, { status: 409 });
    }
    if (error instanceof MergeIntentExpiredError) {
      return NextResponse.json({ error: error.message }, { status: 410 });
    }
    // The intent could only have been created under DATABASE_PROVIDER=postgres
    // (createMergeIntent itself gates on this) -- reaching here under a
    // different provider means the deployment's provider changed between
    // intent creation and confirmation. Distinct 503 rather than folding
    // into the generic "failed to merge" 500 below, so this is
    // distinguishable in logs/monitoring from a genuine merge failure.
    if (error instanceof AccountMergeUnavailableError) {
      return NextResponse.json(
        { error: "Объединение аккаунтов временно недоступно" },
        { status: 503 }
      );
    }

    console.error("[email-otp] merge route error:", error);
    return NextResponse.json({ error: "Не удалось объединить аккаунты" }, { status: 500 });
  }
}
