import { NextResponse } from "next/server";
import { ForbiddenActionError, UnauthorizedActionError } from "@/lib/admin-auth";
import { TournamentNotFoundError } from "@/lib/tournament-errors";
import { isKnockoutCount, type CompletedKnockoutCommand } from "@/lib/completed-knockout-correction";
import { correctCompletedTournamentKnockouts, getCompletedKnockoutSnapshot, KnockoutCorrectionInvalidError, KnockoutCorrectionRejectedError, KnockoutCorrectionUnavailableError } from "@/features/completed-tournament-knockout-correction";

export const dynamic = "force-dynamic";
const uuid = (value: unknown): value is string => typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
type Context = { params: Promise<{ id: string }> };
function failure(error: unknown) {
  if (error instanceof UnauthorizedActionError) return NextResponse.json({ error: error.message }, { status: 401 });
  if (error instanceof ForbiddenActionError) return NextResponse.json({ error: error.message }, { status: 403 });
  if (error instanceof TournamentNotFoundError) return NextResponse.json({ error: "Турнир не найден" }, { status: 404 });
  if (error instanceof KnockoutCorrectionRejectedError) return NextResponse.json({ error: error.message }, { status: 409 });
  if (error instanceof KnockoutCorrectionInvalidError) return NextResponse.json({ error: error.message }, { status: 400 });
  if (error instanceof KnockoutCorrectionUnavailableError) return NextResponse.json({ error: error.message }, { status: 503 });
  console.error("[completed-knockout-correction] persistence operation failed");
  return NextResponse.json({ error: "Не удалось сохранить KO. Обновите результат перед повторной попыткой." }, { status: 500 });
}

// Super Admin only: middleware denies operators (not in its allowlist), and
// BOTH service operations independently assertServerActorRole(['admin']).
export async function GET(request: Request, context: Context) {
  try {
    const { id } = await context.params;
    const playerId = new URL(request.url).searchParams.get("player_id");
    if (!uuid(id) || !uuid(playerId)) return NextResponse.json({ error: "Некорректный ID турнира или игрока" }, { status: 400 });
    return NextResponse.json({ result: await getCompletedKnockoutSnapshot(id, playerId) });
  } catch (error) { return failure(error); }
}

export async function POST(request: Request, context: Context) {
  try {
    const { id } = await context.params;
    const body = await request.json().catch(() => null) as Partial<CompletedKnockoutCommand> | null;
    if (!uuid(id) || !uuid(body?.player_id) || !isKnockoutCount(body?.knockouts) || !isKnockoutCount(body?.boss_knockouts) || typeof body?.revision !== "string" || !/^[a-f0-9]{64}$/.test(body.revision)) {
      return NextResponse.json({ error: "Нужны ID игрока, актуальная revision и целые неотрицательные KO / Boss KO" }, { status: 400 });
    }
    return NextResponse.json(await correctCompletedTournamentKnockouts(id, { player_id: body.player_id, knockouts: body.knockouts, boss_knockouts: body.boss_knockouts, revision: body.revision }));
  } catch (error) { return failure(error); }
}
