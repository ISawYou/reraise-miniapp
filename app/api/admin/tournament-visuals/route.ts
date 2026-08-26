import { NextResponse } from "next/server";
import {
  getTournamentVisualConfigs,
  saveTournamentVisualConfig,
} from "@/features/tournament-visuals";
import type { TournamentVisualConfig } from "@/config/tournament-visuals";

export async function GET() {
  return NextResponse.json({ visuals: await getTournamentVisualConfigs() });
}

export async function PUT(request: Request) {
  try {
    const input = (await request.json()) as TournamentVisualConfig;
    return NextResponse.json({ visual: await saveTournamentVisualConfig(input) });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Не удалось сохранить оформление" },
      { status: 400 },
    );
  }
}
