import { NextResponse } from "next/server";
import { getAchievementVisualConfigs } from "@/features/achievement-visuals";

export async function GET() {
  try {
    return NextResponse.json({ visuals: await getAchievementVisualConfigs() });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Не удалось загрузить оформление" },
      { status: 500 },
    );
  }
}
