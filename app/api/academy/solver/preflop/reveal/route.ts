import { type NextRequest, NextResponse } from "next/server";
import { AcademyValidationError, revealAcademyPreflopTrainerAnswer } from "@/features/academy";
import { getPlayerFromSessionServer } from "@/features/auth-server";
import { COOKIE_NAME } from "@/lib/telegram-web-session";

type PreflopTrainerRevealRequestBody = {
  datasetId?: unknown;
  nodeKey?: unknown;
  attemptId?: unknown;
  questionIndex?: unknown;
  selectedAction?: unknown;
};

/**
 * Post-answer reveal for one configurable preflop-trainer question (exact
 * node frequencies + resolved action). Informational only: the final score is
 * recomputed independently by the attempt verifier.
 */
export async function POST(request: NextRequest) {
  const player = await getPlayerFromSessionServer(request.cookies.get(COOKIE_NAME)?.value);
  if (!player) return NextResponse.json({ error: "Необходимо войти в систему" }, { status: 401 });

  try {
    const body = await request.json() as PreflopTrainerRevealRequestBody;
    return NextResponse.json(revealAcademyPreflopTrainerAnswer(player.id, {
      datasetId: body.datasetId,
      nodeKey: body.nodeKey,
      attemptId: typeof body.attemptId === "string" ? body.attemptId : "",
      questionIndex: body.questionIndex,
      selectedAction: body.selectedAction,
    }));
  } catch (error) {
    if (error instanceof AcademyValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    if (error instanceof SyntaxError) {
      return NextResponse.json({ error: "Некорректный JSON" }, { status: 400 });
    }

    console.error("[academy-preflop-trainer-reveal] Failed to reveal answer");
    return NextResponse.json({ error: "Не удалось проверить ответ" }, { status: 500 });
  }
}
