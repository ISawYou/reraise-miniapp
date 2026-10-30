import { NextResponse } from "next/server";
import { resetTournamentVisualListOverride } from "@/features/tournament-visuals";
import { readTournamentVisualCommand, tournamentVisualErrorResponse } from "@/lib/tournament-visual-errors";

export async function POST(request: Request) {
  try {
    const { tournamentType } = await readTournamentVisualCommand(request);
    if (typeof tournamentType !== "string") {
      return NextResponse.json({ error: "tournamentType обязателен" }, { status: 400 });
    }
    return NextResponse.json({ visual: await resetTournamentVisualListOverride(tournamentType) });
  } catch (error) {
    return tournamentVisualErrorResponse(error, "reset-list");
  }
}
