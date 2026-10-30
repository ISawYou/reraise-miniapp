import { NextResponse } from "next/server";
import {
  getTournamentVisualConfigs,
  saveTournamentVisualConfig,
} from "@/features/tournament-visuals";
import { tournamentVisualErrorResponse } from "@/lib/tournament-visual-errors";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json({ visuals: await getTournamentVisualConfigs() });
  } catch (error) {
    return tournamentVisualErrorResponse(error, "admin-read");
  }
}

export async function PUT(request: Request) {
  try {
    const input = await request.json();
    return NextResponse.json({ visual: await saveTournamentVisualConfig(input) });
  } catch (error) {
    return tournamentVisualErrorResponse(error, "save-geometry");
  }
}
