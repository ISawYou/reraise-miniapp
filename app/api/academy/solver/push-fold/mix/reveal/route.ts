import { type NextRequest, NextResponse } from "next/server";
import { AcademyTrainerUnavailableError, AcademyValidationError, revealAcademyPushFoldMixAnswer } from "@/features/academy";
import { assertAcademyAccess, academyPushFoldTarget } from "@/features/academy-access";
import { getPlayerFromSessionServer } from "@/features/auth-server";
import { academyAccessErrorResponse } from "@/lib/academy/access-http";
import { COOKIE_NAME } from "@/lib/telegram-web-session";

type PushFoldMixRevealRequestBody = {
  attemptId?: unknown;
  questionIndex?: unknown;
  selectedAction?: unknown;
};

/**
 * Post-answer reveal for one Quick Push/Fold question. Node, hand and answer
 * are re-derived from (cookie player, attemptId, questionIndex) alone — a
 * body-supplied datasetId / nodeKey / playerId is never read. Informational
 * only: the score is recomputed by the verifier.
 */
export async function POST(request: NextRequest) {
  const player = await getPlayerFromSessionServer(request.cookies.get(COOKIE_NAME)?.value);
  if (!player) return NextResponse.json({ error: "Необходимо войти в систему" }, { status: 401 });

  try {
    // Access first: a locked request is refused BEFORE any question / range / reveal payload is built.
    await assertAcademyAccess(player, academyPushFoldTarget());
    const body = await request.json() as PushFoldMixRevealRequestBody;
    return NextResponse.json(revealAcademyPushFoldMixAnswer(player.id, {
      attemptId: typeof body.attemptId === "string" ? body.attemptId : "",
      questionIndex: body.questionIndex,
      selectedAction: body.selectedAction,
    }));
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

    console.error("[academy-push-fold-mix-reveal] Failed to reveal answer");
    return NextResponse.json({ error: "Не удалось проверить ответ" }, { status: 500 });
  }
}
