import { type NextRequest, NextResponse } from "next/server";
import { AcademyTrainerUnavailableError, AcademyValidationError, getAcademyPushFoldMixQuestion } from "@/features/academy";
import { getPlayerFromSessionServer } from "@/features/auth-server";
import { COOKIE_NAME } from "@/lib/telegram-web-session";

type PushFoldMixSessionRequestBody = {
  attemptId?: unknown;
  questionIndex?: unknown;
};

/**
 * Serves one "Быстрая Push/Fold тренировка" question for the authenticated
 * player (cookie only). The node is derived on the server from (player,
 * attemptId, questionIndex) — ONLY `attemptId` and `questionIndex` are read
 * from the body; any datasetId / nodeKey / playerId there is ignored.
 * Responds with `{hand, renderedCards, actions, spot}` only.
 */
export async function POST(request: NextRequest) {
  const player = await getPlayerFromSessionServer(request.cookies.get(COOKIE_NAME)?.value);
  if (!player) return NextResponse.json({ error: "Необходимо войти в систему" }, { status: 401 });

  try {
    const body = await request.json() as PushFoldMixSessionRequestBody;
    const question = getAcademyPushFoldMixQuestion(player.id, {
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

    console.error("[academy-push-fold-mix-session] Failed to build question");
    return NextResponse.json({ error: "Не удалось подготовить вопрос" }, { status: 500 });
  }
}
