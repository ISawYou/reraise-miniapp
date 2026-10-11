import { type NextRequest, NextResponse } from "next/server";
import { AcademyValidationError, getAcademyPreflopTrainerQuestion } from "@/features/academy";
import { getPlayerFromSessionServer } from "@/features/auth-server";
import { COOKIE_NAME } from "@/lib/telegram-web-session";

type PreflopTrainerSessionRequestBody = {
  datasetId?: unknown;
  nodeKey?: unknown;
  attemptId?: unknown;
  questionIndex?: unknown;
};

/**
 * Serves one configurable preflop-trainer question for the authenticated
 * player (player id from the session cookie only — never from the body).
 * `datasetId` / `nodeKey` are validated against the registry (fail closed).
 * Responds with ONLY `{hand, renderedCards, randomizerPercent, actions, spot}`
 * — never frequencies, the resolved action or derivation inputs.
 */
export async function POST(request: NextRequest) {
  const player = await getPlayerFromSessionServer(request.cookies.get(COOKIE_NAME)?.value);
  if (!player) return NextResponse.json({ error: "Необходимо войти в систему" }, { status: 401 });

  try {
    const body = await request.json() as PreflopTrainerSessionRequestBody;
    const question = getAcademyPreflopTrainerQuestion(player.id, {
      datasetId: body.datasetId,
      nodeKey: body.nodeKey,
      attemptId: typeof body.attemptId === "string" ? body.attemptId : "",
      questionIndex: body.questionIndex,
    });
    return NextResponse.json({
      hand: question.hand,
      renderedCards: question.renderedCards,
      randomizerPercent: question.randomizerPercent,
      actions: question.actions,
      spot: question.spot,
    });
  } catch (error) {
    if (error instanceof AcademyValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    if (error instanceof SyntaxError) {
      return NextResponse.json({ error: "Некорректный JSON" }, { status: 400 });
    }

    console.error("[academy-preflop-trainer-session] Failed to build question");
    return NextResponse.json({ error: "Не удалось подготовить вопрос" }, { status: 500 });
  }
}
