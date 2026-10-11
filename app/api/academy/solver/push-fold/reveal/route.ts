import { type NextRequest, NextResponse } from "next/server";
import { AcademyTrainerUnavailableError, AcademyValidationError, revealAcademyPushFoldAnswer } from "@/features/academy";
import { getPlayerFromSessionServer } from "@/features/auth-server";
import { COOKIE_NAME } from "@/lib/telegram-web-session";

type PushFoldRevealRequestBody = {
  datasetId?: unknown;
  nodeKey?: unknown;
  attemptId?: unknown;
  questionIndex?: unknown;
  selectedAction?: unknown;
};

/**
 * Post-answer reveal for one fixed-node Push/Fold question (node frequencies
 * + the hand's pure action), re-derived server-side. Informational only: the
 * final score is recomputed independently by the attempt verifier.
 */
export async function POST(request: NextRequest) {
  const player = await getPlayerFromSessionServer(request.cookies.get(COOKIE_NAME)?.value);
  if (!player) return NextResponse.json({ error: "Необходимо войти в систему" }, { status: 401 });

  try {
    const body = await request.json() as PushFoldRevealRequestBody;
    return NextResponse.json(revealAcademyPushFoldAnswer(player.id, {
      datasetId: body.datasetId,
      nodeKey: body.nodeKey,
      attemptId: typeof body.attemptId === "string" ? body.attemptId : "",
      questionIndex: body.questionIndex,
      selectedAction: body.selectedAction,
    }));
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

    console.error("[academy-push-fold-reveal] Failed to reveal answer");
    return NextResponse.json({ error: "Не удалось проверить ответ" }, { status: 500 });
  }
}
