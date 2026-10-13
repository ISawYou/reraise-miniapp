import { type NextRequest, NextResponse } from "next/server";
import { AcademyValidationError, revealAcademySolverAnswer } from "@/features/academy";
import { assertAcademyAccess, academyCatalogLessonTarget } from "@/features/academy-access";
import { getPlayerFromSessionServer } from "@/features/auth-server";
import { academyAccessErrorResponse } from "@/lib/academy/access-http";
import { COOKIE_NAME } from "@/lib/telegram-web-session";

type SolverRevealRequestBody = {
  lessonCode?: unknown;
  attemptId?: unknown;
  questionIndex?: unknown;
  selectedAction?: unknown;
};

/**
 * Post-answer reveal for one Solver Lab question (frequencies + resolved
 * action) so the UI can show feedback. Informational only: the final score is
 * recomputed independently by the attempt verifier.
 */
export async function POST(request: NextRequest) {
  const player = await getPlayerFromSessionServer(request.cookies.get(COOKIE_NAME)?.value);
  if (!player) return NextResponse.json({ error: "Необходимо войти в систему" }, { status: 401 });

  try {
    const body = await request.json() as SolverRevealRequestBody;
    // Access first: a locked request is refused BEFORE any question / range / reveal payload is built.
    await assertAcademyAccess(player, academyCatalogLessonTarget(body.lessonCode));
    return NextResponse.json(revealAcademySolverAnswer(player.id, {
      lessonCode: typeof body.lessonCode === "string" ? body.lessonCode : "",
      attemptId: typeof body.attemptId === "string" ? body.attemptId : "",
      questionIndex: body.questionIndex,
      selectedAction: body.selectedAction,
    }));
  } catch (error) {
    const denied = academyAccessErrorResponse(error);
    if (denied) return denied;
    if (error instanceof AcademyValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    if (error instanceof SyntaxError) {
      return NextResponse.json({ error: "Некорректный JSON" }, { status: 400 });
    }

    console.error("[academy-solver-reveal] Failed to reveal answer");
    return NextResponse.json({ error: "Не удалось проверить ответ" }, { status: 500 });
  }
}
