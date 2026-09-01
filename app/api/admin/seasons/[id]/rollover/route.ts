import { NextResponse } from "next/server";
import { rolloverSeason } from "@/features/seasons";

// Season rollover -- Super-Admin-only, same gate as the rest of
// /api/admin/seasons/**. First-class current -> next transition: see
// features/seasons.ts::rolloverSeason for the full precondition/retry-
// safety contract. `:id` is the CURRENT (active) season; `nextSeasonId` in
// the body is the pre-created future season becoming active.
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;

  try {
    const body = (await request.json().catch(() => null)) as { nextSeasonId?: string } | null;

    if (!body?.nextSeasonId) {
      return NextResponse.json({ error: "nextSeasonId обязателен" }, { status: 400 });
    }

    const result = await rolloverSeason(id, body.nextSeasonId);

    if (result.status === "tie") {
      return NextResponse.json(
        {
          error:
            "Ничья за 1-е место — Number One не может быть определён автоматически. Переход к следующему сезону НЕ выполнен.",
          ...result,
        },
        { status: 409 }
      );
    }

    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Не удалось выполнить переход сезона" },
      { status: 400 }
    );
  }
}
