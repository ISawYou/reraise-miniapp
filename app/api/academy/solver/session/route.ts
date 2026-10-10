import { type NextRequest, NextResponse } from "next/server";
import { AcademyValidationError, getAcademySolverQuestion } from "@/features/academy";
import { getPlayerFromSessionServer } from "@/features/auth-server";
import { COOKIE_NAME } from "@/lib/telegram-web-session";

type SolverSessionRequestBody = {
  lessonCode?: unknown;
  attemptId?: unknown;
  questionIndex?: unknown;
};

/**
 * Serves one Solver Lab question, regenerated deterministically server-side
 * from (player, lessonCode, attemptId, questionIndex). Responds with ONLY
 * `{hand, renderedCards, randomizerPercent}` — never frequencies or the
 * resolved action. Idempotent by construction.
 */
export async function POST(request: NextRequest) {
  const player = await getPlayerFromSessionServer(request.cookies.get(COOKIE_NAME)?.value);
  if (!player) return NextResponse.json({ error: "Необходимо войти в систему" }, { status: 401 });

  try {
    const body = await request.json() as SolverSessionRequestBody;
    const question = getAcademySolverQuestion(player.id, {
      lessonCode: typeof body.lessonCode === "string" ? body.lessonCode : "",
      attemptId: typeof body.attemptId === "string" ? body.attemptId : "",
      questionIndex: body.questionIndex,
    });
    return NextResponse.json({
      hand: question.hand,
      renderedCards: question.renderedCards,
      randomizerPercent: question.randomizerPercent,
    });
  } catch (error) {
    if (error instanceof AcademyValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    if (error instanceof SyntaxError) {
      return NextResponse.json({ error: "Некорректный JSON" }, { status: 400 });
    }

    console.error("[academy-solver-session] Failed to build question");
    return NextResponse.json({ error: "Не удалось подготовить вопрос" }, { status: 500 });
  }
}
