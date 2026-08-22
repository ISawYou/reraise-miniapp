import { NextResponse } from "next/server";
import {
  getAchievementVisualConfigs,
  saveAchievementVisualConfig,
} from "@/features/achievement-visuals";
import type { AchievementVisualConfig } from "@/config/achievement-visuals";

export async function GET() {
  return NextResponse.json({ visuals: await getAchievementVisualConfigs() });
}

export async function PUT(request: Request) {
  try {
    const input = (await request.json()) as AchievementVisualConfig;
    return NextResponse.json({ visual: await saveAchievementVisualConfig(input) });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Не удалось сохранить оформление" },
      { status: 400 },
    );
  }
}
