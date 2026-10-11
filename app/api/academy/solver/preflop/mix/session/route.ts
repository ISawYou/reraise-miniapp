import { type NextRequest, NextResponse } from "next/server";
import { AcademyValidationError, getAcademyPreflopMixQuestion } from "@/features/academy";
import { getPlayerFromSessionServer } from "@/features/auth-server";
import { COOKIE_NAME } from "@/lib/telegram-web-session";

type PreflopMixSessionRequestBody = {
  attemptId?: unknown;
  questionIndex?: unknown;
};

/**
 * Serves one Quick Mix ("Быстрая тренировка") question for the authenticated
 * player (player id from the session cookie only). The node is derived on the
 * server from (player, attemptId, questionIndex) — ONLY `attemptId` and
 * `questionIndex` are read from the body; any datasetId / nodeKey / playerId
 * there is ignored. Responds with `{hand, renderedCards, actions, spot}` —
 * never the randomizer (revealed only after answering), frequencies, the
 * resolved action or derivation inputs.
 */
export async function POST(request: NextRequest) {
  const player = await getPlayerFromSessionServer(request.cookies.get(COOKIE_NAME)?.value);
  if (!player) return NextResponse.json({ error: "Необходимо войти в систему" }, { status: 401 });

  try {
    const body = await request.json() as PreflopMixSessionRequestBody;
    const question = getAcademyPreflopMixQuestion(player.id, {
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
    if (error instanceof AcademyValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    if (error instanceof SyntaxError) {
      return NextResponse.json({ error: "Некорректный JSON" }, { status: 400 });
    }

    console.error("[academy-preflop-mix-session] Failed to build question");
    return NextResponse.json({ error: "Не удалось подготовить вопрос" }, { status: 500 });
  }
}
