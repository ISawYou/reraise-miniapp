import { NextResponse } from "next/server";
import { resetTournamentVisualConfig } from "@/features/tournament-visuals";

export async function POST(request: Request) {
  try {
    const { tournamentType } = (await request.json()) as { tournamentType?: string };
    if (typeof tournamentType !== "string") {
      return NextResponse.json({ error: "tournamentType обязателен" }, { status: 400 });
    }
    return NextResponse.json({ visual: await resetTournamentVisualConfig(tournamentType) });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Не удалось сбросить оформление" },
      { status: 400 },
    );
  }
}
