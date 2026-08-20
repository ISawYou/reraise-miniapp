import { type NextRequest, NextResponse } from "next/server";
import {
  AcademyValidationError,
  submitAcademyTrainingAttempt,
} from "@/features/academy";
import { getPlayerFromSessionServer } from "@/features/auth-server";
import { COOKIE_NAME } from "@/lib/telegram-web-session";

type AttemptRequestBody = {
  attemptId?: unknown;
  lessonCode?: unknown;
  questions?: unknown;
};

export async function POST(request: NextRequest) {
  const player = await getPlayerFromSessionServer(request.cookies.get(COOKIE_NAME)?.value);
  if (!player) return NextResponse.json({ error: "Необходимо войти в систему" }, { status: 401 });

  try {
    const body = await request.json() as AttemptRequestBody;
    const result = await submitAcademyTrainingAttempt(player.id, {
      attemptId: typeof body.attemptId === "string" ? body.attemptId : "",
      lessonCode: typeof body.lessonCode === "string" ? body.lessonCode : "",
      questions: Array.isArray(body.questions)
        ? body.questions
        : [],
    });
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof AcademyValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    if (error instanceof SyntaxError) {
      return NextResponse.json({ error: "Некорректный JSON" }, { status: 400 });
    }

    console.error("[academy-attempt] Failed to save attempt:", error);
    return NextResponse.json(
      { error: "Не удалось сохранить результат тренировки" },
      { status: 500 },
    );
  }
}
