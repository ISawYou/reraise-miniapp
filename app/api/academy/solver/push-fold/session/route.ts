import { type NextRequest, NextResponse } from "next/server";
import { AcademyTrainerUnavailableError, AcademyValidationError, getAcademyPushFoldQuestion } from "@/features/academy";
import { assertAcademyAccess, academyPushFoldTarget } from "@/features/academy-access";
import { getPlayerFromSessionServer } from "@/features/auth-server";
import { academyAccessErrorResponse } from "@/lib/academy/access-http";
import { COOKIE_NAME } from "@/lib/telegram-web-session";

type PushFoldSessionRequestBody = {
  datasetId?: unknown;
  nodeKey?: unknown;
  attemptId?: unknown;
  questionIndex?: unknown;
};

/**
 * Serves one fixed-node Push/Fold question for the authenticated player
 * (player id from the session cookie only — never from the body).
 * `datasetId` / `nodeKey` are validated against the Push/Fold whitelist and
 * registry (fail closed). Responds with ONLY `{hand, renderedCards, actions,
 * spot}` — never frequencies, the correct action or derivation inputs.
 */
export async function POST(request: NextRequest) {
  const player = await getPlayerFromSessionServer(request.cookies.get(COOKIE_NAME)?.value);
  if (!player) return NextResponse.json({ error: "Необходимо войти в систему" }, { status: 401 });

  try {
    // Access first: a locked request is refused BEFORE any question / range / reveal payload is built.
    await assertAcademyAccess(player, academyPushFoldTarget());
    const body = await request.json() as PushFoldSessionRequestBody;
    const question = getAcademyPushFoldQuestion(player.id, {
      datasetId: body.datasetId,
      nodeKey: body.nodeKey,
      attemptId: typeof body.attemptId === "string" ? body.attemptId : "",
      questionIndex: body.questionIndex,
    });
    return NextResponse.json({
      hand: question.hand,
      renderedCards: question.renderedCards,
      actions: question.actions,
      spot: question.spot,
    });
  } catch (error) {
    const denied = academyAccessErrorResponse(error);
    if (denied) return denied;
    // Scored Push/Fold is paused (unvalidated multiway data): 409, never a fallback dataset.
    if (error instanceof AcademyTrainerUnavailableError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    if (error instanceof AcademyValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    if (error instanceof SyntaxError) {
      return NextResponse.json({ error: "Некорректный JSON" }, { status: 400 });
    }

    console.error("[academy-push-fold-session] Failed to build question");
    return NextResponse.json({ error: "Не удалось подготовить вопрос" }, { status: 500 });
  }
}
