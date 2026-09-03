import { NextResponse } from "next/server";
import { resetTournamentVisualListOverride } from "@/features/tournament-visuals";

export async function POST(request: Request) {
  try {
    const { tournamentType } = (await request.json()) as { tournamentType?: string };
    if (typeof tournamentType !== "string") {
      return NextResponse.json({ error: "tournamentType обязателен" }, { status: 400 });
    }
    return NextResponse.json({ visual: await resetTournamentVisualListOverride(tournamentType) });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Не удалось сбросить оформление списка" },
      { status: 400 },
    );
  }
}
