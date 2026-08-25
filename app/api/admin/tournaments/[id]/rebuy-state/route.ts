import { NextResponse } from "next/server";
import { setTournamentPlayerRebuyState } from "@/features/tournaments";

// POST /api/admin/tournaments/[id]/rebuy-state
// Persists the raw Re-buy/Add-on values for one player the instant the
// admin commits an edit (see app/admin/results/[id]/page.tsx's onBlur
// handlers for the "Re-buy"/"Add-on" inputs on a free-tournament row) --
// same shape as .../attendance and .../eliminate, one player at a time.
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const body = (await request.json().catch(() => null)) as
      | { player_id?: string; rebuys?: number; addons?: number }
      | null;

    if (
      !body?.player_id ||
      typeof body.rebuys !== "number" ||
      typeof body.addons !== "number" ||
      !Number.isFinite(body.rebuys) ||
      !Number.isFinite(body.addons) ||
      body.rebuys < 0 ||
      body.addons < 0
    ) {
      return NextResponse.json(
        { error: "player_id, rebuys и addons обязательны и должны быть неотрицательными числами" },
        { status: 400 }
      );
    }

    const result = await setTournamentPlayerRebuyState(
      id,
      body.player_id,
      body.rebuys,
      body.addons
    );

    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to update rebuy/addon state",
      },
      { status: 500 }
    );
  }
}
