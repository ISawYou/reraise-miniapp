import { NextResponse } from "next/server";
import { getTournamentVisualConfigs } from "@/features/tournament-visuals";

export async function GET() {
  try {
    return NextResponse.json({ visuals: await getTournamentVisualConfigs() });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Не удалось загрузить оформление турниров" },
      { status: 500 },
    );
  }
}
