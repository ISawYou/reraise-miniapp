import { NextResponse } from "next/server";
import { assertServerActorRole, ForbiddenActionError, UnauthorizedActionError } from "@/lib/admin-auth";
import { getTournamentById } from "@/features/tournaments";
import { getTournamentSource } from "@/lib/tournament-source";

type Context = { params: Promise<{ id: string }> };

function authError(error: unknown) {
  if (error instanceof UnauthorizedActionError) return 401;
  if (error instanceof ForbiddenActionError) return 403;
  return 409;
}
/** Compatibility endpoint: the old Sheet completion flow is retired. */
export async function GET(_request: Request, context: Context) {
  try {
    await assertServerActorRole(["admin", "operator"]);
    const { id } = await context.params;
    const sourceMode = await getTournamentSource(id);
    return NextResponse.json({ sourceMode, retired: true, redirectUrl: `/admin/tournaments/${id}/control` });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Ошибка авторизации" }, { status: authError(error) });
  }
}
export async function POST(_request: Request, context: Context) {
  try {
    await assertServerActorRole(["admin", "operator"]);
    const { id } = await context.params;
    const tournament = await getTournamentById(id);
    if (tournament.status === "completed") {
      return NextResponse.json(
        { code: "TOURNAMENT_ALREADY_COMPLETED", error: "Завершённый турнир доступен только для просмотра и PostgreSQL-коррекций" },
        { status: 409 }
      );
    }
    const sourceMode = await getTournamentSource(id);
    return NextResponse.json(
      {
        code: sourceMode === "POSTGRESQL" ? "POSTGRES_CONSOLE_REQUIRED" : "LEGACY_SHEETS_RETIRED",
        error: "Google Sheets больше не является источником турниров. Используйте консоль PostgreSQL.",
        redirectUrl: `/admin/tournaments/${id}/control`,
      },
      { status: 410 }
    );
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Ошибка авторизации" }, { status: authError(error) });
  }
}
